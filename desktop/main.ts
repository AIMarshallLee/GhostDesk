import { createUsbDevice } from './usb-device';
import { requireUsbHardware } from './hardware-gate';
import { registerUsbIpc } from './usb-ipc';
import { createUsbWindowsDriver } from './usb-windows';
import { createReplyModel } from './reply-model';
import { runUsbRepliesSmoke } from './usb-smoke';
import { app, BrowserWindow, clipboard, desktopCapturer, dialog, ipcMain, net, powerMonitor, protocol, safeStorage, shell } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import type { CaptureResult, CaptureSource } from '../shared/types.ts';
import { registerComputerUse } from './cu-ipc.ts';
import { runComputerUseSmoke } from './cu-smoke.ts';
import { runGeminiSmoke } from './gemini-smoke';
import { runGeminiRepliesSmoke } from './gemini-replies-smoke';
import { registerGeminiMediaIpc } from './gemini-media-ipc';
import { registerDesktopReplies } from './replies-ipc.ts';
import { runDesktopRepliesSmoke } from './replies-smoke.ts';
import { runDesktopRepliesNativeSmoke } from './replies-native-smoke.ts';
import { runDesktopRepliesSoak } from './replies-soak.ts';
import { isAllowedRendererUrl, isAllowedRequest, sameProcessIdentity, sameWindowIdentity, validCrop, windowHandleFromSource } from './guards.ts';
import { executeAppleScript, isMacOS } from './macos-adapter';

const execFileAsync = promisify(execFile);
type CapturedWindow = { sourceId: string; name: string; hwnd?: string; process?: string; pid?: number; startedAt?: string };
const captured = new Map<string, CapturedWindow>();
const rendererUrl = 'flowdesk://app/index.html';
const fixtureTest = ['--gemini-replies-smoke-test', '--gemini-smoke-test', '--cu-smoke-test', '--replies-smoke-test', '--replies-native-smoke-test', '--replies-soak-test', '--usb-smoke-test', '--usb-soak-test'].some(flag => process.argv.includes(flag));
protocol.registerSchemesAsPrivileged([{ scheme: 'flowdesk', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
if (process.argv.some(arg => ['--smoke-test', '--gemini-replies-smoke-test', '--gemini-smoke-test', '--cu-smoke-test', '--replies-smoke-test', '--replies-native-smoke-test', '--replies-soak-test', '--usb-smoke-test', '--usb-soak-test'].includes(arg))) app.setPath('userData', process.env.FLOWDESK_SMOKE_DIR ?? join(app.getPath('temp'), 'flowdesk-smoke'));
if (process.argv.some(arg => ['--gemini-replies-smoke-test', '--gemini-smoke-test', '--cu-smoke-test', '--replies-smoke-test', '--replies-native-smoke-test', '--replies-soak-test', '--usb-smoke-test', '--usb-soak-test'].includes(arg))) app.disableHardwareAcceleration();
const usbScript = () => app.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked', 'desktop-build', 'usb-channel.ps1') : join(__dirname, 'usb-channel.ps1');
const identityScript = () => app.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked', 'desktop-build', 'window-identity.ps1') : join(__dirname, 'window-identity.ps1');
const firmwareArtifact = () => join(__dirname, 'firmware', 'flowdesk_usb.uf2');
let mainWindow: BrowserWindow | undefined;

function assertMainFrame(event: Electron.IpcMainInvokeEvent, rendererUrl: string) {
  if (event.senderFrame !== event.sender.mainFrame || !isAllowedRendererUrl(event.senderFrame.url, rendererUrl)) throw new Error('Only the main FlowDesk window may use this action.');
}

class EncryptedSecretStore {
  constructor(private readonly file: string) {}
  async get(): Promise<string | undefined> {
    try { return safeStorage.decryptString(Buffer.from(JSON.parse(await readFile(this.file, 'utf8')).value, 'base64')); } catch { return undefined; }
  }
  async set(value: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows credential encryption is unavailable.');
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, JSON.stringify({ value: safeStorage.encryptString(value).toString('base64') }), { mode: 0o600 });
    await rename(temporary, this.file);
  }
  async delete(): Promise<void> { await writeFile(this.file, JSON.stringify({}), { mode: 0o600 }); }
}

async function activeWindow(hwnd: string): Promise<{ hwnd: string; title: string; process?: string; pid: number; startedAt?: string }> {
  if (isMacOS()) {
    const { ok, output } = await executeAppleScript(
      'tell application "System Events" to tell (first process whose frontmost is true) to return name & "|" & (unix id of it)'
    );
    if (ok && output) {
      const [appName, pidStr] = output.split('|');
      return { hwnd, title: appName || 'Active App', process: appName, pid: Number(pidStr) || 0, startedAt: new Date().toISOString() };
    }
    return { hwnd, title: 'macOS Application', pid: 0, startedAt: new Date().toISOString() };
  }
  if (process.platform !== 'win32') throw new Error('Pasting is supported on Windows and macOS only.');
  if (!/^\d+$/.test(hwnd)) throw new Error('Invalid selected window identity.');
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', identityScript(), '-Hwnd', hwnd], { windowsHide: true, timeout: 2_500 });
  if (!stdout.trim()) throw new Error('Selected window is no longer available.');
  const value = JSON.parse(stdout) as { ProcessName: string; MainWindowTitle: string; MainWindowHandle: number; ProcessId: number; StartedAt: string };
  return { hwnd: String(value.MainWindowHandle), title: value.MainWindowTitle, process: value.ProcessName, pid: value.ProcessId, startedAt: value.StartedAt };
}

async function sourceFor(sourceId: string) {
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 4096, height: 4096 }, fetchWindowIcons: false });
  return sources.find((source) => source.id === sourceId && !source.name.includes('FlowDesk') && !source.name.includes('GhostDesk'));
}

async function createWindow() {
  const window = new BrowserWindow({ show: !process.argv.includes('--smoke-test'), width: 1180, height: 820, minWidth: 960, minHeight: 680, webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: !process.argv.includes('--smoke-test'), additionalArguments: process.argv.includes('--smoke-test') ? ['--flowdesk-smoke-renderer'] : [] } });
  mainWindow = window;
  if (process.argv.includes('--smoke-test')) {
    window.webContents.on('console-message', (_event, level, message, line, sourceId) => console.error(`Renderer console ${level} at ${sourceId}:${line}: ${message}`));
    window.webContents.on('did-fail-load', (_event, code, description, url) => console.error('Frame failed', code, description, url));
  }
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (!isAllowedRendererUrl(url, rendererUrl)) event.preventDefault(); });
  await window.loadURL(rendererUrl + (process.argv.includes('--smoke-test') ? '#autopilot' : ''));
  return window;
}

app.whenReady().then(async () => {
  const simulatorHash = createHash('sha256').update((await readFile(join(__dirname, '..', 'dist', 'simulator.js'), 'utf8')).replace(/\r\n/g, '\n')).digest('base64');
  protocol.handle('flowdesk', async request => {
    const url = new URL(request.url);
    const simulatorRelay = url.pathname === '/simulator.html' && /^relay=[0-9a-f-]{36}$/.test(url.search.slice(1));
    if (request.method !== 'GET' || url.host !== 'app' || url.username || url.password || (url.search && !simulatorRelay) || !(/^\/assets\/[a-zA-Z0-9_.-]+$/.test(url.pathname) || ['/index.html', '/favicon.svg', '/simulator.js', '/simulator.css', '/cu-fixture.html', '/cu-fixture.css', '/cu-fixture.js', '/desktop-chat-fixture.html', '/desktop-chat-fixture.css', '/desktop-chat-fixture.js'].includes(url.pathname) || simulatorRelay)) return new Response('Not found', { status: 404 });
    try {
      if (simulatorRelay) {
        const html = (await readFile(join(__dirname, '..', 'dist', 'simulator.html'), 'utf8')).replace('<head>', `<head><meta name="flowdesk-relay" content="${url.searchParams.get('relay')}">`);
        return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; script-src 'self' flowdesk://app; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors flowdesk://app" } });
      }
      const response = await net.fetch(pathToFileURL(join(__dirname, '..', 'dist', url.pathname.slice(1))).href);
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', `default-src 'self'; script-src 'self' flowdesk://app 'sha256-${simulatorHash}'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors flowdesk://app`);
      return new Response(response.body, { status: response.status, headers });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  if (process.argv.includes('--gemini-replies-smoke-test')) {
    const timeout = setTimeout(() => { console.error('FlowDesk Gemini persistent smoke timed out.'); app.exit(1); }, 230000);
    try { await runGeminiRepliesSmoke(); clearTimeout(timeout); app.exit(0); }
    catch (error) { console.error('FlowDesk Gemini persistent smoke failed:', error instanceof Error ? error.message : 'unknown failure'); app.exit(1); }
    return;
  }
  if (process.argv.includes('--gemini-smoke-test')) {
    const timeout = setTimeout(() => { console.error('FlowDesk Gemini smoke timed out.'); app.exit(1); }, 170000);
    try { await runGeminiSmoke(); clearTimeout(timeout); app.exit(0); }
    catch (error) { console.error('FlowDesk Gemini smoke failed:', error instanceof Error ? error.message : 'unknown failure'); app.exit(1); }
    return;
  }
  if (process.argv.includes('--cu-smoke-test')) {
    const timeout = setTimeout(() => { console.error('FlowDesk Computer Use smoke timed out.'); app.exit(1); }, 45000);
    try { await runComputerUseSmoke(); clearTimeout(timeout); app.exit(0); }
    catch (error) { console.error('FlowDesk Computer Use smoke failed:', error instanceof Error ? error.message : 'unknown failure'); app.exit(1); }
    return;
  }
  if (process.argv.includes('--usb-smoke-test') || process.argv.includes('--usb-soak-test')) {
    const soak = process.argv.includes('--usb-soak-test');
    const timeout = setTimeout(() => { console.error('FlowDesk USB test timed out.'); app.exit(1); }, soak ? 360000 : 115000);
    try { await runUsbRepliesSmoke(soak); clearTimeout(timeout); app.exit(0); }
    catch (error) { console.error('FlowDesk USB test failed:', error instanceof Error ? error.message : 'unknown failure'); app.exit(1); }
    return;
  }
  if (process.argv.includes('--replies-smoke-test')) {
    const timeout = setTimeout(() => { console.error('FlowDesk desktop replies smoke timed out.'); app.exit(1); }, 110000);
    try { await runDesktopRepliesSmoke(); clearTimeout(timeout); app.exit(0); }
    catch (error) { console.error('FlowDesk desktop replies smoke failed:', error instanceof Error ? error.message : 'unknown failure'); app.exit(1); }
    return;
  }
  if (process.argv.includes('--replies-native-smoke-test')) {
    const timeout = setTimeout(() => { console.error('FlowDesk native replies smoke timed out.'); app.exit(1); }, 170000);
    try { await runDesktopRepliesNativeSmoke(app.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked', 'desktop-build', 'cu-native.ps1') : join(__dirname, 'cu-native.ps1')); clearTimeout(timeout); app.exit(0); }
    catch (error) { console.error('FlowDesk native replies smoke failed:', error instanceof Error ? error.message : 'unknown failure'); app.exit(1); }
    return;
  }
  if (process.argv.includes('--replies-soak-test')) {
    const timeout = setTimeout(() => { console.error('FlowDesk desktop replies soak timed out.'); app.exit(1); }, 360000);
    try { await runDesktopRepliesSoak(); clearTimeout(timeout); app.exit(0); }
    catch (error) { console.error('FlowDesk desktop replies soak failed:', error instanceof Error ? error.message : 'unknown failure'); app.exit(1); }
    return;
  }
  const { createService, LiveModelHardwareUnavailable } = await import('../server/service.ts');
  const usbDevice = createUsbDevice(usbScript());
  const service = await createService({ dataDir: join(app.getPath('userData'), 'data'), secrets: new EncryptedSecretStore(join(app.getPath('userData'), 'secrets.json')), beforeLiveModel: async () => {
    try { await requireUsbHardware(usbDevice); } catch { throw new LiveModelHardwareUnavailable(); }
  } });
  const trusted = (event: Electron.IpcMainInvokeEvent) => assertMainFrame(event, rendererUrl);
  let replies: Awaited<ReturnType<typeof registerDesktopReplies>> | undefined;
  let media: ReturnType<typeof registerGeminiMediaIpc> | undefined;
  let workspaceMutating = 0;
  let nativeInputBusy = false;
  const scriptPath = app.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked', 'desktop-build', 'cu-native.ps1') : join(__dirname, 'cu-native.ps1');
  const getWorkspace = async () => await service.request({ method: 'GET', path: '/state' }) as import('../shared/types.ts').AppState;
  const assertRepliesIdle = () => { if (nativeInputBusy || workspaceMutating || replies?.isActive() || media?.isActive()) throw new Error('请先暂停持续回复或等待设置保存、桌面输入、附件分析结束。'); };
  const computerUse = await registerComputerUse({ trusted, directory: app.getPath('userData'), secrets: new EncryptedSecretStore(join(app.getPath('userData'), 'computer-use-secrets.json')), scriptPath, usbDevice, getWorkspace, getTypingCredentials: service.desktopModelCredentials, assertOtherIdle: assertRepliesIdle });
  replies = await registerDesktopReplies({ trusted, directory: join(app.getPath('userData'), 'desktop-replies'), scriptPath, usbDevice, getWorkspace,
    getCredentials: service.desktopModelCredentials, getGeminiCredentials: computerUse.getGeminiCredentials, getGeminiSummary: computerUse.getGeminiSummary, selectedTarget: computerUse.selectedTarget,
    assertOtherIdle: () => { if (nativeInputBusy || workspaceMutating || computerUse.controller.isBusy() || media?.isActive()) throw new Error('请等待设置保存、桌面输入、附件分析或停止单次电脑操作。'); },
  });
  media = registerGeminiMediaIpc({ trusted, usbDevice, getWorkspace, getCredentials: computerUse.getGeminiCredentials,
    assertIdle: () => { if (nativeInputBusy || workspaceMutating || replies?.isActive() || computerUse.controller.isBusy()) throw new Error('请等待设置保存并停止其他桌面任务。'); },
    saveDraft: async input => { workspaceMutating++; try { return await service.recordAttachmentDraft(input); } finally { workspaceMutating--; } },
  });
  const nativeInput = async <T>(action: () => Promise<T>) => {
    assertRepliesIdle(); computerUse.idle(); nativeInputBusy = true;
    try { return await action(); } finally { nativeInputBusy = false; }
  };
  powerMonitor.on('lock-screen', () => { media?.cancel(); replies?.cancelPendingStart(); void replies?.controller.pause().catch(() => {}); computerUse.cancelPendingStart(); computerUse.controller.stop(); });
  powerMonitor.on('suspend', () => { media?.cancel(); replies?.cancelPendingStart(); void replies?.controller.pause().catch(() => {}); computerUse.cancelPendingStart(); computerUse.controller.stop(); });
  let uiSmokeRunning = false;
  ipcMain.on('flowdesk:smoke-ready', async (event) => {
    if (!process.argv.includes('--smoke-test') || uiSmokeRunning || event.senderFrame !== event.sender.mainFrame || !isAllowedRendererUrl(event.senderFrame.url, rendererUrl)) return;
    uiSmokeRunning = true;
    try {
      const ui = await event.sender.executeJavaScript(`(async () => {
        const state = await window.flowdesk.desktopReplies.state();
        if (state.status !== 'stopped' && state.status !== 'paused') throw new Error('Listener unexpectedly active');
        const provider = await window.flowdesk.desktopReplies.provider();
        if ('apiKey' in provider || provider.configured !== false) throw new Error('Fresh provider summary is invalid');
        location.hash = 'desktop-replies';
        for (let i = 0; i < 40; i++) {
          if (document.querySelector('h1')?.textContent === '持续回复' && document.body.textContent.includes('窗口区域校准')) break;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (!document.body.textContent.includes('窗口区域校准') || !document.querySelector('input[aria-label="持续回复必需硬件"]')?.value.includes('Pico')) throw new Error('Desktop replies hardware requirement missing');
        const usb = await window.flowdesk.usb.status();
        if (usb.connected || usb.armed) throw new Error('USB unexpectedly connected');
        const discovered = await window.flowdesk.usb.discover();
        if (discovered.matches.length || discovered.autoConnected) throw new Error('Offline smoke discovered real hardware');
        const cuSettings = await window.flowdesk.computerUse.settings();
        if (cuSettings.modelFamily !== 'gemini' || cuSettings.hasKey || 'apiKey' in cuSettings) throw new Error('Gemini default settings or credential isolation failed');
        let staleRejected = false;
        try { await window.flowdesk.computerUse.confirm({ id: 'fictional-stale-confirmation', approved: true }); } catch { staleRejected = true; }
        if (!staleRejected) throw new Error('Idle confirmation accepted');
        let cuHardwareRejected = false, repliesHardwareRejected = false;
        try { await window.flowdesk.computerUse.start({ targetId: 'missing', instruction: '虚构硬件检查', mode: 'manual', maxSteps: 1, allowModel: true, inputBackend: 'usb' }); } catch (error) { cuHardwareRejected = String(error).includes('必须连接匹配'); }
        try { await window.flowdesk.desktopReplies.start({ targetId: 'missing', allowModel: true }); } catch (error) { repliesHardwareRejected = String(error).includes('必须连接匹配'); }
        if (!cuHardwareRejected || !repliesHardwareRejected) throw new Error('Hardware gate did not reject offline starts');
        location.hash = 'computer-use';
        for (let i = 0; i < 40; i++) {
          if (document.querySelector('select[aria-label="电脑操作模型协议"]')?.value === 'gemini') break;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (document.querySelector('select[aria-label="电脑操作模型协议"]')?.value !== 'gemini' || !document.querySelector('input[aria-label="电脑操作 API Key"][type="password"]')) throw new Error('Gemini page did not render');
        location.hash = 'attachments';
        for (let i = 0; i < 40 && !document.querySelector('input[aria-label="选择本地附件"]'); i++) await new Promise(resolve => setTimeout(resolve, 100));
        if (!document.querySelector('input[aria-label="选择本地附件"]')) throw new Error('Attachment page did not render');
        let mediaRejected = false, forgedResultRejected = false;
        try { await window.flowdesk.media.analyze({ files: [{ name: 'fiction.txt', mimeType: 'text/plain', size: 1, base64: 'YQ==' }], question: '虚构测试', knowledgeIds: [], allowModel: true }); } catch { mediaRejected = true; }
        try { await window.flowdesk.media.save({ resultId: 'forged', title: '伪造结果', transcript: '虚构', reply: '虚构' }); } catch { forgedResultRejected = true; }
        if (!mediaRejected || !forgedResultRejected) throw new Error('Attachment offline or result gate failed');
        location.hash = 'knowledge';
        for (let i = 0; i < 40 && !document.body.textContent.includes('学习候选'); i++) await new Promise(resolve => setTimeout(resolve, 100));
        if (!document.body.textContent.includes('学习候选')) throw new Error('Learning page did not render');
        location.hash = 'hardware';
        for (let i = 0; i < 40; i++) {
          if (document.getElementById('hardware-test-input') && document.body.textContent.includes('保存 0.5 UF2')) return true;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error('USB hardware page did not render');
      })()`);
      if (!ui) throw new Error('Renderer check failed');
      console.log('FlowDesk renderer loaded successfully. Simulator IPC relay ready; parent access blocked.');
      console.log('Desktop replies and Gemini renderer, restricted IPC smoke passed.'); app.quit();
    } catch { console.error('Desktop replies renderer smoke failed.'); app.exit(1); }
  });
  ipcMain.handle('flowdesk:request', async (event, request) => {
    trusted(event); if (!isAllowedRequest(request)) throw new Error('Request is not allowed.');
    const body = request.body && typeof request.body === 'object' ? request.body as { mode?: unknown; action?: unknown } : {};
    const needsHardware = request.method === 'POST' && (request.path === '/provider/test'
      || (/^\/tasks\/[^/]+\/generate$/.test(request.path) && body.mode === 'live')
      || (request.path === '/sandbox/control' && body.action === 'start' && body.mode !== 'rules'));
    if (needsHardware) await requireUsbHardware(usbDevice);
    const changesContext = request.method !== 'GET' && /^\/(settings|import|provider\/key|knowledge(?:\/|$)|workflows(?:\/|$)|learning(?:\/|$))/.test(request.path);
    if (!changesContext) return service.request(request);
    assertRepliesIdle(); workspaceMutating++;
    try { return await service.request(request); } finally { workspaceMutating--; }
  });
  ipcMain.handle('flowdesk:sources', async (event): Promise<CaptureSource[]> => {
    trusted(event);
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 360, height: 220 }, fetchWindowIcons: false });
    return sources.filter((source) => !source.name.includes('FlowDesk')).map((source) => ({ id: source.id, name: source.name, thumbnail: source.thumbnail.toDataURL() }));
  });
  ipcMain.handle('flowdesk:capture', async (event, sourceId: unknown, crop: unknown): Promise<CaptureResult> => {
    trusted(event); if (typeof sourceId !== 'string') throw new Error('Invalid capture source.');
    const source = await sourceFor(sourceId); if (!source) throw new Error('Selected window is unavailable.');
    const image = source.thumbnail; const size = image.getSize();
    if (!validCrop(crop as never, size.width, size.height)) throw new Error('Invalid capture area.');
    let output = crop ? image.crop(crop as Electron.Rectangle) : image;
    const initial = output.getSize(); const scale = Math.min(1, 1600 / Math.max(initial.width, initial.height));
    if (scale < 1) output = output.resize({ width: Math.max(1, Math.round(initial.width * scale)), height: Math.max(1, Math.round(initial.height * scale)) });
    let jpeg = output.toJPEG(85); for (let quality = 75; Buffer.byteLength(jpeg.toString('base64')) > 4_500_000 && quality >= 35; quality -= 10) jpeg = output.toJPEG(quality);
    if (Buffer.byteLength(jpeg.toString('base64')) > 4_500_000) throw new Error('Capture is too detailed to store safely; select a smaller area.');
    const outputSize = output.getSize(); const hwnd = windowHandleFromSource(source.id);
    let identity: Awaited<ReturnType<typeof activeWindow>> | undefined; if (hwnd && (process.platform === 'win32' || isMacOS())) { try { identity = await activeWindow(hwnd); } catch { /* capture remains usable; paste will re-check */ } }
    captured.set(source.id, { sourceId: source.id, name: source.name, hwnd, process: identity?.process, pid: identity?.pid, startedAt: identity?.startedAt });
    return { sourceId: source.id, sourceName: source.name, image: `data:image/jpeg;base64,${jpeg.toString('base64')}`, width: outputSize.width, height: outputSize.height };
  });
  ipcMain.handle('flowdesk:copy-text', async (event, text: unknown) => { trusted(event); if (typeof text !== 'string' || text.length > 20000) throw new Error('Invalid text.'); await clipboard.writeText(text); });
  ipcMain.handle('flowdesk:version', async (event) => { trusted(event); return app.getVersion(); });
  registerUsbIpc({ trusted, getWindow: () => mainWindow, device: usbDevice, scriptPath, firmwarePath: firmwareArtifact(), offlineTest: process.argv.includes('--smoke-test'),
    idle: () => { assertRepliesIdle(); computerUse.idle(); if (usbDevice.busy()) throw new Error('请先停止 USB 任务。'); },
    stop: async () => { media?.cancel(); computerUse.cancelPendingStart(); replies?.cancelPendingStart(); computerUse.controller.stop(); await Promise.all([computerUse.controller.waitForIdle(), replies?.controller.pause()]); },
    exclusive: nativeInput,
    pasteTask: (taskId, sourceId) => nativeInput(async () => {
      if (typeof taskId !== 'string' || typeof sourceId !== 'string') throw new Error('Invalid USB paste request.');
      const selected = captured.get(sourceId); if (!selected?.hwnd || !selected.pid || !selected.startedAt) throw new Error('请先采集并选择目标窗口。');
      const current = await activeWindow(selected.hwnd);
      if (!sameWindowIdentity(selected, current) || !sameProcessIdentity(selected, current)) throw new Error('目标窗口身份已变化。');
      await requireUsbHardware(usbDevice);
      const state = await getWorkspace(); const task = state.tasks.find(item => item.id === taskId);
      if (!task || task.status !== 'approved' || !task.reply) throw new Error('仅已审核回复可填入窗口。');
      const aborter = new AbortController();
      const driver = await createUsbWindowsDriver({ kind: 'window', id: sourceId, name: selected.name }, scriptPath, usbDevice, aborter.signal, createReplyModel(await service.desktopModelCredentials()).readIme);
      try { await driver.activate(); await driver.execute({ kind: 'type', text: task.reply }); }
      finally { aborter.abort(); driver.close?.(); await usbDevice.disarm(); }
      return { ok: true, message: 'USB 已逐键输入并停止，请在目标窗口核对正文后自行发送。' };
    }),
  });
  ipcMain.handle('flowdesk:paste-draft', async (event, taskId: unknown, sourceId: unknown) => {
    trusted(event); void taskId; void sourceId;
    throw new Error('软件粘贴已禁用；请连接匹配的 FlowDesk Pico 并使用 USB 审核输入。');
  });
  const window = await createWindow();
  window.on('closed', () => { media?.dispose(); computerUse.cancelPendingStart(); replies?.cancelPendingStart(); computerUse.dispose(); void replies?.dispose(); });
  let closing = false;
  app.on('before-quit', event => {
    if (closing) return; event.preventDefault(); closing = true;
    media?.dispose(); computerUse.cancelPendingStart(); replies?.cancelPendingStart(); computerUse.dispose();
    void Promise.all([replies?.dispose(), computerUse.controller.waitForIdle(), service.close()]).finally(async () => { await usbDevice.disconnect().catch(() => {}); app.quit(); });
  });
  if (process.argv.includes('--smoke-test')) setTimeout(() => { console.error('FlowDesk smoke test did not receive simulator readiness.'); app.exit(1); }, 10000);
}).catch(() => { console.error('FlowDesk startup failed.'); app.exit(1); });
// Fixture windows close before their async assertions and cleanup finish.
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !fixtureTest) app.quit(); });
