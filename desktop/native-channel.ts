import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export type NativeChannel = { call(request: unknown): Promise<unknown>; close(): void };

const timeoutMs = 15_000;
const maxStdout = 24 * 1024 * 1024;

export function createNativeChannel(scriptPath: string, signal?: AbortSignal): NativeChannel {
  let child: ChildProcessWithoutNullStreams | undefined;
  let closed = false;
  let buffer = '';
  let pending: { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> } | undefined;
  const fail = (message: string) => {
    if (!pending) return;
    const active = pending; pending = undefined; clearTimeout(active.timer); active.reject(new Error(message));
  };
  const onAbort = () => stop('原生通道已取消');
  const stop = (message: string) => { if (closed) return; closed = true; fail(message); child?.kill(); child = undefined; buffer = ''; signal?.removeEventListener('abort', onAbort); };
  const start = () => {
    if (child) return child;
    if (closed || signal?.aborted) throw new Error('原生通道已关闭');
    const process = child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Server'], { windowsHide: true, stdio: 'pipe' });
    process.stdout.setEncoding('utf8'); process.stderr.setEncoding('utf8');
    process.stdout.on('data', (chunk: string) => {
      if (closed) return;
      buffer += chunk;
      if (Buffer.byteLength(buffer, 'utf8') > maxStdout) return stop('原生通道输出超限');
      let lineEnd: number;
      while ((lineEnd = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, lineEnd).replace(/\r$/, ''); buffer = buffer.slice(lineEnd + 1);
        if (!line || !pending) continue;
        try { const value = JSON.parse(line); const active = pending; pending = undefined; clearTimeout(active.timer); active.resolve(value); }
        catch { stop('原生通道响应无效'); }
      }
    });
    process.stderr.on('data', () => stop('原生通道发生错误'));
    process.once('error', () => stop('原生通道无法启动'));
    process.once('exit', () => { if (!closed) stop('原生通道已退出'); });
    return process;
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  return {
    call(request: unknown) {
      if (closed || signal?.aborted) return Promise.reject(new Error('原生通道已关闭'));
      if (pending) return Promise.reject(new Error('原生通道正在处理请求'));
      let line: string;
      try { line = `${JSON.stringify(request)}\n`; } catch { return Promise.reject(new Error('原生通道请求无效')); }
      try { const process = start(); return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => { stop('原生通道请求超时'); reject(new Error('原生通道请求超时')); }, timeoutMs);
        pending = { resolve, reject, timer };
        process.stdin.write(line, 'utf8', (error) => { if (error) stop('原生通道写入失败'); });
      }); } catch (error) { return Promise.reject(error instanceof Error ? error : new Error('原生通道无法启动')); }
    },
    close() { stop('原生通道已关闭'); },
  };
}
