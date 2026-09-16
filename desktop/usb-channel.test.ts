import assert from 'node:assert/strict'; import test from 'node:test'; import { createUsbChannel } from './usb-channel.ts';
const good = (id: number) => ({ id, ok:true, protocol:4, device:'FlowDesk USB Bridge', firmware:'1.0', board:'pico', armed:false, session:'', leaseMs:0 });
test('USB 协议拒绝旧 ID、错误协议和错误确认且不重发', async () => { let calls=0; const channel=createUsbChannel('x','COM12',undefined,{transport:{request:async()=>{ calls++; return good(9); },close(){}}}); await assert.rejects(()=>channel.exchange('hello'),/确认/); assert.equal(calls,1); await assert.rejects(()=>channel.exchange('hello'),/关闭/); });
test('USB 协议单在途、长度和端口限制', async () => { assert.throws(()=>createUsbChannel('x','COM0'),/端口/); let resolve!: (v:unknown)=>void; const c=createUsbChannel('x','com1',undefined,{transport:{request:()=>new Promise(r=>resolve=r),close(){}}}); const p=c.exchange('hello'); await assert.rejects(()=>c.exchange('hello'),/正在处理/); await assert.rejects(()=>c.exchange('x'.repeat(141)),/正在处理/); resolve(good(1)); assert.equal((await p).protocol,4); });
test('USB 协议拒绝协议一、超时和取消，不自动重试', async () => { let calls=0; const old=createUsbChannel('x','COM2',undefined,{transport:{request:async()=>{ calls++; return {...good(1),protocol:1}; },close(){}}}); await assert.rejects(()=>old.exchange('hello'),/确认/); assert.equal(calls,1); const slow=createUsbChannel('x','COM3',undefined,{timeoutMs:5,transport:{request:async()=>new Promise(()=>{}),close(){}}}); await assert.rejects(()=>slow.exchange('hello'),/超时/); const controller=new AbortController(); const aborted=createUsbChannel('x','COM4',controller.signal,{transport:{request:async()=>good(1),close(){} }}); controller.abort(); await assert.rejects(()=>aborted.exchange('hello'),/关闭/); });
test('USB close 和 AbortSignal 会立即拒绝 fake transport 的在途请求', async () => { let release!: (value: unknown) => void; const pending = () => new Promise<unknown>(resolve => { release = resolve; }); const channel = createUsbChannel('x', 'COM5', undefined, { transport: { request: pending, close() {} } }); const call = channel.exchange('hello'); channel.close(); await assert.rejects(() => call, /关闭/); release(good(1)); const controller = new AbortController(); const aborted = createUsbChannel('x', 'COM6', controller.signal, { transport: { request: pending, close() {} } }); const second = aborted.exchange('hello'); controller.abort(); await assert.rejects(() => second, /取消/); });
test('USB ACK 限制 session、firmware 与响应大小', async () => { for (const response of [{ ...good(1), session: 'UPPERCASE00000000' }, { ...good(1), firmware: 'x'.repeat(65) }, { ...good(1), firmware: 'x'.repeat(4097) }]) { const c = createUsbChannel('x', 'COM7', undefined, { transport: { request: async () => response, close() {} } }); await assert.rejects(() => c.exchange('hello'), /协议|响应/); } });

test('软件控制版拒绝要求实体按钮的旧协议二固件', async () => {
  let requests = 0;
  const channel = createUsbChannel('fake', 'COM8', undefined, { transport: { async request() { requests++; return { ...good(1), protocol: 2, firmware: '0.3.0' }; }, close() {} } });
  await assert.rejects(channel.exchange('hello'), /0\.5 固件/);
  await assert.rejects(channel.exchange('begin\t0123456789abcdef'), /关闭/);
  assert.equal(requests, 1);
});

test('逐键版拒绝缺少输入法按键的旧协议三固件', async () => {
  const channel = createUsbChannel('fake', 'COM9', undefined, { transport: { async request() { return { ...good(1), protocol: 3, firmware: '0.4.0' }; }, close() {} } });
  await assert.rejects(channel.exchange('hello'), /0\.5 固件/);
  await assert.rejects(channel.exchange('begin\t0123456789abcdef'), /关闭/);
});
