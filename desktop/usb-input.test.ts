import assert from 'node:assert/strict';
import test from 'node:test';
import { createUsbInputDriver, type PointerPosition } from './usb-input';
import type { UsbSession } from './usb-device';

const target = { id: 'window:1:test', name: 'Fixture', kind: 'window' as const };
const point = (x: number, y: number, targetX = 100, targetY = 100, inside = true): PointerPosition => ({ x, y, targetX, targetY, inside });
function fixture(options: { pointers?: PointerPosition[]; reject?: string; signal?: AbortSignal } = {}) {
  const commands: string[] = []; let stops = 0; let checks = 0; let typedText = ''; let begins = 0; let activations = 0;
  const pointers = [...(options.pointers ?? [point(0, 0), point(100, 100), point(100, 100)])];
  const session: UsbSession = { check() {}, async command(value) { commands.push(value); if (options.reject && value.startsWith(options.reject)) throw new Error('transport failed'); }, async stop() { stops++; } };
  const driver = createUsbInputDriver({
    signal: options.signal, begin: async () => { begins++; return session; }, delay: async () => {},
    observer: { target, async activate() { activations++; }, async check() { checks++; }, async observe() { return { base64: 'png', width: 1, height: 1 }; }, async pointer() { return pointers.shift() ?? point(100, 100); }, close() {} },
    typeText: async (text, command) => { typedText = text; for (const char of text) await command('text\t' + char); },
  });
  return { driver, commands, session, stats: () => ({ stops, checks, typedText, begins, activations }) };
}

test('USB 指针按反馈修正加速偏差，再在稳定位置点击', async () => {
  const f = fixture({ pointers: [point(0, 0), point(100, 100), point(100, 100)] });
  await f.driver.activate();
  await f.driver.execute({ kind: 'click', x: .5, y: .5, button: 'left', count: 1 });
  assert.deepEqual(f.commands, ['move\t33\t33', 'click\tleft']);
});

test('USB move 按实际位置反馈移动，不发送 click', async () => {
  const f = fixture({ pointers: [point(0, 0), point(100, 100)] });
  await f.driver.activate();
  await f.driver.execute({ kind: 'move', x: .5, y: .5 });
  assert.deepEqual(f.commands, ['move\t33\t33']);
});

test('USB focus 重新激活既有会话，不重复 begin，停止后拒绝', async () => {
  const f = fixture();
  await f.driver.activate();
  const focus = f.driver.focus;
  if (!focus) throw new Error('USB driver 未提供 focus。');
  await focus();
  assert.equal(f.stats().begins, 1);
  assert.equal(f.stats().activations, 2);
  const close = f.driver.close;
  if (!close) throw new Error('USB driver 未提供 close。');
  close();
  await assert.rejects(focus(), /停止/);
});

test('USB close 等待释放且重复关闭只停止一次', async () => {
  let release!: () => void; const stopped = new Promise<void>(resolve => { release = resolve; });
  let stops = 0, observerCloses = 0;
  const driver = createUsbInputDriver({
    begin: async () => ({ check() {}, async command() {}, async stop() { stops++; await stopped; } }),
    observer: { target, async activate() {}, async check() {}, async observe() { return { base64: 'png', width: 1, height: 1 }; }, async pointer() { return point(0, 0); }, async close() { observerCloses++; } },
  });
  await driver.activate();
  const close = driver.close;
  if (!close) throw new Error('USB driver 未提供 close。');
  const first = Promise.resolve(close()); const second = Promise.resolve(close());
  assert.equal(stops, 1); assert.equal(observerCloses, 0);
  release(); await Promise.all([first, second]);
  assert.equal(stops, 1); assert.equal(observerCloses, 1);
});

test('USB close 保留给 await 调用方的释放错误', async () => {
  const driver = createUsbInputDriver({
    begin: async () => ({ check() {}, async command() {}, async stop() { throw new Error('release failed'); } }),
    observer: { target, async activate() {}, async check() {}, async observe() { return { base64: 'png', width: 1, height: 1 }; }, async pointer() { return point(0, 0); }, close() {} },
  });
  await driver.activate();
  const close = driver.close;
  if (!close) throw new Error('USB driver 未提供 close。');
  await assert.rejects(Promise.resolve(close()), /release failed/);
});

test('USB begin 返回候选会话时取消，候选会话仍被停止', async () => {
  let releaseBegin!: (session: UsbSession) => void;
  let markBegin!: () => void;
  const started = new Promise<void>(resolve => { markBegin = resolve; });
  let candidateStops = 0, observerCloses = 0;
  const candidate: UsbSession = { check() {}, async command() {}, async stop() { candidateStops++; } };
  const driver = createUsbInputDriver({
    begin: async () => { markBegin(); return await new Promise<UsbSession>(resolve => { releaseBegin = resolve; }); },
    observer: { target, async activate() {}, async check() {}, async observe() { return { base64: 'png', width: 1, height: 1 }; }, async pointer() { return point(0, 0); }, async close() { observerCloses++; } },
  });
  const activation = driver.activate(); await started;
  const close = driver.close;
  if (!close) throw new Error('USB driver 未提供 close。');
  await close(); releaseBegin(candidate);
  await assert.rejects(activation, /启动已取消/);
  assert.equal(candidateStops, 1); assert.equal(observerCloses, 1);
});

test('鼠标位置变化或遮挡时拒绝点击，错误后不会重发', async () => {
  const moved = fixture({ pointers: [point(100, 100), point(95, 100)] });
  await moved.driver.activate();
  await assert.rejects(moved.driver.execute({ kind: 'click', x: .5, y: .5, button: 'left', count: 1 }), /位置已改变/);
  assert.deepEqual(moved.commands, []);
  const failed = fixture({ pointers: [point(100, 100), point(100, 100)], reject: 'click' });
  await failed.driver.activate();
  await assert.rejects(failed.driver.execute({ kind: 'click', x: .5, y: .5, button: 'left', count: 1 }), /transport failed/);
  await assert.rejects(failed.driver.execute({ kind: 'click', x: .5, y: .5, button: 'left', count: 1 }), /停止/);
  assert.equal(failed.commands.filter(command => command === 'click\tleft').length, 1);
});

test('type 交给逐键输入器，abort 后不继续后续动作', async () => {
  const chinese = fixture();
  await chinese.driver.activate();
  await chinese.driver.execute({ kind: 'type', text: 'Hi' });
  assert.deepEqual(chinese.commands, ['text\tH', 'text\ti']);
  assert.deepEqual(chinese.stats(), { stops: 0, checks: chinese.stats().checks, typedText: 'Hi', begins: 1, activations: 1 });

  const aborter = new AbortController(); const paused = fixture({ signal: aborter.signal, pointers: [point(0, 0), point(100, 100), point(100, 100)] });
  await paused.driver.activate(); aborter.abort();
  await assert.rejects(paused.driver.execute({ kind: 'click', x: .5, y: .5, button: 'left', count: 1 }), /aborted|停止/);
  assert.deepEqual(paused.commands, []);
  assert.equal(paused.stats().stops, 1);
});

test('动作执行中暂停会取消后续 HID click', async () => {
  let release!: () => void; const moved = new Promise<void>(resolve => { release = resolve; });
  let moveStarted!: () => void; const started = new Promise<void>(resolve => { moveStarted = resolve; });
  const aborter = new AbortController(); const commands: string[] = []; let stops = 0; let pointerCalls = 0;
  const session: UsbSession = { check() {}, async command(command) { commands.push(command); if (command.startsWith('move')) { moveStarted(); await moved; } }, async stop() { stops++; } };
  const driver = createUsbInputDriver({ signal: aborter.signal, begin: async () => session, delay: async () => {},
    observer: { target, async activate() {}, async check() {}, async observe() { return { base64: 'png', width: 1, height: 1 }; }, async pointer() { pointerCalls++; return pointerCalls === 1 ? point(0, 0) : point(100, 100); }, close() {} },
    
  });
  await driver.activate();
  const action = driver.execute({ kind: 'click', x: .5, y: .5, button: 'left', count: 1 });
  await started;
  aborter.abort(); release();
  await assert.rejects(action, /aborted|停止/);
  assert.deepEqual(commands, ['move\t33\t33']);
  assert.equal(stops, 1);
});
