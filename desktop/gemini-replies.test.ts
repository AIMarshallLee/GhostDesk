import test from 'node:test';
import assert from 'node:assert/strict';

import { createGeminiRepliesFixture as fixture } from './gemini-replies-fixture';
const call = (name: string, args: object, id = 'call') => ({ type: 'function_call', id, name, arguments: { intent: 'fictional permitted step', ...args } });

test('loopback native persistent surface handles two fictional conversations using same key for scene, generation, IME and actual native actions', async () => {
  const f = await fixture();
  try {
    for (const name of f.names) {
      const conversation = { id: name, name, enabled: true };
      const before = await f.surface.observe(conversation, f.signal);
      const reply = await f.model.generate({ conversation, incoming: before.messages, history: [], knowledge: '', instructions: '' }, f.signal);
      await f.model.readIme(f.image(), f.signal);
      const result = await f.surface.deliver(conversation, before, reply, f.signal);
      assert.equal(result.status, 'visually_confirmed');
    }
    assert.equal(f.writes.filter(a => a.kind === 'type').length, 2);
    assert.equal(f.writes.filter(a => a.kind === 'click' && a.y > .89).length, 2);
    const nativeRequests = f.requests.filter(r => r.body.tools);
    assert.equal(nativeRequests.length, f.writes.length * 2);
    for (const req of f.requests) { assert.equal(req.key, 'fictional-only'); assert.equal(req.path, '/v1beta/interactions'); }
    for (let i = 0; i < nativeRequests.length; i += 2) {
      assert.equal(nativeRequests[i].body.tools[0].type, 'computer_use');
      assert.ok(nativeRequests[i + 1].body.input.some((s: any) => s.type === 'function_call'));
      assert.ok(nativeRequests[i + 1].body.input.some((s: any) => s.type === 'function_result' && s.result.some((b: any) => b.type === 'image')));
    }
  } finally { await f.close(); }
});

for (const [name, mutate] of Object.entries({
  'unapproved text': (_calls: any[]) => [call('type', { text: '注入文本' })],
  'duplicate sends': (calls: any[]) => [calls[0], { ...calls[0], id: 'call2' }],
  'outside region': (_calls: any[]) => [call('click', { x: 999, y: 1 })],
  'confirmation': (calls: any[]) => [{ ...calls[0], arguments: { ...calls[0].arguments, safety_decision: { decision: 'require_confirmation', explanation: 'human needed' } } }],
  'enter shortcut': (_calls: any[]) => [call('press_key', { key: 'Enter' })],
})) test(`native persistent rejects ${name} before any input`, async () => {
  const f = await fixture(mutate);
  try { await assert.rejects(f.native.execute({ kind: 'click', x: .88, y: .93, count: 1, button: 'left' })); assert.equal(f.writes.length, 0); }
  finally { await f.close(); }
});

test('native persistent rejects screen changes during model wait', async () => {
  const f = await fixture(undefined, true);
  try { await assert.rejects(f.native.execute({ kind: 'click', x: .88, y: .93, count: 1, button: 'left' })); assert.equal(f.writes.length, 0); }
  finally { await f.close(); }
});

test('cancellation while native USB execute is suspended stops subsequent HID and awaits disarm', async () => {
  const { createServer } = await import('node:http');
  const { createUsbInputDriver } = await import('./usb-input');
  const { createGeminiRepliesDriver } = await import('./gemini-replies');
  const controller = new AbortController();
  let requests = 0, stops = 0, observerCloses = 0;
  let entered!: () => void, finishReport!: () => void, finishDisarm!: () => void;
  const firstReport = new Promise<void>(resolve => { entered = resolve; });
  const reportAck = new Promise<void>(resolve => { finishReport = resolve; });
  const disarmAck = new Promise<void>(resolve => { finishDisarm = resolve; });
  const frames: string[] = [];
  const image = { base64: Buffer.from('fictional stable capture').toString('base64'), width: 1000, height: 700 };
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) { /* Drain the fictional SDK request. */ }
    requests++;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ id: 'pending-type', status: 'requires_action', steps: [call('type', { text: 'AB', press_enter: false })] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as import('node:net').AddressInfo).port;
  const usb = createUsbInputDriver({ signal: controller.signal,
    observer: { target: { id: 'fictional-usb', name: '虚构窗口', kind: 'test' }, activate: async () => {}, check: async () => {}, observe: async () => image,
      pointer: async () => ({ x: 0, y: 0, targetX: 0, targetY: 0, inside: true }), close: async () => { observerCloses++; } },
    begin: async () => ({ check() {}, async command(frame) { frames.push(frame); entered(); await reportAck; }, async stop() { stops++; await disarmAck; } }),
    typeText: async (value, command) => { for (const character of value) await command(`text\t${character}`); },
  });
  const native = createGeminiRepliesDriver(usb, { baseUrl: `http://127.0.0.1:${port}`, model: 'gemini-fictional', apiKey: 'fictional-only' }, controller.signal);
  let settled = false;
  try {
    await native.activate();
    const pending = native.execute({ kind: 'type', text: 'AB' });
    const rejected = assert.rejects(pending);
    void pending.then(() => { settled = true; }, () => { settled = true; });
    await firstReport; // The first HID report was already issued and cannot be recalled.
    controller.abort();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(stops, 1);
    assert.equal(settled, false, 'native wrapper must retain ownership while disarm is outstanding');
    finishReport();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(frames, ['text\tA'], 'no B, Enter or send may follow cancellation');
    assert.equal(requests, 1, 'no screenshot result or follow-up model request after cancellation');
    finishDisarm(); await rejected;
    assert.equal(observerCloses, 1);
    await assert.rejects(native.execute({ kind: 'click', x: .88, y: .93, button: 'left', count: 1 }));
    assert.deepEqual(frames, ['text\tA']);
  } finally {
    controller.abort(); finishReport(); finishDisarm(); await usb.close?.();
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
