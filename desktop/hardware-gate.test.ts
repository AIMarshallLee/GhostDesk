import test from 'node:test';
import assert from 'node:assert/strict';
import type { UsbDevice } from './usb-device';
import { monitorUsbHardware, requireUsbHardware } from './hardware-gate';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const device = (read: () => Promise<unknown>) => ({ requireHealthy: read }) as unknown as UsbDevice;

test('closed hardware monitor ignores a late failed poll and cannot stop a later task', async () => {
  const health = deferred<unknown>(), started = deferred<void>(); let stops = 0;
  const monitor = monitorUsbHardware(device(() => { started.resolve(); return health.promise; }), () => true, () => { stops++; }, 1);
  try {
    await started.promise;
    monitor.close();
    health.reject(new Error('old connection failed'));
    await tick();
    assert.equal(stops, 0);
  } finally { monitor.close(); }
});

test('hardware monitor never overlaps health checks and stops once on failure', async () => {
  const first = deferred<unknown>(), started = deferred<void>(), stopped = deferred<void>(); let calls = 0, stops = 0;
  const monitor = monitorUsbHardware(device(() => {
    calls++;
    if (calls === 1) { started.resolve(); return first.promise; }
    return Promise.reject(new Error('disconnected'));
  }), () => true, () => { stops++; stopped.resolve(); }, 1);
  try {
    await started.promise;
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(calls, 1);
    first.resolve({ connected: true });
    await stopped.promise;
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(calls, 2); assert.equal(stops, 1);
  } finally { monitor.close(); }
});

test('inactive hardware monitor does not query hardware', async () => {
  let calls = 0;
  const monitor = monitorUsbHardware(device(async () => { calls++; return {}; }), () => false, () => assert.fail('unexpected stop'), 1);
  try { await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(calls, 0); }
  finally { monitor.close(); }
});

test('hardware requirement rejects disconnected devices instead of using cached connection state', async () => {
  let calls = 0;
  await assert.rejects(requireUsbHardware(device(async () => { calls++; throw new Error('disconnected'); })), /disconnected/);
  assert.equal(calls, 1);
});

test('FLOWDESK_DEV_MODE bypasses hardware requirements and monitoring', async () => {
  process.env.FLOWDESK_DEV_MODE = '1';
  try {
    let calls = 0;
    await requireUsbHardware(device(async () => { calls++; throw new Error('disconnected'); }));
    assert.equal(calls, 0, 'did not call device');
    const monitor = monitorUsbHardware(device(async () => { calls++; return {}; }), () => true, () => {}, 1);
    monitor.close();
    assert.equal(calls, 0, 'did not poll device');
  } finally {
    delete process.env.FLOWDESK_DEV_MODE;
  }
});

