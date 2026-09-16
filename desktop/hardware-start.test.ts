import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';

// Execute the real IPC registration modules with fake Electron, controllers and
// a deferred hardware check. No native window, COM port, credential or model.
async function registration(kind: 'cu' | 'replies') {
  const handlers = new Map<string, (...args: any[]) => any>();
  let release!: () => void, healthStarted!: () => void, starts = 0, monitorCloses = 0;
  const health = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { healthStarted = resolve; });
  const controller = { state: () => ({ status: 'stopped', busy: false, config: { inputBackend: 'usb' } }),
    isBusy: () => false, start: async () => { starts++; return {}; }, stop: async () => ({}), pause: async () => ({}),
    close: async () => {}, saveConfig: async (value: any) => { if (value?.invalid) throw new Error('invalid config'); return {}; },
    takeover: async (value: any) => { if (value?.invalid) throw new Error('invalid conversation'); return {}; },
  };
  const modules: Record<string, any> = {
    electron: { ipcMain: { handle: (name: string, callback: (...args: any[]) => any) => handlers.set(name, callback) }, clipboard: {} },
    './computer-use.ts': { createComputerUseController: () => controller },
    './cu-settings.ts': { createComputerUseSettings: async () => ({ credentials: async () => ({}), settings: async () => ({}), save: async () => ({}), clearKey: async () => ({}) }) },
    './desktop-replies': { createDesktopReplies: async () => controller },
    './hardware-gate': { requireUsbHardware: async () => { healthStarted(); await health; }, monitorUsbHardware: () => ({ close() { monitorCloses++; } }) },
  };
  const source = await readFile(new URL(`./${kind === 'cu' ? 'cu' : 'replies'}-ipc.ts`, import.meta.url), 'utf8');
  const compiled = transformSync(source, { loader: 'ts', format: 'cjs', target: 'node20' }).code;
  const exports = {};
  const context = { exports, module: { exports }, require: (name: string) => modules[name] ?? {}, structuredClone, Map, Set, URL };
  runInNewContext(compiled, context);
  const register = (context.module.exports as any)[kind === 'cu' ? 'registerComputerUse' : 'registerDesktopReplies'];
  const api = await register({ trusted() {}, assertOtherIdle() {}, usbDevice: {}, secrets: {}, directory: 'unused', scriptPath: 'unused' });
  const invoke = (name: string, ...args: unknown[]) => handlers.get(`flowdesk:${kind}:${name}`)!({}, ...args);
  return { api, invoke, entered, release, starts: () => starts, monitorCloses: () => monitorCloses };
}

for (const action of ['save-config', 'takeover']) test(`failed replies ${action} keeps its hardware monitor attached`, async () => {
  const f = await registration('replies');
  const starting = f.invoke('start', { inputBackend: 'usb' });
  await f.entered; f.release(); await starting;
  await assert.rejects(f.invoke(action, { invalid: true }), /invalid/);
  assert.equal(f.monitorCloses(), 0);
  await f.api.dispose();
});

for (const kind of ['cu', 'replies'] as const) {
  const cancellations = kind === 'cu' ? ['stop', 'external', 'save-settings'] : ['stop', 'pause', 'external', 'save-config', 'takeover'];
  for (const cancel of cancellations) test(`${kind} hardware-wait start cannot revive after ${cancel}`, async () => {
    const f = await registration(kind);
    const starting = f.invoke('start', { inputBackend: 'usb' });
    await f.entered;
    if (cancel === 'external') f.api.cancelPendingStart(); // same method used by lock, suspend and disposal
    else await f.invoke(cancel, {});
    f.release();
    await assert.rejects(starting, /启动已取消/);
    assert.equal(f.starts(), 0);
    await f.api.dispose();
  });
  test(`${kind} healthy uncancelled startup reaches its controller once`, async () => {
    const f = await registration(kind);
    const starting = f.invoke('start', { inputBackend: 'usb' });
    await f.entered; f.release(); await starting;
    assert.equal(f.starts(), 1); await f.api.dispose();
  });
}
