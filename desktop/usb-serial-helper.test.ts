import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';

test('USB serial helper test seam never opens a real COM port', () => {
  const run = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', resolve('desktop/usb-channel.ps1'), '-Test'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /usb-channel-test-ok/);
});
