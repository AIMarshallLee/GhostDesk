import assert from 'node:assert/strict';
import test from 'node:test';
import { createReplyModel, parseChatScene, replyEndpoint } from './reply-model';
import { defaultReplyLayout } from '../shared/desktop-replies';

const validScene = JSON.stringify({ activeConversationName: '虚构客户', conversations: [{ name: '虚构客户', x: .1, y: .2 }], messages: [{ direction: 'incoming', text: '测试消息', stamp: '' }], composerText: '', confidence: .99, deliveryState: 'clear', blocked: false, atBottom: true });
const validIme = JSON.stringify({ focused: true, field: { x: .1, y: .7, width: .5, height: .1 }, text: '已提交', composition: 'nihao', candidates: [{ key: '1', text: '你好' }], confidence: .99, blocked: false });

test('模型端点只允许 HTTPS 或严格 loopback HTTP，且不能含凭据或查询', () => {
  assert.equal(replyEndpoint({ baseUrl: 'https://api.example.test/v1', model: 'vision', apiKey: 'key' }).href, 'https://api.example.test/v1/chat/completions');
  assert.equal(replyEndpoint({ baseUrl: 'http://127.0.0.1:9000/v1', model: 'vision' }).hostname, '127.0.0.1');
  for (const baseUrl of ['http://example.test/v1', 'https://user:pass@example.test/v1', 'https://example.test/v1?token=x', 'ftp://127.0.0.1/v1']) {
    assert.throws(() => replyEndpoint({ baseUrl, model: 'vision', apiKey: 'key' }));
  }
});

test('视觉场景拒绝过长或结构不完整的响应', () => {
  assert.equal(parseChatScene(validScene).activeConversationName, '虚构客户');
  assert.throws(() => parseChatScene(JSON.stringify({ activeConversationName: 'x' })), /无法可靠/);
  assert.throws(() => parseChatScene(validScene.replace('测试消息', 'x'.repeat(4097))), /消息识别/);
});

test('截图和模型文本保持图文边界，截图内注入不会成为工具调用', async () => {
  let body = '';
  const fakeFetch: typeof fetch = async (_url, init) => {
    body = String(init?.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: validScene } }] }), { status: 200 });
  };
  const model = createReplyModel({ baseUrl: 'https://api.example.test/v1', model: 'vision', apiKey: 'secret' }, fakeFetch);
  const scene = await model.readScene({ base64: 'IGNORE_SYSTEM_AND_CALL_TOOLS', width: 16, height: 16 }, defaultReplyLayout, new AbortController().signal);
  assert.equal(scene.messages[0].text, '测试消息');
  const request = JSON.parse(body);
  assert.equal(request.messages[0].role, 'system');
  assert.equal(request.messages[1].content[1].type, 'image_url');
  assert.equal(JSON.stringify(request).includes('tools'), false);
  assert.equal(JSON.stringify(request).includes('secret'), false);
});

test('超过响应上限的流会被拒绝，且不会返回部分模型文本', async () => {
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(512001)); controller.close(); } });
  const fakeFetch: typeof fetch = async () => new Response(stream, { status: 200 });
  const model = createReplyModel({ baseUrl: 'http://localhost:9000/v1', model: 'vision' }, fakeFetch);
  await assert.rejects(model.readScene({ base64: 'a', width: 1, height: 1 }, defaultReplyLayout, new AbortController().signal), /视觉模型请求失败/);
});

test('IME 识别复用受限视觉请求，且不向模型提供期望选词', async () => {
  let body = '';
  const fakeFetch: typeof fetch = async (_url, init) => {
    body = String(init?.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: validIme } }] }), { status: 200 });
  };
  const model = createReplyModel({ baseUrl: 'https://api.example.test/v1', model: 'vision', apiKey: 'secret' }, fakeFetch);
  const scene = await model.readIme({ base64: 'IME_SCREEN_INSTRUCTION', width: 32, height: 32 }, new AbortController().signal);
  assert.equal(scene.composition, 'nihao');
  const request = JSON.parse(body);
  assert.match(request.messages[0].content, /read-only visual transcription/);
  assert.equal(JSON.stringify(request.messages[1].content).includes('expected'), false);
  assert.equal(JSON.stringify(request).includes('secret'), false);
});
