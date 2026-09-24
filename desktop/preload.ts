import { contextBridge, ipcRenderer } from 'electron';
import type { ApiRequest, CropRect } from '../shared/types.ts';

contextBridge.exposeInMainWorld('flowdesk', {
  media: {
    analyze: (input: import('../shared/media').MediaAnalyzeInput) => ipcRenderer.invoke('flowdesk:media:analyze', input),
    save: (input: import('../shared/media').MediaSaveInput) => ipcRenderer.invoke('flowdesk:media:save', input),
    stop: () => ipcRenderer.invoke('flowdesk:media:stop'),
  },
  desktopReplies: {
    state: () => ipcRenderer.invoke('flowdesk:replies:state'),
    saveConfig: (input: import('../shared/desktop-replies').DesktopReplyConfig) => ipcRenderer.invoke('flowdesk:replies:save-config', input),
    start: (input: import('../shared/desktop-replies').DesktopReplyStart) => ipcRenderer.invoke('flowdesk:replies:start', input),
    pause: () => ipcRenderer.invoke('flowdesk:replies:pause'), stop: () => ipcRenderer.invoke('flowdesk:replies:stop'),
    takeover: (id: string, enabled: boolean) => ipcRenderer.invoke('flowdesk:replies:takeover', id, enabled),
    copy: (id: string) => ipcRenderer.invoke('flowdesk:replies:copy', id),
    resolve: (id: string) => ipcRenderer.invoke('flowdesk:replies:resolve', id),
    selectCandidate: (id: string, candidateId: 'quick' | 'warm' | 'conversion') => ipcRenderer.invoke('flowdesk:replies:select-candidate', id, candidateId),
    preview: (id: string) => ipcRenderer.invoke('flowdesk:replies:preview', id),
    openTestTarget: () => ipcRenderer.invoke('flowdesk:replies:open-test-target'),
    provider: (protocol?: import('../shared/desktop-replies').DesktopReplyConfig['modelProtocol']) => ipcRenderer.invoke('flowdesk:replies:provider', protocol),
    exportReport: () => ipcRenderer.invoke('flowdesk:replies:export-report'),
  },
  computerUse: {
    settings: () => ipcRenderer.invoke('flowdesk:cu:settings'),
    saveSettings: (input: import('../shared/computer-use').ComputerUseSettingsInput) => ipcRenderer.invoke('flowdesk:cu:save-settings', input),
    clearKey: () => ipcRenderer.invoke('flowdesk:cu:clear-key'),
    openTestTarget: () => ipcRenderer.invoke('flowdesk:cu:open-test-target'),
    targets: () => ipcRenderer.invoke('flowdesk:cu:targets'),
    state: () => ipcRenderer.invoke('flowdesk:cu:state'),
    start: (input: import('../shared/computer-use').ComputerUseStart) => ipcRenderer.invoke('flowdesk:cu:start', input),
    stop: () => ipcRenderer.invoke('flowdesk:cu:stop'),
    confirm: (input: { id: string; approved: boolean }) => ipcRenderer.invoke('flowdesk:cu:confirm', input),
    copyDraft: () => ipcRenderer.invoke('flowdesk:cu:copy-draft'),
  },
  request: (request: ApiRequest) => ipcRenderer.invoke('flowdesk:request', request),
  sources: () => ipcRenderer.invoke('flowdesk:sources'),
  capture: (sourceId: string, crop?: CropRect) => ipcRenderer.invoke('flowdesk:capture', sourceId, crop),
  pasteDraft: (taskId: string, sourceId: string) => ipcRenderer.invoke('flowdesk:paste-draft', taskId, sourceId),
  copyText: (text: string) => ipcRenderer.invoke('flowdesk:copy-text', text),
  saveFirmware: () => ipcRenderer.invoke('flowdesk:save-firmware'),
  version: () => ipcRenderer.invoke('flowdesk:version'),
  ...(process.argv.includes('--flowdesk-smoke-renderer') ? { smokeSimulatorRelayReady: () => ipcRenderer.send('flowdesk:smoke-ready') } : {}),
  usb: {
    discover: () => ipcRenderer.invoke('flowdesk:usb-discover'), cancelDiscovery: () => ipcRenderer.invoke('flowdesk:usb-cancel-discovery'),
    ports: () => ipcRenderer.invoke('flowdesk:usb-ports'), connect: (port: string) => ipcRenderer.invoke('flowdesk:usb-connect', port),
    status: () => ipcRenderer.invoke('flowdesk:usb-status'), disconnect: () => ipcRenderer.invoke('flowdesk:usb-disconnect'),
    disarm: () => ipcRenderer.invoke('flowdesk:usb-disarm'), test: (action: 'move' | 'type') => ipcRenderer.invoke('flowdesk:usb-test', action),
    pasteTask: (taskId: string, sourceId: string) => ipcRenderer.invoke('flowdesk:usb-paste-task', taskId, sourceId)
  }
});
