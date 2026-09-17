import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export type UsbReply = { id: number; ok: boolean; protocol: 4; device: string; firmware: string; board: string; armed: boolean; session: string; leaseMs: number; error?: string };
type Transport = { request(value: { port: string; frame: string }): Promise<unknown>; close(): void };
type Options = { transport?: Transport; timeoutMs?: number };
export const portOk = (port: string) =>
  (/^COM(?:[1-9]|[1-9]\d{1,3})$/i.test(port) && Number(port.slice(3)) <= 9999) ||
  /^\/dev\/(?:cu|tty)\.(?:usbmodem|usbserial)[\w.-]+$/.test(port) ||
  /^\/dev\/tty(?:USB|ACM)\d+$/.test(port);
const err = (message: string) => new Error(message);

function check(value: unknown, id: number): UsbReply {
  if (!value || typeof value !== 'object') throw err('USB 响应无效'); const v = value as Record<string, unknown>;
  const validDevices = ['FlowDesk USB Bridge', 'GhostDesk USB Bridge'];
  const validBoards = ['pico', 'cores3', 'arduino-universal'];
  if (v.id !== id || v.protocol !== 4 || typeof v.device !== 'string' || !validDevices.includes(v.device) || typeof v.board !== 'string' || !validBoards.includes((v.board as string).toLowerCase()) || typeof v.firmware !== 'string' || !v.firmware || v.firmware.length > 64 || typeof v.armed !== 'boolean' || typeof v.session !== 'string' || (v.session !== '' && !/^[0-9a-f]{16}$/.test(v.session)) || !Number.isInteger(v.leaseMs) || (v.leaseMs as number) < 0 || (v.leaseMs as number) > 10_000 || typeof v.ok !== 'boolean' || (v.error !== undefined && (typeof v.error !== 'string' || v.error.length > 160))) throw err('USB 协议确认无效');
  if (!v.ok) throw err('USB 设备拒绝命令');
  return v as UsbReply;
}
function processTransport(scriptPath: string, signal?: AbortSignal): Transport {
  let child: ChildProcessWithoutNullStreams | undefined; let closed = false; let buffer = ''; let pending: { resolve(v: unknown): void; reject(e: Error): void } | undefined;
  const stop = (message: string) => { if (closed) return; closed = true; pending?.reject(err(message)); pending = undefined; child?.kill(); child = undefined; signal?.removeEventListener('abort', abort); };
  const abort = () => stop('USB 通道已取消');
  const start = () => { if (child) return child; if (closed || signal?.aborted) throw err('USB 通道已关闭'); child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Server'], { windowsHide: true, stdio: 'pipe' }); const p = child; p.stdout.setEncoding('utf8'); p.stdout.on('data', (chunk: string) => { buffer += chunk; if (Buffer.byteLength(buffer) > 4096) return stop('USB 响应无效'); let n; while ((n = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, n).trim(); buffer = buffer.slice(n + 1); if (!line || !pending || Buffer.byteLength(line) > 4096) return stop('USB 响应无效'); try { const value = JSON.parse(line); const resolve = pending.resolve; pending = undefined; resolve(value); } catch { stop('USB 响应无效'); } } }); p.stderr.on('data', () => stop('USB 通道发生错误')); p.once('error', () => stop('USB 通道无法启动')); p.once('exit', () => stop('USB 通道已退出')); return p; };
  signal?.addEventListener('abort', abort, { once: true });
  return { request(value) { if (pending) return Promise.reject(err('USB 通道正在处理请求')); try { const p = start(); return new Promise((resolve, reject) => { pending = { resolve, reject }; p.stdin.write(`${JSON.stringify(value)}\n`, error => { if (error) stop('USB 通道写入失败'); }); }); } catch (e) { return Promise.reject(e); } }, close: () => stop('USB 通道已关闭') };
}
export function createUsbChannel(scriptPath: string, port: string, signal?: AbortSignal, options: Options = {}) {
  if (!portOk(port)) throw err('USB 端口无效'); let id = 0; let closed = false; let active = false; let rejectActive: ((error: Error) => void) | undefined; const transport = options.transport ?? processTransport(scriptPath, signal); const limit = options.timeoutMs ?? 5_000;
  const close = (reason = 'USB 通道已关闭') => { if (closed) return; closed = true; active = false; const reject = rejectActive; rejectActive = undefined; transport.close(); reject?.(err(reason)); signal?.removeEventListener('abort', onAbort); };
  const onAbort = () => close('USB 通道已取消'); signal?.addEventListener('abort', onAbort, { once: true });
  const normalizedPort = port.startsWith('/dev/') ? port : port.toUpperCase();
  return { exchange(command: string): Promise<UsbReply> { if (closed || signal?.aborted) return Promise.reject(err('USB 通道已关闭')); if (active) return Promise.reject(err('USB 通道正在处理请求')); if (typeof command !== 'string' || !command || command.length > 140 || /[\r\n]/.test(command)) return Promise.reject(err('USB 命令无效')); if (id >= 2_147_483_647) { close('USB 命令 ID 已用尽，请重新连接'); return Promise.reject(err('USB 命令 ID 已用尽，请重新连接')); } const requestId = ++id; const frame = `${requestId}\t${command}`; if (frame.length > 160 || /[^\x20-\x7e\t]/.test(frame)) return Promise.reject(err('USB 命令无效')); active = true; return new Promise<UsbReply>((resolve, reject) => { const fail = (message: string) => { if (!active && closed) return; active = false; rejectActive = undefined; close(message); reject(err(message)); }; rejectActive = reject; const timer = setTimeout(() => fail('USB 通道超时'), limit); transport.request({ port: normalizedPort, frame }).then(value => { clearTimeout(timer); if (closed) return; active = false; rejectActive = undefined; if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 4096) return fail('USB 响应无效'); try { resolve(check(value, requestId)); } catch { fail('USB 协议确认无效，请烧录本软件包附带的 0.5 固件。'); } }, () => { clearTimeout(timer); fail('USB 通道失败'); }); }); }, close };
}
