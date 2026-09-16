import { ipcMain } from 'electron';
import type { AppState } from '../shared/types';
import type { GeminiCredentials } from './gemini-client';
import type { UsbDevice } from './usb-device';
import { monitorUsbHardware, requireUsbHardware } from './hardware-gate';
import { createGeminiMediaController } from './gemini-media';

export function registerGeminiMediaIpc(options: {
  saveDraft(data: { title: string; input: string; reply: string; knowledgeIds: string[]; sourceName: string }): Promise<{ id: string }>;
  getCredentials(): Promise<GeminiCredentials>; getWorkspace(): Promise<AppState>; usbDevice: UsbDevice;
  trusted(event: Electron.IpcMainInvokeEvent): void; assertIdle(): void;
}) {
  const controller = createGeminiMediaController({ ...options,
    checkHardware: () => requireUsbHardware(options.usbDevice),
    watchHardware: stop => monitorUsbHardware(options.usbDevice, controller.isActive, stop),
  });
  ipcMain.handle('flowdesk:media:analyze', (event, input) => { options.trusted(event); return controller.analyze(input); });
  ipcMain.handle('flowdesk:media:save', (event, input) => { options.trusted(event); return controller.save(input); });
  ipcMain.handle('flowdesk:media:stop', event => { options.trusted(event); controller.stop(); });
  return { ...controller, dispose: () => { controller.stop(); ipcMain.removeHandler('flowdesk:media:analyze'); ipcMain.removeHandler('flowdesk:media:save'); ipcMain.removeHandler('flowdesk:media:stop'); } };
}
