import assert from 'node:assert/strict';
import test from 'node:test';
import { createUsbDevice } from './usb-device';
import type { UsbReply } from './usb-channel';

const reply = (command: string): UsbReply => {
  const [, nonce = ''] = command.split('\t');
  const active = /^(begin|ping|move|click|wheel|paste|key|text)\t/.test(command);
  return { id: 1, ok: true, protocol: 4, device: 'FlowDesk USB Bridge', firmware: 'test', board: 'pico', armed: active, session: active ? nonce : '', leaseMs: active ? 4_000 : 0 };
};
const deferred = <T>() => { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; };

test('连接和查询保持待机，明确软件开始无需实体按钮，停止后可重新开始', async () => {
  const commands: string[] = []; const timers: Array<() => void> = [];
  const device = createUsbDevice('fake', {
    channel: () => ({ exchange: async command => { commands.push(command); return reply(command); }, close() {} }),
    setTimer: callback => { timers.push(callback); return timers.length as never; }, clearTimer() {},
  });
  await device.connect('COM12'); await device.status();
  assert.deepEqual(commands, ['hello', 'status']);
  assert.equal(device.state().armed, false); assert.equal(timers.length, 0);
  const first = await device.begin(); first.check();
  assert.equal(device.state().armed, true);
  const firstToken = device.state().session;
  await first.stop(); assert.equal(device.state().armed, false);
  const second = await device.begin(); second.check();
  assert.notEqual(device.state().session, firstToken);
  await second.stop(); await device.disconnect();
  assert.equal(commands.filter(command => command.startsWith('begin\t')).length, 2);
});

test('硬件健康检查要求匹配的 Pico 协议和固件', async () => {
  const device = createUsbDevice('fake', { channel: () => ({ exchange: async command => ({ ...reply(command), firmware: '0.4.0' }), close() {} }) });
  await device.connect('COM12');
  await assert.rejects(device.requireHealthy(), /设备或固件不匹配/);
  await device.disconnect();
});

test('硬件健康检查每次读实际设备；未连接和拔出不会沿用缓存许可', async () => {
  const commands: string[] = []; let unplugged = false;
  const device = createUsbDevice('fake', { channel: () => ({
    async exchange(command) { commands.push(command); if (unplugged) throw new Error('fictional unplug'); return { ...reply(command), firmware: '0.5.0' }; }, close() {},
  }) });
  await assert.rejects(device.requireHealthy(), /必须连接匹配/); assert.equal(commands.length, 0);
  await device.connect('COM12'); await device.requireHealthy(); await device.requireHealthy();
  assert.deepEqual(commands, ['hello', 'status', 'status']); assert.equal(device.state().connected, true);
  unplugged = true;
  await assert.rejects(device.requireHealthy()); assert.equal(device.state().connected, false);
  await assert.rejects(device.requireHealthy(), /必须连接匹配/);
  assert.equal(commands.some(command => command.startsWith('begin')), false);
  await device.disconnect();
});

test('硬件健康检查拒绝其他主板或协议，且不启动 HID 会话', async () => {
  for (const invalid of [{ board: 'other' }, { protocol: 3 }, { device: 'other' }]) {
    const commands: string[] = [];
    const device = createUsbDevice('fake', { channel: () => ({
      async exchange(command) { commands.push(command); return { ...reply(command), firmware: '0.5.0', ...invalid } as UsbReply; }, close() {},
    }) });
    await device.connect('COM12'); await assert.rejects(device.requireHealthy(), /不匹配/);
    assert.equal(commands.some(command => command.startsWith('begin')), false);
    await device.disconnect();
  }
});

test('心跳确认失效后只停止，不会自动重新开始', async () => {
  const commands: string[] = []; const timers: Array<() => void> = [];
  const device = createUsbDevice('fake', {
    channel: () => ({ exchange: async command => { commands.push(command); return command.startsWith('ping\t') ? reply('disarm') : reply(command); }, close() {} }),
    setTimer: callback => { timers.push(callback); return timers.length as never; }, clearTimer() {},
  });
  await device.connect('COM13'); const session = await device.begin();
  timers.shift()!(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(device.state().armed, false);
  assert.throws(() => session.check(), /停止|失效/);
  assert.equal(commands.filter(command => command.startsWith('begin\t')).length, 1);
  assert.equal(commands.at(-1), 'disarm'); assert.equal(timers.length, 0);
  await device.disconnect();
});

test('连接中断开会使旧连接失效，绝不在断开后重新启用', async () => {
  const hello = deferred<UsbReply>(); const commands: string[] = [];
  const device = createUsbDevice('fake', { channel: () => ({ exchange: async command => { commands.push(command); return command === 'hello' ? hello.promise : reply(command); }, close() {} }) });
  const connecting = device.connect('COM8');
  await Promise.resolve();
  const disconnecting = device.disconnect();
  hello.resolve(reply('hello'));
  await assert.rejects(connecting, /取消/);
  await disconnecting;
  assert.equal(device.state().connected, false);
  assert.equal(device.state().armed, false);
  assert.deepEqual(commands, ['hello', 'disarm']);
});

test('abort 在 begin 中发生会 disarm，旧会话不可继续使用', async () => {
  const commands: string[] = []; const began = deferred<UsbReply>();
  const device = createUsbDevice('fake', { channel: () => ({ exchange: async command => { commands.push(command); if (command === 'status') return reply(command); if (command.startsWith('begin\t')) return began.promise; return reply(command); }, close() {} }) });
  await device.connect('COM9');
  const aborter = new AbortController();
  const beginning = device.begin(aborter.signal);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(commands.some(command => command.startsWith('begin\t')));
  aborter.abort();
  began.resolve(reply(commands.find(command => command.startsWith('begin\t'))!));
  await assert.rejects(beginning, /aborted|取消|停止/);
  assert.equal(commands.filter(command => command === 'disarm').length, 1);
  await assert.rejects(device.begin(aborter.signal), /aborted|取消/);
});

test('心跳只携带当前 lease，stop 会取消排队动作且不会重发', async () => {
  const commands: string[] = []; const timers: Array<() => void> = [];
  const firstMove = deferred<UsbReply>(); let moveCalls = 0;
  const device = createUsbDevice('fake', {
    channel: () => ({ exchange: async command => {
      commands.push(command);
      if (command === 'status') return reply(command);
      if (command.startsWith('move\t')) { moveCalls++; return moveCalls === 1 ? firstMove.promise : reply(command); }
      return reply(command);
    }, close() {} }),
    setTimer: callback => { timers.push(callback as () => void); return timers.length as never; }, clearTimer() {},
  });
  await device.connect('COM10');
  const session = await device.begin();
  const nonce = commands.find(command => command.startsWith('begin\t'))!.split('\t')[1];
  timers.shift()!();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(commands.includes(`ping\t${nonce}`));
  const one = session.command('move\t1\t0');
  const two = session.command('move\t2\t0');
  await Promise.resolve();
  const stopping = session.stop();
  firstMove.resolve(reply(`move\t${nonce}\t1\t0`));
  await assert.rejects(one, /停止|授权/);
  await assert.rejects(two, /停止|授权/);
  await stopping;
  assert.equal(commands.filter(command => command.startsWith('move\t')).length, 1);
  const staleHeartbeat = timers.shift(); staleHeartbeat?.(); await Promise.resolve();
  assert.equal(commands.filter(command => command.startsWith('ping\t')).length, 1);
});

test('设备命令错误不会 fallback 或重复发送', async () => {
  const commands: string[] = [];
  const device = createUsbDevice('fake', { channel: () => ({ exchange: async command => {
    commands.push(command);
    if (command === 'status') return reply(command);
    if (command.startsWith('paste\t')) throw new Error('wire failed');
    return reply(command);
  }, close() {} }) });
  await device.connect('COM11');
  const session = await device.begin();
  await assert.rejects(session.command('paste'), /wire failed/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(commands.filter(command => command.startsWith('paste\t')).length, 1);
  assert.equal(device.state().armed, false);
  await assert.rejects(session.command('paste'), /停止|授权/);
});
