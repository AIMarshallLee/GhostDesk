import { spawn } from 'node:child_process';
import { createNativeChannel } from './native-channel';
import type { ComputerUseAction, ComputerUseTarget } from '../shared/computer-use';

type WindowIdentity = { hwnd: string; pid: number; process: string; processStart: string; title: string; width: number; height: number };
type NativeRequest = { operation: 'inspect' | 'capture' | 'capture-input' | 'activate' | 'execute' | 'check' | 'compile' | 'pointer'; hwnd?: string; bound?: WindowIdentity; action?: ComputerUseAction; x?: number; y?: number };
type NativeResponse = { ok: boolean; error?: string; identity?: WindowIdentity; base64?: string; width?: number; height?: number; pointer?: import('./usb-input').PointerPosition };
type NativeInvoker = (scriptPath: string, request: NativeRequest, signal?: AbortSignal) => Promise<NativeResponse>;

const allowedKeys = new Set(['enter', 'tab', 'backspace', 'delete', 'left', 'right', 'up', 'down', 'home', 'end', 'ctrl+a']);

function fail(message: string): never { throw new Error(`Computer Use: ${message}`); }

function parseHwnd(target: ComputerUseTarget): string {
  if (target.kind !== 'window') fail('target must be a selected window');
  const match = /^window:(\d{1,16}):/.exec(target.id);
  if (!match || BigInt(match[1]) > 0x7fff_ffff_ffff_ffffn) fail('invalid window target id');
  return match[1];
}

function validIdentity(value: unknown): value is WindowIdentity {
  const item = value as Partial<WindowIdentity> | undefined;
  return !!item && /^\d+$/.test(item.hwnd ?? '') && Number.isInteger(item.pid) && item.pid! > 0
    && typeof item.process === 'string' && item.process.length > 0 && typeof item.processStart === 'string'
    && item.processStart.length > 0 && typeof item.title === 'string' && item.title.length > 0
    && Number.isInteger(item.width) && item.width! > 0 && Number.isInteger(item.height) && item.height! > 0;
}

function validateAction(action: ComputerUseAction): void {
  const coordinate = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) fail('coordinates must be normalized between 0 and 1');
  };
  if (action.kind === 'move' || action.kind === 'click') coordinate(action.x, action.y);
  if (action.kind === 'scroll') {
    coordinate(action.x, action.y);
    if (!Number.isInteger(action.amount) || action.amount < 1 || action.amount > 20) fail('scroll amount must be 1..20');
  }
  if (action.kind === 'type' && (action.text.length === 0 || action.text.length > 4096)) fail('text must contain 1..4096 characters');
  if (action.kind === 'key' && !allowedKeys.has(action.key)) fail('key is not permitted');
}

function abortError(): Error { return new Error('Computer Use: operation cancelled'); }

async function invokePowerShell(scriptPath: string, request: NativeRequest, signal?: AbortSignal): Promise<NativeResponse> {
  if (signal?.aborted) throw abortError();
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (error?: Error, value?: NativeResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      error ? reject(error) : resolve(value!);
    };
    const stop = (error: Error) => { child.kill(); finish(error); };
    const onAbort = () => stop(abortError());
    const timeout = setTimeout(() => stop(new Error('Computer Use: native helper timed out after 15 seconds')), 15_000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { if (settled) return; stdout += chunk; if (Buffer.byteLength(stdout, 'utf8') > 24 * 1024 * 1024) stop(new Error('Computer Use: native helper output exceeded 24MB')); });
    child.stderr.on('data', (chunk: string) => { if (!settled) stderr = (stderr + chunk).slice(-64 * 1024); });
    child.once('error', (error) => finish(error));
    child.once('close', (code) => {
      if (settled) return;
      if (code !== 0) {
        try { const failure = JSON.parse(stdout) as NativeResponse; if (failure?.ok === false) return finish(undefined, failure); } catch { /* use bounded diagnostic below */ }
        return finish(new Error(stderr.trim() || `native helper exited ${code}`));
      }
      try { finish(undefined, JSON.parse(stdout) as NativeResponse); } catch { finish(new Error(`invalid native helper response: ${stderr.trim() || stdout.slice(0, 160)}`)); }
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) return onAbort();
    child.stdin.end(JSON.stringify(request));
  });
}

let nativeInvoker: NativeInvoker = invokePowerShell;
/** Test-only seam: accepts a fake invoker; production code never exposes it to renderers. */
export function setWindowsComputerUseInvokerForTests(invoker: NativeInvoker | undefined): void { nativeInvoker = invoker ?? invokePowerShell; }

async function call(scriptPath: string, request: NativeRequest, signal?: AbortSignal, invoke: NativeInvoker = nativeInvoker): Promise<NativeResponse> {
  if (process.platform !== 'win32') fail('Windows Computer Use is unsupported on this platform');
  if (signal?.aborted) throw abortError();
  const response = await invoke(scriptPath, request, signal);
  if (signal?.aborted) throw abortError();
  if (!response || response.ok !== true) fail(response?.error || 'native helper rejected the operation');
  return response;
}

export async function createWindowsComputerUseDriver(target: ComputerUseTarget, scriptPath: string, signal?: AbortSignal, persistent = false): Promise<{
  target: ComputerUseTarget;
  observe(): Promise<{ base64: string; width: number; height: number }>;
  observeInput(): Promise<{ base64: string; width: number; height: number }>;
  execute(action: ComputerUseAction): Promise<void>;
  activate(): Promise<void>;
  focus(): Promise<void>;
  check(): Promise<void>;
  pointer(x: number, y: number): Promise<import('./usb-input').PointerPosition>;
  close(): void;
}> {
  if (!scriptPath) fail('native helper path is required');
  const hwnd = parseHwnd(target);
  const channel = persistent && nativeInvoker === invokePowerShell ? createNativeChannel(scriptPath, signal) : undefined;
  const invoke: NativeInvoker = channel ? async (_path, request) => await channel.call(request) as NativeResponse : nativeInvoker;
  let initial: NativeResponse;
  try { initial = await call(scriptPath, { operation: 'inspect', hwnd }, signal, invoke);
    if (!validIdentity(initial.identity) || initial.identity.hwnd !== hwnd || initial.identity.title !== target.name) fail('selected window identity changed; select it again');
  } catch (error) { channel?.close(); throw error; }
  const bound = initial.identity;

  return {
    target,
    close() { channel?.close(); },
    async check() { await call(scriptPath, { operation: 'check', bound }, signal, invoke); },
    async pointer(x, y) {
      if (![x, y].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) fail('pointer coordinates are invalid');
      const response = await call(scriptPath, { operation: 'pointer', bound, x, y }, signal, invoke);
      const point = response.pointer;
      if (!point || ![point.x, point.y, point.targetX, point.targetY].every(Number.isInteger) || typeof point.inside !== 'boolean') fail('pointer response is invalid');
      return point;
    },
    async observe() {
      const response = await call(scriptPath, { operation: 'capture', bound }, signal, invoke);
      const { base64, width, height } = response;
      if (!base64 || typeof width !== 'number' || typeof height !== 'number' || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) fail('target capture is invalid');
      return { base64, width, height };
    },
    async observeInput() {
      const response = await call(scriptPath, { operation: 'capture-input', bound }, signal, invoke);
      const { base64, width, height } = response;
      if (!base64 || typeof width !== 'number' || typeof height !== 'number' || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) fail('input capture is invalid');
      return { base64, width, height };
    },
    async activate() {
      await call(scriptPath, { operation: 'activate', bound }, signal, invoke);
    },
    async focus() {
      await call(scriptPath, { operation: 'activate', bound }, signal, invoke);
    },
    async execute(action) {
      validateAction(action);
      await call(scriptPath, { operation: 'execute', bound, action }, signal, invoke);
    },
  };
}
