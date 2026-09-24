import { knowledgeAvailable } from '../server/knowledge';
import { clipboard, desktopCapturer, ipcMain } from 'electron';
import type { AppState } from '../shared/types.ts';
import type { ComputerUseStart, ComputerUseTarget } from '../shared/computer-use.ts';
import { createComputerUseController } from './computer-use.ts';
import { createComputerUseSettings } from './cu-settings.ts';
import { createComputerUseFixture } from './cu-fixture.ts';
import { createWindowsComputerUseDriver } from './cu-windows.ts';
import { createUsbWindowsDriver } from './usb-windows';
import type { UsbDevice } from './usb-device';
import { createReplyModel, type ReplyModelCredentials } from './reply-model';
import { createGeminiImeReader } from './gemini-client';
import { monitorUsbHardware, requireUsbHardware } from './hardware-gate';

export async function registerComputerUse(options: {
  trusted: (event: Electron.IpcMainInvokeEvent) => void;
  directory: string;
  secrets: { get(): Promise<string | undefined>; set(value: string): Promise<void>; delete(): Promise<void> };
  scriptPath: string;
  usbDevice: UsbDevice;
  getTypingCredentials(): Promise<ReplyModelCredentials>;
  getWorkspace: () => Promise<AppState>;
  assertOtherIdle?: () => void;
}) {
  const settings = await createComputerUseSettings(options.directory, options.secrets);
  const targets = new Map<string, ComputerUseTarget>();
  let fixture: Awaited<ReturnType<typeof createComputerUseFixture>> | undefined;
  const controller = createComputerUseController({
    getCredentials: settings.credentials,
    createDriver: async (targetId, signal, backend, mode, credentials) => {
      const target = targets.get(targetId);
      if (!target) throw new Error('请重新选择目标窗口。');
      if (mode === 'auto') {
        const readIme = credentials?.modelFamily === 'gemini' ? createGeminiImeReader(credentials) : createReplyModel(await options.getTypingCredentials()).readIme;
        return createUsbWindowsDriver(target.kind === 'test' ? fixture!.nativeTarget() : target, options.scriptPath, options.usbDevice, signal, readIme);
      }
      if (target.kind === 'test') {
        if (!fixture || fixture.isClosed() || fixture.driver.target.id !== targetId) throw new Error('请重新打开测试窗口。');
        return fixture.driver;
      }
      return createWindowsComputerUseDriver(target, options.scriptPath, signal, true);
    },
    getKnowledge: async (ids: string[]) => {
      if (!Array.isArray(ids) || ids.length > 20 || ids.some(id => typeof id !== 'string')) throw new Error('知识选择无效。');
      if (!ids.length) return '';
      const state = await options.getWorkspace();
      const entries = state.knowledge.filter(item => ids.includes(item.id) && knowledgeAvailable(item));
      if (entries.length !== new Set(ids).size) throw new Error('所选知识已变化，请重新选择。');
      const content = entries.map(item => `${item.title}\n${item.content}`).join('\n\n');
      if (content.length > 20000) throw new Error('所选知识超过 20,000 字符，请减少选择。');
      return content;
    },
  });
  let configuring = false;
  let hardwareMonitor: ReturnType<typeof monitorUsbHardware> | undefined;
  let startEpoch = 0;
  const cancelPendingStart = () => { startEpoch++; hardwareMonitor?.close(); };
  const idle = () => { options.assertOtherIdle?.(); if (configuring || controller.isBusy()) throw new Error('请等待设置保存或停止正在运行的电脑操作任务。'); };
  const configure = async (action: () => Promise<unknown>) => { idle(); cancelPendingStart(); configuring = true; try { return await action(); } finally { configuring = false; } };
  const handle = (name: string, action: (...args: any[]) => unknown) => ipcMain.handle(`flowdesk:cu:${name}`, (event, ...args) => { options.trusted(event); return action(...args); });
  handle('settings', settings.settings);
  handle('save-settings', input => configure(() => settings.save(input)));
  handle('clear-key', () => configure(settings.clearKey));
  handle('open-test-target', async () => {
    idle();
    if (!fixture || fixture.isClosed()) fixture = await createComputerUseFixture();
    targets.set(fixture.driver.target.id, fixture.driver.target);
    return fixture.driver.target;
  });
  handle('targets', async () => {
    idle();
    // Names only, and only after the user's explicit window-selection action.
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false });
    for (const [id, target] of targets) if (target.kind === 'window') targets.delete(id);
    const available = sources.filter(source => !source.name.includes('FlowDesk') && !source.name.includes('GhostDesk')).map(source => ({ id: source.id, name: source.name, kind: 'window' as const }));
    for (const target of available) targets.set(target.id, target);
    return available;
  });
  handle('state', controller.state);
  handle('start', async (input: ComputerUseStart) => {
    idle();
    const epoch = ++startEpoch;
    if (input?.inputBackend !== 'usb') throw new Error('电脑操作必须选择 Pico USB HID；请连接匹配硬件后重试。');
    await requireUsbHardware(options.usbDevice);
    if (epoch !== startEpoch) throw new Error('电脑操作启动已取消。');
    idle();
    const state = await controller.start(input);
    hardwareMonitor?.close();
    hardwareMonitor = monitorUsbHardware(options.usbDevice, controller.isBusy, () => { controller.stop(); });
    return state;
  });
  handle('stop', () => { cancelPendingStart(); return controller.stop(); });
  handle('confirm', controller.confirm);
  handle('copy-draft', async () => {
    const draft = controller.state().draft;
    if (!draft || draft.length > 20000) throw new Error('还没有可复制的回复。');
    await clipboard.writeText(draft);
  });
  return { controller, idle,
    getGeminiSummary: async () => {
      const value = await settings.settings();
      return { baseUrl: value.baseUrl, model: value.model, hasKey: value.modelFamily === 'gemini' && value.hasKey };
    },
    // Main-process dependency only; no IPC handler exposes this credential-bearing method.
    getGeminiCredentials: async () => {
      const value = await settings.credentials();
      if (value.modelFamily !== 'gemini') throw new Error('请在电脑操作页选择并保存 Gemini 原生协议。');
      return { baseUrl: value.baseUrl, model: value.model, apiKey: value.apiKey };
    },
    selectedTarget: (id: string) => { const target = targets.get(id); if (!target || target.kind !== 'window') throw new Error('请重新选择一个真实窗口或打开专用多会话测试窗口。'); return target; },
    cancelPendingStart, dispose: () => { cancelPendingStart(); controller.stop(); fixture?.close(); } };
}
