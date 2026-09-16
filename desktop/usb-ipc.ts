import { dialog, ipcMain, type BrowserWindow } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, copyFile } from 'node:fs/promises';
import type { UsbDevice } from './usb-device';
import { createWindowsComputerUseDriver } from './cu-windows';
import { createUsbDiscovery, parseFlowDeskUsbRecords, windowsFlowDeskMetadataScript } from './usb-discovery';

export function registerUsbIpc(options: {
  trusted(event: Electron.IpcMainInvokeEvent): void; getWindow(): BrowserWindow | undefined;
  device: UsbDevice; scriptPath: string; firmwarePath: string; offlineTest?: boolean;
  idle(): void; stop(): Promise<void>; exclusive<T>(action: () => Promise<T>): Promise<T>;
  pasteTask(taskId: unknown, sourceId: unknown): Promise<{ ok: boolean; message: string }>;
}) {
  const { device } = options;
  const discovery = createUsbDiscovery({
    device,
    canConnect: () => { try { options.idle(); return true; } catch { return false; } },
    async list() {
      if (options.offlineTest || process.platform !== 'win32') return [];
      const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', windowsFlowDeskMetadataScript], { windowsHide: true, timeout: 5000, maxBuffer: 128000 });
      return parseFlowDeskUsbRecords(stdout.trim() ? JSON.parse(stdout) : []);
    },
  });
  const handle = (name: string, action: (...args: any[]) => unknown) => ipcMain.handle(`flowdesk:${name}`, (event, ...args) => { options.trusted(event); return action(...args); });
  handle('save-firmware', async () => {
    const window = options.getWindow(); if (!window) throw new Error('FlowDesk 窗口不可用。');
    await access(options.firmwarePath);
    const result = await dialog.showSaveDialog(window, { title: '保存 Pico RP2040 固件 0.5', defaultPath: 'FlowDesk-Pico-RP2040.uf2', filters: [{ name: 'RP2040 UF2', extensions: ['uf2'] }] });
    if (result.canceled || !result.filePath) return { saved: false };
    await copyFile(options.firmwarePath, result.filePath); return { saved: true, path: result.filePath };
  });
  handle('usb-ports', async () => {
    options.idle(); if (options.offlineTest || process.platform !== 'win32') return [];
    const script = "Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match '\\(COM[1-9][0-9]{0,3}\\)' } | ForEach-Object { [pscustomobject]@{ path = ([regex]::Match($_.Name, 'COM[1-9][0-9]{0,3}')).Value; label = $_.Name } } | ConvertTo-Json -Compress";
    const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script], { windowsHide: true, timeout: 5000, maxBuffer: 128000 });
    const result = stdout.trim() ? JSON.parse(stdout) : [];
    return (Array.isArray(result) ? result : [result]).filter(item => /^COM[1-9][0-9]{0,3}$/.test(item.path) && typeof item.label === 'string').map(item => ({ path: item.path, label: item.label }));
  });
  handle('usb-connect', async (port: string) => { if (options.offlineTest) throw new Error('隔离界面测试禁止连接实体串口。'); await discovery.cancel(); options.idle(); return device.connect(port); });
  handle('usb-discover', () => discovery.refresh());
  handle('usb-cancel-discovery', () => discovery.cancel());
  handle('usb-status', () => device.status());
  handle('usb-disarm', async () => { await discovery.cancel(); await options.stop(); return device.disarm(); });
  handle('usb-disconnect', async () => { await discovery.cancel(); await options.stop(); await device.disconnect(); });
  handle('usb-test', (action: unknown) => options.exclusive(async () => {
    if (!['move', 'type'].includes(action as string)) throw new Error('USB 测试动作无效。');
    await device.requireHealthy();
    const window = options.getWindow(); if (!window || !window.isFocused()) throw new Error('请保持 FlowDesk 测试窗口在前台。');
    if (action === 'type' && !await window.webContents.executeJavaScript("document.activeElement?.id === 'hardware-test-input'")) throw new Error('请先聚焦 USB 测试输入框。');
    const hwnd = window.getNativeWindowHandle().readBigUInt64LE().toString();
    const driver = await createWindowsComputerUseDriver({ kind: 'window', id: `window:${hwnd}:0`, name: window.getTitle() }, options.scriptPath, undefined, true);
    let session: Awaited<ReturnType<UsbDevice['begin']>> | undefined;
    try {
      await driver.check(); session = await device.begin(); await driver.check();
      if (action === 'type' && !await window.webContents.executeJavaScript("document.activeElement?.id === 'hardware-test-input'")) throw new Error('测试输入框焦点已变化，请重新聚焦后再测试。');
      await session.command(action === 'type' ? 'text\tFlowDesk' : 'move\t12\t0');
      await driver.check();
    } finally { try { await session?.stop(); } finally { driver.close(); } }
    return { ...device.state(), message: '已完成单次自检并停止。' };
  }));
  handle('usb-paste-task', options.pasteTask);
}
