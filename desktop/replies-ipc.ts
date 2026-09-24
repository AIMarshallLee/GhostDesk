import { clipboard, dialog, ipcMain } from 'electron';
import { writeFile } from 'node:fs/promises';
import type { AppState } from '../shared/types';
import type { ComputerUseTarget } from '../shared/computer-use';
import { createDesktopReplies } from './desktop-replies';
import { createDesktopRepliesFixture } from './replies-fixture';
import { createDesktopChatSurface } from './chat-surface';
import { createWindowsComputerUseDriver } from './cu-windows';
import { createReplyModel, type ReplyModelCredentials } from './reply-model';
import { createGeminiRepliesDriver, createGeminiReplyModel } from './gemini-replies';
import type { GeminiCredentials } from './gemini-client';
import type { ReplyModelProtocol } from '../shared/desktop-replies';
import { createUsbWindowsDriver } from './usb-windows';
import type { UsbDevice } from './usb-device';
import { monitorUsbHardware, requireUsbHardware } from './hardware-gate';
import { knowledgeAvailable, retrieveKnowledge } from '../server/knowledge';

export async function registerDesktopReplies(options: {
  trusted(event: Electron.IpcMainInvokeEvent): void;
  directory: string; scriptPath: string;
  usbDevice: UsbDevice;
  selectedTarget(id: string): ComputerUseTarget;
  assertOtherIdle(): void;
  getCredentials(): Promise<ReplyModelCredentials>;
  getGeminiCredentials(): Promise<GeminiCredentials>;
  getGeminiSummary(): Promise<{ baseUrl: string; model: string; hasKey: boolean }>;
  getWorkspace(): Promise<AppState>;
  recordLead?: (conversationName: string, text: string) => Promise<unknown>;
}) {
  let fixture: Awaited<ReturnType<typeof createDesktopRepliesFixture>> | undefined;
  let model: Pick<ReturnType<typeof createReplyModel>, 'readScene' | 'readIme' | 'generate'> | undefined;
  let changing = false;
  let hardwareMonitor: ReturnType<typeof monitorUsbHardware> | undefined;
  let startEpoch = 0;
  const cancelPendingStart = () => { startEpoch++; hardwareMonitor?.close(); };
  const targetFor = (id: string) => {
    if (fixture && !fixture.isClosed() && fixture.driver.target.id === id) return fixture.driver.target;
    return options.selectedTarget(id);
  };
  const controller = await createDesktopReplies({
    directory: options.directory,
    onIncomingLead: options.recordLead ? async (name, text) => {
      try { await options.recordLead!(name, text); } catch { /* best effort */ }
    } : undefined,
    async createSurface(id, config) {
      const target = targetFor(id);
      const gemini = config.modelProtocol === 'gemini-native' ? await options.getGeminiCredentials() : undefined;
      model = gemini ? createGeminiReplyModel(gemini) : createReplyModel(await options.getCredentials());
      const boundModel = model;
      return createDesktopChatSurface({ target, layout: config.layout, readScene: boundModel.readScene,
        createDriver: async signal => {
          const bound = target.kind === 'test' ? fixture!.nativeTarget() : target;
          const driver = await createUsbWindowsDriver(bound, options.scriptPath, options.usbDevice, signal, boundModel.readIme);
          return gemini ? createGeminiRepliesDriver(driver, gemini, signal, config.layout) : driver;
        },
      });
    },
    async context(config, query) {
      const state = await options.getWorkspace();
      const mode = config.knowledgeMode ?? 'selected';
      if (mode === 'selected' && config.knowledgeIds.length > 20) throw new Error('手动选择模式最多使用 20 条知识。');
      const allowed = new Set(config.knowledgeIds);
      const selected = state.knowledge.filter(item => knowledgeAvailable(item) && allowed.has(item.id));
      if (mode === 'selected' && selected.length !== allowed.size) throw new Error('所选知识已停用、待审核或删除。');
      const workflow = state.workflows.find(item => item.id === config.workflowId && item.enabled);
      if (config.workflowId && !workflow) throw new Error('所选工作流已被禁用或删除。');
      if (!query) return { knowledge: '', instructions: workflow ? `${workflow.instructions}\n${workflow.description}\n${workflow.greeting}` : '', knowledgeIds: [] };
      const entries: Array<{ id: string; title: string; content: string }> = mode === 'retrieve'
        ? retrieveKnowledge(state.knowledge, { query: query.slice(0, 4000), ids: config.knowledgeIds.length ? config.knowledgeIds : undefined }).hits
        : selected.map(item => ({ id: item.id, title: item.title, content: item.content }));
      const included: typeof entries = []; let length = 0; let omitted = 0;
      for (const item of entries) { const text = `【${item.title}】\n${item.content}`; if (length + text.length > 20000) { omitted++; continue; } included.push(item); length += text.length; }
      const coverage = included.length ? '' : '\n资料未覆盖，请澄清或转人工，不编造价格/承诺。';
      const truncation = omitted ? `\n已因 20,000 字符上下文上限省略 ${omitted} 条完整知识。` : '';
      return { knowledge: included.map(item => `【${item.title}】\n${item.content}`).join('\n\n'), instructions: `${workflow ? `${workflow.instructions}\n${workflow.description}\n${workflow.greeting}` : ''}${coverage}${truncation}`, knowledgeIds: included.map(item => item.id) };
    },
    async generate(input, signal) { if (!model) throw new Error('请重新开始监听。'); return model.generate(input, signal); },
  });
  const isActive = () => changing || controller.state().status === 'running' || controller.state().busy;
  const idle = () => { options.assertOtherIdle(); if (isActive()) throw new Error('请先暂停持续回复，再切换窗口或修改设置。'); };
  const mutate = async <T>(action: () => Promise<T>) => {
    if (changing) throw new Error('正在切换持续回复状态，请稍候。');
    changing = true; try { return await action(); } finally { changing = false; }
  };
  const handle = (name: string, action: (...args: any[]) => unknown) => ipcMain.handle(`flowdesk:replies:${name}`, (event, ...args) => { options.trusted(event); return action(...args); });
  handle('state', controller.state);
  handle('save-config', config => { options.assertOtherIdle(); startEpoch++; return mutate(() => controller.saveConfig(config)); });
  handle('start', async input => { idle(); const epoch = ++startEpoch; await requireUsbHardware(options.usbDevice); if (epoch !== startEpoch) throw new Error('持续回复启动已取消。'); idle(); if (controller.state().config.inputBackend !== 'usb') throw new Error('持续回复必须选择 Pico USB HID；请连接匹配硬件后重试。'); const state = await mutate(() => controller.start(input)); hardwareMonitor?.close(); hardwareMonitor = monitorUsbHardware(options.usbDevice, isActive, () => { void controller.pause().catch(() => {}); }); return state; });
  // Stop/pause are intentionally callable while a start is awaiting a model or native helper.
  handle('pause', () => { cancelPendingStart(); return controller.pause(); });
  handle('stop', () => { cancelPendingStart(); return controller.stop(); });
  handle('takeover', (id, enabled) => { startEpoch++; return mutate(() => controller.takeover(id, enabled)); });
  handle('copy', async id => { await clipboard.writeText(await controller.copy(id)); });
  handle('resolve', id => mutate(() => controller.resolve(id)));
  handle('select-candidate', (id, candidateId) => mutate(() => controller.selectCandidate(id, candidateId)));
  handle('open-test-target', () => { idle(); return mutate(async () => {
    if (!fixture || fixture.isClosed()) fixture = await createDesktopRepliesFixture();
    return fixture.driver.target;
  }); });
  handle('preview', id => { idle(); return mutate(async () => {
    const target = targetFor(id);
    const driver = target.kind === 'test' ? fixture!.driver : await createWindowsComputerUseDriver(target, options.scriptPath);
    const image = await driver.observe();
    return { image: `data:image/png;base64,${image.base64}`, width: image.width, height: image.height };
  }); });
  handle('provider', async (protocol?: ReplyModelProtocol) => {
    if (protocol !== undefined && !['gemini-native', 'openai-vision', 'deepseek'].includes(protocol)) throw new Error('模型协议无效。');
    const native = (protocol ?? controller.state().config.modelProtocol) === 'gemini-native';
    if (native) {
      const summary = await options.getGeminiSummary();
      return { configured: summary.hasKey, baseUrl: summary.baseUrl, model: summary.model };
    }
    const credentials = await options.getCredentials();
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(credentials.baseUrl).hostname);
    return { configured: Boolean(credentials.apiKey) || local, baseUrl: credentials.baseUrl, model: credentials.model };
  });
  handle('export-report', async () => {
    const snapshot = controller.state();
    const result = await dialog.showSaveDialog({ title: '导出持续回复记录（含会话文本）', defaultPath: 'FlowDesk-持续回复记录.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return '已取消';
    await writeFile(result.filePath, JSON.stringify({ exportedAt: new Date().toISOString(), evidence: '视觉确认仅代表界面观察，不是平台服务器送达回执。', ...snapshot }, null, 2), 'utf8');
    return result.filePath;
  });
  return { controller, isActive, cancelPendingStart, dispose: async () => { cancelPendingStart(); await controller.close(); fixture?.close(); model = undefined; } };
}
