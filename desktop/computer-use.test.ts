import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import type { ComputerUseAction, ComputerUseTarget } from '../shared/computer-use';
import { createComputerUseController } from './computer-use';

// A valid PNG is required because GUIAgent parses the screenshot itself.
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAI0lEQVR4AY3BAQEAAAiAIPP/52qCMPsIJJJIIokkkkgiiSQ6aZoEEMG3DtIAAAAASUVORK5CYII=';
const target: ComputerUseTarget = { id: 'test:fixture', name: 'Fixture', kind: 'test' };
type Reply = string | (() => Promise<string>);

async function fakeModel(replies: Reply[]) {
  const requests: string[] = [];
  const server = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    requests.push(body);
    const next = replies.shift() ?? 'Thought: done\nAction: finished()';
    const content = typeof next === 'function' ? await next() : next;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ id: 'local', object: 'chat.completion', created: 1, model: 'fake', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return { baseUrl: `http://127.0.0.1:${port}/v1`, requests, async close() { await new Promise<void>((resolve) => server.close(() => resolve())); } };
}

function makeController(baseUrl: string, actions: ComputerUseAction[], observe = async () => ({ base64: png, width: 1, height: 1 })) {
  return createComputerUseController({
    getCredentials: async () => ({ baseUrl, model: 'fixture', modelFamily: 'ui-tars' as const, apiKey: 'sentinel-api-key' }),
    createDriver: async () => ({ target, observe, execute: async (action: ComputerUseAction) => { actions.push(action); } }),
    getKnowledge: async () => '仅限本地固定资料',
  });
}
const input = { targetId: target.id, instruction: '只完成本地测试', mode: 'auto' as const, maxSteps: 3, allowModel: true, knowledgeIds: ['fixture'] };

test('真实 GUIAgent 循环在本地 OpenAI 伪服务中执行点击并结束', async (t) => {
  const server = await fakeModel(["Thought: click\nAction: click(start_box='(0,0)')", 'Thought: done\nAction: finished()']);
  t.after(server.close);
  const actions: ComputerUseAction[] = []; const controller = makeController(server.baseUrl, actions);
  const immediate = await controller.start(input);
  assert.equal(immediate.status, 'running');
  await controller.waitForIdle();
  assert.deepEqual(actions, [{ kind: 'click', x: 0, y: 0, button: 'left', count: 1 }], JSON.stringify(controller.state()));
  assert.equal(controller.state().status, 'completed');
  assert.equal(server.requests.length, 2);
  assert.match(server.requests[0], /仅限本地固定资料/);
});

test('越界或未支持动作失败且不会执行', async (t) => {
  const server = await fakeModel(["Thought: bad\nAction: drag(start_box='(0,0)', end_box='(0,0)')"]);
  t.after(server.close);
  const actions: ComputerUseAction[] = []; const controller = makeController(server.baseUrl, actions);
  await controller.start(input); await controller.waitForIdle();
  assert.equal(actions.length, 0); assert.equal(controller.state().status, 'failed');
});

test('SDK 解析出的窗口外坐标被拦截', async (t) => {
  const server = await fakeModel(["Thought: bad\nAction: click(start_box='(100000,0)')"]);
  t.after(server.close);
  const actions: ComputerUseAction[] = []; const controller = makeController(server.baseUrl, actions);
  await controller.start(input); await controller.waitForIdle();
  assert.equal(actions.length, 0); assert.equal(controller.state().status, 'failed');
});

test('恶意格式在 SDK parser 前被拒绝且不会写入 console', async (t) => {
  const sentinel = 'MODEL_RESPONSE_SECRET_SHOULD_NOT_LOG';
  const server = await fakeModel([`Thought: x\nAction: ${sentinel}`]);
  t.after(server.close);
  const actions: ComputerUseAction[] = []; const controller = makeController(server.baseUrl, actions);
  const entries: unknown[][] = []; const original = console.error;
  console.error = (...value: unknown[]) => { entries.push(value); };
  try { await controller.start(input); await controller.waitForIdle(); } finally { console.error = original; }
  assert.equal(actions.length, 0); assert.equal(controller.state().status, 'failed');
  assert.equal(entries.flat().join(' ').includes(sentinel), false);
});

test('动作参数内嵌 Action 标记同样不会进入 SDK parser', async (t) => {
  const sentinel = 'ACTION_MARKER_SECRET_SHOULD_NOT_LOG';
  const server = await fakeModel([`Thought: x\nAction: type(content='Action: ${sentinel}')`]);
  t.after(server.close);
  const actions: ComputerUseAction[] = []; const controller = makeController(server.baseUrl, actions);
  const entries: unknown[][] = []; const original = console.error;
  console.error = (...value: unknown[]) => { entries.push(value); };
  try { await controller.start(input); await controller.waitForIdle(); } finally { console.error = original; }
  assert.equal(actions.length, 0); assert.equal(controller.state().status, 'failed');
  assert.equal(entries.flat().join(' ').includes(sentinel), false);
});

test('一个响应内首个非法动作后跟 type 时不会发生写入', async (t) => {
  const server = await fakeModel(["Thought: bad\nAction: drag(start_box='(0,0)', end_box='(0,0)')\n\ntype(content='must not write')"]);
  t.after(server.close);
  const actions: ComputerUseAction[] = []; const controller = makeController(server.baseUrl, actions);
  await controller.start(input); await controller.waitForIdle();
  assert.equal(actions.length, 0); assert.equal(controller.state().status, 'failed');
});

test('手动模式将输入变为草稿，不触碰驱动', async (t) => {
  const server = await fakeModel(['Thought: draft\nAction: type(content="可复制内容")']);
  t.after(server.close);
  const actions: ComputerUseAction[] = []; const controller = makeController(server.baseUrl, actions);
  await controller.start({ ...input, mode: 'manual' }); await controller.waitForIdle();
  assert.equal(actions.length, 0); assert.equal(controller.state().draft, '可复制内容');
  assert.equal(controller.state().status, 'completed');
});

test('停止会使晚到的模型响应不能写入目标', async (t) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const server = await fakeModel([async () => { await gate; return 'Thought: late\nAction: type(content="late")'; }]);
  t.after(server.close);
  const actions: ComputerUseAction[] = []; const controller = makeController(server.baseUrl, actions);
  await controller.start(input);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(controller.stop().status, 'stopped'); release();
  await controller.waitForIdle();
  assert.equal(actions.length, 0); assert.equal(controller.state().status, 'stopped');
});

test('达到最大步骤数后失败，不会无限循环', async (t) => {
  const server = await fakeModel(['Thought: wait\nAction: wait()', 'Thought: wait\nAction: wait()', 'Thought: wait\nAction: wait()']);
  t.after(server.close);
  const actions: ComputerUseAction[] = []; const controller = makeController(server.baseUrl, actions);
  await controller.start({ ...input, maxSteps: 2 }); await controller.waitForIdle();
  assert.equal(actions.length, 0); assert.equal(controller.state().status, 'needs_help');
});

test('SDK 日志静音，不将密钥写入 console', async (t) => {
  const server = await fakeModel(['Thought: done\nAction: finished()']); const actions: ComputerUseAction[] = [];
  t.after(server.close);
  const entries: unknown[][] = []; const original = console.info;
  console.info = (...value: unknown[]) => { entries.push(value); };
  try { const controller = makeController(server.baseUrl, actions); await controller.start(input); await controller.waitForIdle(); }
  finally { console.info = original; }
  assert.equal(entries.flat().join(' ').includes('sentinel-api-key'), false);
});
