import { spawn } from 'node:child_process';
import { join } from 'node:path';

/**
 * 异步、无阻塞向桌面的 M5Stack CoreS3 硬件伴侣发送状态和通知音效 (Best-effort)
 */
export function notifyHardwareBuddy(cmd: 'thinking' | 'done' | 'error' | 'idle', message: string = ''): void {
  try {
    const pythonExe = 'C:\\Users\\dasea\\AppData\\Local\\Programs\\Python\\Python311\\python.exe';
    const scriptPath = join(__dirname, '..', 'scripts', 'buddy.py');
    const child = spawn(pythonExe, [scriptPath, cmd, message], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  } catch {
    // 忽略异常，确保不阻断主业务流程
  }
}
