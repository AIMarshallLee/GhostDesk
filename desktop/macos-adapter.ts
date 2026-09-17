import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export interface MacWindowInfo {
  id: string;
  name: string;
  bundleId?: string;
}

/**
 * Checks if the current execution platform is macOS (Darwin).
 */
export function isMacOS(): boolean {
  return process.platform === 'darwin';
}

/**
 * Translates standard keyboard modifiers and key names across Windows and macOS.
 */
export function translateKeyToMac(key: string): string {
  const lower = key.trim().toLowerCase();
  switch (lower) {
    case 'ctrl':
    case 'control':
      return 'command'; // Command is the primary shortcut modifier on macOS
    case 'alt':
      return 'option';
    case 'win':
    case 'windows':
    case 'super':
      return 'command';
    case 'enter':
      return 'return';
    case 'backspace':
      return 'delete';
    default:
      return lower;
  }
}

/**
 * Generates an AppleScript command to safely focus / activate an application window.
 */
export function getMacOSAppActivateScript(appName: string): string {
  // Strip .app suffix if present and escape quotes
  const cleanName = appName.replace(/\.app$/i, '').replace(/"/g, '\\"');
  return `tell application "${cleanName}" to activate`;
}

/**
 * Discovers Raspberry Pi Pico USB CDC serial ports under macOS (/dev/cu.usbmodem*).
 */
export async function listMacOSUsbSerialPorts(): Promise<string[]> {
  if (!isMacOS()) {
    return [];
  }
  try {
    const { stdout } = await execAsync('ls /dev/cu.usbmodem* 2>/dev/null || true');
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line.startsWith('/dev/cu.usbmodem'));
  } catch {
    return [];
  }
}

/**
 * Safely executes AppleScript via `osascript` with strict timeout using direct binary execution.
 */
export async function executeAppleScript(script: string, timeoutMs: number = 3000): Promise<{ ok: boolean; output: string; error?: string }> {
  if (!isMacOS()) {
    return { ok: false, output: '', error: 'executeAppleScript is only available on macOS.' };
  }

  try {
    const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: timeoutMs });
    return { ok: true, output: stdout.trim() };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { ok: false, output: '', error: errorMsg };
  }
}
