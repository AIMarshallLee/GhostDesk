import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ComputerUseAction, ComputerUseStart } from '../shared/computer-use';
import { createGeminiClient, createGeminiImeReader, geminiImage } from './gemini-client';
import { runGeminiComputerUse } from './gemini-computer-use';

// Fictional capture and driver only. Every SDK request goes to an ephemeral loopback HTTP server.
const image = { base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jrVsAAAAASUVORK5CYII=', width: 800, height: 600 };
const start: ComputerUseStart = { targetId: 'fictional', instruction: '在虚构窗口输入测试草稿', mode: 'auto', maxSteps: 6, allowModel: true, knowledgeIds: [] };
const call = (name: string, args: Record<string, unknown>, id = 'call-1') => ({ type: 'function_call', id, name, arguments: { intent: '虚构测试动作', ...args } });
const complete = (text = '虚构任务完成') => ({ id: 'interaction-final', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text }] }] });
const action = (...steps: unknown[]) => ({ id: 'interaction-actions', status: 'requires_action', steps });
type Request = { path: string; headers: Record<string, unknown>; body: any };

async function server(replies: unknown[] | ((response: ServerResponse, index: number) => void)) {
  const requests: Request[] = [];
  const http = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push({ path: request.url!, headers: request.headers, body: JSON.parse(Buffer.concat(chunks).toString()) });
    if (typeof replies === 'function') replies(response, requests.length - 1);
    else { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(replies[requests.length - 1] ?? complete())); }
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const credentials = { baseUrl: `http://127.0.0.1:${(http.address() as AddressInfo).port}`, model: 'gemini-3.8-flash', apiKey: 'fictional-loopback-key' };
  return { requests, credentials, async close() { http.closeAllConnections(); await new Promise<void>((resolve) => http.close(() => resolve())); } };
}

function fixture(credentials: { baseUrl: string; model: string; apiKey: string }) {
  const writes: ComputerUseAction[] = [];
  const drafts: string[] = [];
  const records: unknown[] = [];
  const aborter = new AbortController();
  const options = { credentials, input: { ...start }, knowledge: '', signal: aborter.signal,
    driver: { target: { id: 'fictional', name: '虚构窗口', kind: 'test' as const },
      observe: async () => ({ ...image }), execute: async (value: ComputerUseAction) => { writes.push(value); },
      focus: async () => {}, check: async () => {}, activate: async () => {} },
    record: (...args: unknown[]) => { records.push(args); }, setDraft: (value: string) => { drafts.push(value); },
    confirm: async (_reason: string, _actions: ComputerUseAction[]) => true,
  };
  return { writes, drafts, records, options, aborter };
}

test('official SDK wire uses native desktop tools, stateless full history, IDs, signatures and one screenshot result per call', async () => {
  const thought = { type: 'thought', signature: 'opaque-signature-fixture', summary: [{ type: 'text', text: 'not for UI' }] };
  const first = call('click', { x: 250, y: 750 });
  const second = call('type', { text: '测试草稿', press_enter: false }, 'call-2');
  const fake = await server([action(thought, first, second), complete()]);
  try {
    const f = fixture(fake.credentials);
    const result = await runGeminiComputerUse(f.options);
    assert.equal(result.status, 'completed');
    assert.deepEqual(f.writes, [{ kind: 'click', x: .25, y: .75, button: 'left', count: 1 }, { kind: 'type', text: '测试草稿' }]);
    assert.equal(fake.requests.length, 2);
    const [initial, next] = fake.requests;
    assert.equal(initial.path, '/v1beta/interactions');
    assert.equal(initial.headers['x-goog-api-key'], 'fictional-loopback-key');
    assert.equal(initial.body.store, false);
    assert.equal(initial.body.tools[0].type, 'computer_use');
    assert.equal(initial.body.tools[0].environment, 'desktop');
    assert.equal(initial.body.tools[0].enable_prompt_injection_detection, true);
    assert.ok(initial.body.tools[0].excluded_predefined_functions.includes('drag_and_drop'));
    assert.equal(initial.body.input[0].type, 'user_input');
    assert.deepEqual(initial.body.input[0].content[1], { type: 'image', data: image.base64, mime_type: 'image/png' });
    assert.equal(next.body.store, false);
    assert.equal(next.body.previous_interaction_id, undefined);
    assert.deepEqual(next.body.input.slice(1, 4), [thought, first, second]);
    assert.deepEqual(next.body.input.slice(4).map((item: any) => [item.type, item.call_id, item.name]), [['function_result', 'call-1', 'click'], ['function_result', 'call-2', 'type']]);
    for (const result of next.body.input.slice(4)) assert.deepEqual(result.result[1], initial.body.input[0].content[1]);
    assert.ok(!JSON.stringify(f.records).includes('opaque-signature'));
    assert.ok(!JSON.stringify(f.records).includes('not for UI'));
  } finally { await fake.close(); }
});

test('native supported mappings retain type insert semantics and bounded wheel conversion', async () => {
  const fake = await server([action(call('double_click', { x: 999, y: 0 }, 'a'), call('right_click', { x: 0, y: 999 }, 'b'),
    call('move', { x: 500, y: 500 }, 'c'), call('scroll', { x: 400, y: 300, direction: 'down', magnitude_in_pixels: 999 }, 'd'),
    call('press_key', { key: 'ArrowLeft' }, 'e'), call('hotkey', { keys: ['Control', 'a'] }, 'f'),
    call('type', { text: 'demo', press_enter: true }, 'g')), complete()]);
  try {
    const f = fixture(fake.credentials); f.options.input.maxSteps = 8;
    assert.equal((await runGeminiComputerUse(f.options)).status, 'completed');
    assert.deepEqual(f.writes.map((a) => a.kind), ['click', 'click', 'move', 'scroll', 'key', 'key', 'type', 'key']);
    assert.deepEqual(f.writes[3], { kind: 'scroll', x: .4, y: .3, direction: 'down', amount: 8 });
    assert.deepEqual(f.writes[6], { kind: 'type', text: 'demo' });
    assert.deepEqual(f.writes[7], { kind: 'key', key: 'enter' });
  } finally { await fake.close(); }
});

for (const [label, invalid] of [
  ['unknown action', call('shell', { command: 'bad' }, 'bad')],
  ['legacy action', call('click_at', { x: 10, y: 10 }, 'bad')],
  ['coordinate 1000', call('click', { x: 1000, y: 10 }, 'bad')],
  ['numeric string coordinate', call('click', { x: '100', y: 10 }, 'bad')],
  ['unexpected parameter', call('click', { x: 100, y: 10, clear: true }, 'bad')],
  ['string boolean', call('type', { text: 'x', press_enter: 'false' }, 'bad')],
  ['clipboard hotkey', call('hotkey', { keys: ['Ctrl', 'v'] }, 'bad')],
  ['cross-window key', call('press_key', { key: 'Win' }, 'bad')],
  ['horizontal scroll', call('scroll', { x: 100, y: 10, direction: 'left' }, 'bad')],
  ['unsafe decision', call('click', { x: 100, y: 10, safety_decision: { decision: 'blocked', explanation: 'blocked' } }, 'bad')],
  ['unknown safety decision', call('click', { x: 100, y: 10, safety_decision: { decision: 'actuate', explanation: 'unknown' } }, 'bad')],
  ['duplicate call id', call('click', { x: 100, y: 10 })],
] as const) {
  test(`whole batch rejected before first write: ${label}`, async () => {
    const fake = await server([action(call('click', { x: 20, y: 20 }), invalid)]);
    try {
      const f = fixture(fake.credentials);
      assert.equal((await runGeminiComputerUse(f.options)).status, 'needs_help');
      assert.deepEqual(f.writes, []); assert.equal(fake.requests.length, 1);
    } finally { await fake.close(); }
  });
}

test('manual final text and manual type never operate the driver or request confirmation', async () => {
  for (const response of [complete('手动回复草稿'), action(call('click', { x: 20, y: 20 }), call('type', { text: '手动回复草稿' }, 'b'))]) {
    const fake = await server([response]);
    try {
      const f = fixture(fake.credentials); f.options.input.mode = 'manual';
      f.options.confirm = async () => { throw new Error('must not confirm in manual mode'); };
      assert.equal((await runGeminiComputerUse(f.options)).status, 'completed');
      assert.deepEqual(f.writes, []); assert.deepEqual(f.drafts, ['手动回复草稿']);
    } finally { await fake.close(); }
  }
});

test('explicit confirmation is awaited, refocuses without activating USB again, and acknowledges inside result text', async () => {
  const fake = await server([action(call('click', { x: 20, y: 20, safety_decision: { decision: 'require_confirmation', explanation: '请确认虚构提交' } })), complete()]);
  try {
    const f = fixture(fake.credentials); const events: string[] = [];
    f.options.confirm = async (reason, actions) => { assert.equal(reason, '请确认虚构提交'); assert.equal(actions.length, 1); assert.deepEqual(f.writes, []); events.push('confirm'); return true; };
    f.options.driver.focus = async () => { events.push('focus'); };
    f.options.driver.activate = async () => { throw new Error('must not restart USB'); };
    f.options.driver.check = async () => { events.push('check'); };
    assert.equal((await runGeminiComputerUse(f.options)).status, 'completed');
    assert.deepEqual(events.slice(0, 3), ['confirm', 'focus', 'check']);
    const result = fake.requests[1].body.input.find((step: any) => step.type === 'function_result');
    assert.equal(JSON.parse(result.result[0].text).safety_acknowledgement, true);
    assert.equal(result.safety_acknowledgement, undefined);
  } finally { await fake.close(); }
});

test('confirmation refusal blocks entire batch including earlier ordinary actions', async () => {
  const fake = await server([action(call('click', { x: 10, y: 10 }), call('click', { x: 20, y: 20,
    safety_decision: { decision: 'require_confirmation', explanation: '确认' } }, 'b'))]);
  try {
    const f = fixture(fake.credentials); f.options.confirm = async () => false;
    assert.equal((await runGeminiComputerUse(f.options)).status, 'needs_help');
    assert.deepEqual(f.writes, []); assert.equal(fake.requests.length, 1);
  } finally { await fake.close(); }
});

test('changed screen after confirmation prevents stale coordinate execution', async () => {
  const fake = await server([action(call('click', { x: 20, y: 20, safety_decision: { decision: 'require_confirmation', explanation: '确认' } }))]);
  try {
    const f = fixture(fake.credentials); let observations = 0;
    f.options.driver.observe = async () => ({ ...image, width: ++observations > 1 ? 801 : 800 });
    assert.equal((await runGeminiComputerUse(f.options)).status, 'needs_help'); assert.deepEqual(f.writes, []);
  } finally { await fake.close(); }
});

test('confirmation tolerates a temporary caret blink only after an exact screenshot recurs', async () => {
  const fake = await server([action(call('click', { x: 20, y: 20, safety_decision: { decision: 'require_confirmation', explanation: '确认' } })), complete()]);
  try {
    const f = fixture(fake.credentials); let observations = 0;
    f.options.driver.observe = async () => ({ ...image, base64: ++observations === 2 ? 'YWJjZA==' : image.base64 });
    assert.equal((await runGeminiComputerUse(f.options)).status, 'completed');
    assert.equal(f.writes.length, 1); assert.equal(observations, 4);
  } finally { await fake.close(); }
});

test('confirmation stops after five same-size but persistently changed captures', async () => {
  const fake = await server([action(call('click', { x: 20, y: 20, safety_decision: { decision: 'require_confirmation', explanation: '确认' } }))]);
  try {
    const f = fixture(fake.credentials); let observations = 0;
    f.options.driver.observe = async () => ({ ...image, base64: ++observations > 1 ? 'YWJjZA==' : image.base64 });
    assert.equal((await runGeminiComputerUse(f.options)).status, 'needs_help');
    assert.deepEqual(f.writes, []); assert.equal(observations, 6); assert.equal(fake.requests.length, 1);
  } finally { await fake.close(); }
});

test('abort during confirmation resampling prevents further captures and writes', async () => {
  const fake = await server([action(call('click', { x: 20, y: 20, safety_decision: { decision: 'require_confirmation', explanation: '确认' } }))]);
  try {
    const f = fixture(fake.credentials); let observations = 0;
    f.options.driver.observe = async () => {
      observations++;
      if (observations > 1) { setImmediate(() => f.aborter.abort()); return { ...image, base64: 'YWJjZA==' }; }
      return { ...image };
    };
    await assert.rejects(runGeminiComputerUse(f.options), { name: 'AbortError' });
    assert.deepEqual(f.writes, []); assert.equal(observations, 2); assert.equal(fake.requests.length, 1);
  } finally { await fake.close(); }
});

test('abort during pending human confirmation prevents any write or follow-up request', async () => {
  const fake = await server([action(call('click', { x: 20, y: 20, safety_decision: { decision: 'require_confirmation', explanation: '确认' } }))]);
  try {
    const f = fixture(fake.credentials);
    f.options.confirm = async () => { setImmediate(() => f.aborter.abort()); return new Promise<boolean>(() => {}); };
    await assert.rejects(runGeminiComputerUse(f.options), { name: 'AbortError' });
    assert.deepEqual(f.writes, []); assert.equal(fake.requests.length, 1);
  } finally { await fake.close(); }
});

test('cancelled HTTP request is not retried and cancellation stays redacted', async () => {
  const controller = new AbortController();
  const fake = await server((response) => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.write('{'); controller.abort(); });
  try {
    const client = createGeminiClient(fake.credentials);
    await assert.rejects(client.request({ input: 'fictional' }, controller.signal), { name: 'AbortError' });
    assert.equal(fake.requests.length, 1);
  } finally { await fake.close(); }
});

test('HTTP 500 is sent once, never retried; provider text and credentials do not escape', async () => {
  const fake = await server((response) => { response.writeHead(500, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: { message: 'provider-secret fictional-loopback-key', code: 500 } })); });
  try {
    const f = fixture(fake.credentials);
    const result = await runGeminiComputerUse(f.options);
    assert.equal(result.status, 'needs_help'); assert.equal(fake.requests.length, 1); assert.deepEqual(f.writes, []);
    assert.ok(!JSON.stringify([result, f.records]).includes('provider-secret'));
    assert.ok(!JSON.stringify([result, f.records]).includes('fictional-loopback-key'));
  } finally { await fake.close(); }
});

test('oversized response and request are rejected without executing', async () => {
  const fake = await server([complete('x'.repeat(600000))]);
  try {
    const f = fixture(fake.credentials);
    assert.equal((await runGeminiComputerUse(f.options)).status, 'needs_help'); assert.deepEqual(f.writes, []);
    const client = createGeminiClient(fake.credentials);
    await assert.rejects(client.request({ input: 'x'.repeat(32_000_001) }, new AbortController().signal));
    assert.equal(fake.requests.length, 1);
    assert.throws(() => geminiImage({ ...image, base64: 'x'.repeat(8_000_001) }));
  } finally { await fake.close(); }
});

test('primitive action limit blocks a type plus Enter batch in advance', async () => {
  const fake = await server([action(call('type', { text: '测试', press_enter: true }))]);
  try {
    const f = fixture(fake.credentials); f.options.input.maxSteps = 1;
    assert.equal((await runGeminiComputerUse(f.options)).status, 'needs_help'); assert.deepEqual(f.writes, []);
  } finally { await fake.close(); }
});

test('driver uncertainty retains proposed draft and does not request new model actions', async () => {
  const fake = await server([action(call('type', { text: '需人工检查的草稿' }))]);
  try {
    const f = fixture(fake.credentials); f.options.driver.execute = async () => { throw new Error('device failure with secret'); };
    assert.equal((await runGeminiComputerUse(f.options)).status, 'needs_help');
    assert.deepEqual(f.drafts, ['需人工检查的草稿']); assert.equal(fake.requests.length, 1);
  } finally { await fake.close(); }
});

test('Gemini IME reader uses native SDK, no tools, store false, and existing strict scene parser', async () => {
  const scene = { focused: true, field: { x: .1, y: .2, width: .5, height: .3 }, text: '', composition: 'ni', candidates: [{ key: '1', text: '你' }], confidence: .99, blocked: false };
  const fake = await server([complete(JSON.stringify(scene)), action(call('click', { x: 20, y: 20 }))]);
  try {
    const reader = createGeminiImeReader(fake.credentials);
    assert.deepEqual(await reader(image, new AbortController().signal), scene);
    const body = fake.requests[0].body;
    assert.equal(body.store, false); assert.equal(body.tools, undefined);
    assert.ok(body.system_instruction.includes('FLOWDESK_IME_SCENE'));
    assert.equal(body.input[0].content[1].data, image.base64);
    await assert.rejects(reader(image, new AbortController().signal));
    const cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(reader(image, cancelled.signal), { name: 'AbortError' });
    assert.equal(fake.requests.length, 2);
  } finally { await fake.close(); }
});

test('invalid endpoint details are redacted and remote plaintext HTTP is rejected', () => {
  for (const baseUrl of ['invalid-secret', 'http://example.com', 'https://user:secret@example.com', 'https://example.com?key=secret']) {
    assert.throws(() => createGeminiClient({ baseUrl, model: 'gemini-3.8-flash', apiKey: 'secret' }), (error: unknown) => {
      assert.equal((error as Error).message, 'Gemini 服务配置无效。');
      assert.equal((error as { input?: string }).input, undefined);
      assert.ok(!JSON.stringify(error).includes('secret')); return true;
    });
  }
});

test('aborting after one call prevents the next call and any new screenshot/model request', async () => {
  const fake = await server([action(call('click', { x: 20, y: 20 }), call('click', { x: 30, y: 30 }, 'b'))]);
  try {
    const f = fixture(fake.credentials); let observations = 0;
    f.options.driver.observe = async () => { observations++; return { ...image }; };
    f.options.driver.execute = async (value) => { f.writes.push(value); f.aborter.abort(); };
    await assert.rejects(runGeminiComputerUse(f.options), { name: 'AbortError' });
    assert.equal(f.writes.length, 1); assert.equal(observations, 1); assert.equal(fake.requests.length, 1);
  } finally { await fake.close(); }
});

test('abort during post-input render allowance prevents capture and follow-up model requests', async () => {
  const fake = await server([action(call('type', { text: '待绘制草稿' }))]);
  let cancel: ReturnType<typeof setTimeout> | undefined;
  try {
    const f = fixture(fake.credentials); let observations = 0;
    f.options.driver.observe = async () => { observations++; return { ...image }; };
    f.options.driver.execute = async (value) => { f.writes.push(value); cancel = setTimeout(() => f.aborter.abort(), 30); };
    await assert.rejects(runGeminiComputerUse(f.options), { name: 'AbortError' });
    assert.deepEqual(f.drafts, ['待绘制草稿']); assert.equal(f.writes.length, 1);
    assert.equal(observations, 1); assert.equal(fake.requests.length, 1);
  } finally { if (cancel) clearTimeout(cancel); await fake.close(); }
});
