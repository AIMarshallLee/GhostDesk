import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
const env = { ...process.env, FLOWDESK_SMOKE_DIR: await mkdtemp(join(tmpdir(), 'flowdesk-smoke-')) };
delete env.ELECTRON_RUN_AS_NODE;
const modes = [
  ['--gemini-replies', '--gemini-replies-smoke-test', 'FlowDesk Gemini persistent replies smoke passed.', 240000],
  ['--gemini', '--gemini-smoke-test', 'FlowDesk Gemini native smoke passed.', 180000],
  ['--usb-soak', '--usb-soak-test', 'FlowDesk USB replies soak passed.', 370000],
  ['--usb', '--usb-smoke-test', 'FlowDesk USB replies smoke passed.', 120000],
  ['--soak', '--replies-soak-test', 'FlowDesk desktop replies soak passed.', 370000],
  ['--native', '--replies-native-smoke-test', 'FlowDesk desktop replies native smoke passed.', 180000],
  ['--replies', '--replies-smoke-test', 'FlowDesk desktop replies smoke passed.', 120000],
  ['--cu', '--cu-smoke-test', 'FlowDesk Computer Use SDK smoke passed.', 120000],
];
const [, flag, marker, timeout] = modes.find(([option]) => process.argv.includes(option)) ?? ['', '--smoke-test', 'FlowDesk renderer loaded successfully.', 120000];
try {
  const executable = existsSync('node_modules/electron/dist/electron.exe') ? 'node_modules/electron/dist/electron.exe' : 'artifacts/electron/runtime/electron.exe';
  const result = await promisify(execFile)(executable, ['.', flag], { env, windowsHide: true, timeout });
  console.log(result.stdout.trim());
  if (result.stderr.trim()) console.error(result.stderr.trim());
  if (!result.stdout.includes(marker)) throw new Error(`Test exited without its final acceptance marker: ${marker}`);
} catch (error) {
  console.error(error.stdout || '', error.stderr || error.message);
  process.exitCode = 1;
}
