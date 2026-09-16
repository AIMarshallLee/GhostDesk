import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createComputerUseController } from './computer-use';

const image = { base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jrVsAAAAASUVORK5CYII=', width: 800, height: 600 };
const input = { targetId: 'fictional', instruction: '仅在虚构测试执行', mode: 'auto' as const, maxSteps: 5, allowModel: true, knowledgeIds: [] };
async function setup(close: () => void | Promise<void> = () => {}) {
  let writes = 0, requests = 0;
  const calls = ['第一项', '第二项'].map((explanation, index) => ({ type: 'function_call', id: `call-${index}`, name: 'type', arguments: {
    intent: '测试', text: explanation, safety_decision: { decision: 'require_confirmation', explanation },
  } }));
  const server = createServer(async (request, response) => {
    for await (const _ of request) { /* drain fictional request */ }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(requests++ === 0 ? { id: 'first', status: 'requires_action', steps: calls }
      : { id: 'done', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: '完成' }] }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const controller = createComputerUseController({
    getCredentials: async () => ({ baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, model: 'fictional', modelFamily: 'gemini', apiKey: 'fictional' }),
    getKnowledge: async () => '',
    createDriver: async () => ({ target: { id: 'fictional', kind: 'test', name: '虚构' }, observe: async () => image, execute: async () => { writes++; }, close }),
  });
  return { controller, writes: () => writes, requests: () => requests, async dispose() {
    controller.stop(); await controller.waitForIdle(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  } };
}
async function until(check: () => boolean) {
  for (let i = 0; i < 200; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error('fictional state timeout');
}

test('native confirmation descriptions are reviewable; stale ID cannot approve next item', async () => {
  const fake = await setup();
  const { controller } = fake;
  const originalNow = Date.now;
  try {
    Date.now = () => 123456789;
    await controller.start(input); await until(() => !!controller.state().pendingConfirmation);
    const first = controller.state().pendingConfirmation!;
    assert.deepEqual(first.actions, ['输入：第一项']); assert.equal(controller.isBusy(), true); assert.equal(fake.writes(), 0);
    try {
      controller.confirm({ id: first.id, approved: true });
      await until(() => !!controller.state().pendingConfirmation);
      const second = controller.state().pendingConfirmation!;
      assert.notEqual(second.id, first.id); assert.deepEqual(second.actions, ['输入：第二项']);
      assert.throws(() => controller.confirm({ id: first.id, approved: true }), /失效/);
      controller.confirm({ id: second.id, approved: false });
    } finally { Date.now = originalNow; }
    await controller.waitForIdle();
    assert.equal(controller.state().status, 'needs_help'); assert.equal(fake.writes(), 0); assert.equal(fake.requests(), 1);
  } finally { Date.now = originalNow; await fake.dispose(); }
});

test('stop during native confirmation clears pending and refuses late approval', async () => {
  const fake = await setup();
  try {
    await fake.controller.start(input); await until(() => !!fake.controller.state().pendingConfirmation);
    const id = fake.controller.state().pendingConfirmation!.id;
    fake.controller.stop(); await fake.controller.waitForIdle();
    assert.equal(fake.controller.state().status, 'stopped'); assert.equal(fake.controller.state().pendingConfirmation, undefined);
    assert.throws(() => fake.controller.confirm({ id, approved: true })); assert.equal(fake.writes(), 0);
  } finally { await fake.dispose(); }
});

test('controller stays busy and waitForIdle waits until asynchronous driver cleanup completes', async () => {
  let release!: () => void; let closing = false;
  const cleanup = new Promise<void>(resolve => { release = resolve; });
  const fake = await setup(async () => { closing = true; await cleanup; });
  try {
    await fake.controller.start(input); await until(() => !!fake.controller.state().pendingConfirmation);
    fake.controller.stop(); await until(() => closing);
    assert.equal(fake.controller.isBusy(), true);
    await assert.rejects(fake.controller.start(input), /已有运行中/);
    let idle = false; const waiting = fake.controller.waitForIdle().then(() => { idle = true; });
    await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(idle, false);
    release(); await waiting; assert.equal(fake.controller.isBusy(), false);
  } finally { release(); await fake.dispose(); }
});
