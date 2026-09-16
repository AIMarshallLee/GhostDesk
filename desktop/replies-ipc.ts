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
    async context(config) {
      const state = await options.getWorkspace();
      if (config.knowledgeIds.length > 20) throw new Error('请选择最多 20 条知识。');
      const entries = state.knowledge.filter(item => item.enabled && config.knowledgeIds.includes(item.id));
      if (entries.length !== new Set(config.knowledgeIds).size) throw new Error('所选知识已被禁用或删除。');
      const knowledge = entries.map(item => `【${item.title}】\n${item.content}`).join('\n\n');
      if (knowledge.length > 20000) throw new Error('所选知识超过 20,000 字符，请减少选择。');
      const workflow = state.workflows.find(item => item.id === config.workflowId && item.enabled);
      if (config.workflowId && !workflow) throw new Error('所选工作流已被禁用或删除。');
      return { knowledge, instructions: workflow ? `${workflow.instructions}\n${workflow.description}\n${workflow.greeting}` : '' };
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
    if (protocol !== undefined && !['gemini-native', 'openai-vision'].includes(protocol)) throw new Error('模型协议无效。');
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
