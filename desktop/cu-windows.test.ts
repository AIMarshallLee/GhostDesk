import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import test from 'node:test';
import type { ComputerUseTarget } from '../shared/computer-use';
import { createWindowsComputerUseDriver, setWindowsComputerUseInvokerForTests } from './cu-windows';

const target: ComputerUseTarget = { id: 'window:123:fixture', name: 'Fixture', kind: 'window' };
const identity = { hwnd: '123', pid: 55, process: 'fixture', processStart: '2026-09-14T00:00:00.0000000Z', title: 'Fixture', width: 800, height: 600 };

function capturePlan(rect: { left: number; top: number; right: number; bottom: number }, desktop: { left: number; top: number; width: number; height: number }) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(process.cwd(), 'desktop', 'cu-native.ps1')], {
    input: JSON.stringify({ operation: 'compile', rect, desktop }), encoding: 'utf8', windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as { ok: boolean; plan: number[] | null };
}

test('Windows CU rejects a reused or renamed handle before activation or capture', async () => {
  const operations: string[] = [];
  setWindowsComputerUseInvokerForTests(async (_path, request) => { operations.push(request.operation); return { ok: true, identity: { ...identity, title: 'Another window' } }; });
  try {
    await assert.rejects(createWindowsComputerUseDriver(target, 'helper.ps1'), /identity changed/);
    assert.deepEqual(operations, ['inspect']);
  } finally { setWindowsComputerUseInvokerForTests(undefined); }
});

test('Windows CU rejects malformed targets before native invocation', async () => {
  const original = process.platform;
  Object.defineProperty(process, 'platform', { value: 'win32' });
  let invoked = false;
  setWindowsComputerUseInvokerForTests(async () => { invoked = true; return { ok: true, identity }; });
  await assert.rejects(createWindowsComputerUseDriver({ ...target, id: 'window:bad' }, 'helper.ps1'), /invalid window target/);
  assert.equal(invoked, false);
  Object.defineProperty(process, 'platform', { value: original });
  setWindowsComputerUseInvokerForTests(undefined);
});

test('Windows CU binds identity and sends only validated action objects', async () => {
  const original = process.platform;
  Object.defineProperty(process, 'platform', { value: 'win32' });
  const calls: unknown[] = [];
  setWindowsComputerUseInvokerForTests(async (_path, request) => {
    calls.push(request);
    if (request.operation === 'inspect') return { ok: true, identity };
    if (request.operation === 'capture') return { ok: true, base64: 'png', width: 800, height: 600 };
    return { ok: true };
  });
  const driver = await createWindowsComputerUseDriver(target, 'helper.ps1');
  await driver.activate();
  await driver.focus!();
  await driver.observe();
  await driver.execute({ kind: 'click', x: 0.5, y: 0.5, button: 'left', count: 1 });
  await driver.execute({ kind: 'move', x: 0.5, y: 0.5 });
  await assert.rejects(driver.execute({ kind: 'key', key: 'alt+tab' }), /not permitted/);
  await assert.rejects(driver.execute({ kind: 'move', x: 1.1, y: 0.5 }), /coordinates must be normalized/);
  assert.equal(calls.length, 6);
  assert.deepEqual((calls[1] as { bound: unknown }).bound, identity);
  Object.defineProperty(process, 'platform', { value: original });
  setWindowsComputerUseInvokerForTests(undefined);
});

test('Windows CU input observation uses the bounded capture-input operation only', async () => {
  const original = process.platform;
  Object.defineProperty(process, 'platform', { value: 'win32' });
  const calls: Array<{ operation: string; bound?: unknown }> = [];
  setWindowsComputerUseInvokerForTests(async (_path, request) => {
    calls.push(request);
    if (request.operation === 'inspect') return { ok: true, identity };
    if (request.operation === 'capture-input') return { ok: true, base64: 'ime-png', width: 800, height: 600 };
    throw new Error(`unexpected operation ${request.operation}`);
  });
  try {
    const driver = await createWindowsComputerUseDriver(target, 'helper.ps1');
    assert.deepEqual(await driver.observeInput(), { base64: 'ime-png', width: 800, height: 600 });
    assert.deepEqual(calls.map(call => call.operation), ['inspect', 'capture-input']);
    assert.deepEqual(calls[1].bound, identity);
  } finally {
    Object.defineProperty(process, 'platform', { value: original });
    setWindowsComputerUseInvokerForTests(undefined);
  }
});

test('native input capture plan preserves selected-window coordinates while clipping only to the virtual desktop', () => {
  const maximized = capturePlan({ left: -8, top: -8, right: 1928, bottom: 1088 }, { left: 0, top: 0, width: 1920, height: 1080 });
  assert.equal(maximized.ok, true); assert.deepEqual(maximized.plan, [0, 0, 1920, 1080, 8, 8]);
  const negativeMonitor = capturePlan({ left: -1930, top: 20, right: -100, bottom: 1000 }, { left: -1920, top: 0, width: 3840, height: 1080 });
  assert.equal(negativeMonitor.ok, true); assert.deepEqual(negativeMonitor.plan, [-1920, 20, 1820, 980, 10, 0]);
  const outside = capturePlan({ left: 2000, top: 0, right: 2100, bottom: 100 }, { left: 0, top: 0, width: 1920, height: 1080 });
  assert.equal(outside.ok, true); assert.deepEqual(outside.plan, []);
});

test('Windows CU does not invoke native helper when already aborted', async () => {
  const original = process.platform;
  Object.defineProperty(process, 'platform', { value: 'win32' });
  const controller = new AbortController(); controller.abort();
  let invoked = false;
  setWindowsComputerUseInvokerForTests(async () => { invoked = true; return { ok: true, identity }; });
  await assert.rejects(createWindowsComputerUseDriver(target, 'helper.ps1', controller.signal), /operation cancelled/);
  assert.equal(invoked, false);
  Object.defineProperty(process, 'platform', { value: original });
  setWindowsComputerUseInvokerForTests(undefined);
});

test('Windows CU forwards cancellation to an in-flight native invocation', async () => {
  const original = process.platform;
  Object.defineProperty(process, 'platform', { value: 'win32' });
  const controller = new AbortController();
  let sawSignal = false;
  setWindowsComputerUseInvokerForTests(async (_path, _request, signal) => new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => { sawSignal = true; reject(new Error('helper killed')); }, { once: true });
  }));
  const pending = createWindowsComputerUseDriver(target, 'helper.ps1', controller.signal);
  controller.abort();
  await assert.rejects(pending, /helper killed|operation cancelled/);
  assert.equal(sawSignal, true);
  Object.defineProperty(process, 'platform', { value: original });
  setWindowsComputerUseInvokerForTests(undefined);
});
