import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from 'electron';
import { defaultReplyLayout, type DesktopReplyConfig, type ReplyConversation } from '../shared/desktop-replies.ts';
import { createDesktopChatSurface, type ChatDriver } from './chat-surface.ts';
import { createDesktopReplies } from './desktop-replies.ts';
import { createDesktopRepliesFixture, type DesktopRepliesFixtureResult } from './replies-fixture.ts';
import { createReplyModel } from './reply-model.ts';
import { createGeminiReplyModel, createGeminiRepliesDriver } from './gemini-replies';

const conversations: ReplyConversation[] = [
  { id: 'lin', name: '林小雨', enabled: true },
  { id: 'chen', name: '陈先生', enabled: true },
  { id: 'zhou', name: '周女士', enabled: true },
];
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const config = (mode: 'auto' | 'manual'): DesktopReplyConfig => ({
  conversations: structuredClone(conversations), layout: structuredClone(defaultReplyLayout), mode,
  pollSeconds: 2, maxRepliesPerHour: 20, knowledgeIds: ['fixture-knowledge'], workflowId: 'fixture-workflow',
});

function scene(state: DesktopRepliesFixtureResult) {
  const active = state.conversations.find(item => item.name === state.activeConversationName);
  return {
    activeConversationName: state.activeConversationName,
    conversations: state.conversations.map((conversation, index) => ({ name: conversation.name, x: .125, y: (70 + index * 86 + 43) / 700 })),
    messages: active?.messages ?? [], composerText: active?.composer ?? '', confidence: 1,
    deliveryState: state.deliveryState, blocked: state.sceneBlocked, atBottom: true,
  };
}

/** End-to-end acceptance using only the FlowDesk fixture and an in-process loopback model. */
export async function runDesktopRepliesSmoke(driverFactory?: (fixture: Awaited<ReturnType<typeof createDesktopRepliesFixture>>, signal: AbortSignal, readIme?: ReturnType<typeof createReplyModel>['readIme']) => Promise<ChatDriver>, gemini = false) {
  await app.whenReady();
  const fixture = await createDesktopRepliesFixture(true);
  const directory = await mkdtemp(join(tmpdir(), 'flowdesk-replies-smoke-'));
  let nativeCalls = 0, nativeResults = 0, imeRequests = 0;
  let requests = 0;
  let sceneRequests = 0;
  let generationRequests = 0;
  let screenshotAttachments = 0;
  let providerFailure: Error | undefined;
  const replyNumber = new Map<string, number>();
  const provider = createServer(async (request, response) => {
    try {
      if (request.method !== 'POST' || request.url !== (gemini ? '/v1beta/interactions' : '/v1/chat/completions')) throw new Error('loopback endpoint request invalid');
      const parts: Buffer[] = []; let length = 0;
      for await (const chunk of request) {
        const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); parts.push(part); length += part.length;
        if (length > 2_000_000) throw new Error('loopback request too large');
      }
      const body = JSON.parse(Buffer.concat(parts).toString('utf8'));
      if (body.model !== 'flowdesk-replies-loopback') throw new Error('loopback model request invalid');
      if (gemini) { assert.equal(request.headers['x-goog-api-key'], 'local-fixture-only'); assert.equal(body.store, false); }
      const system = gemini ? body.system_instruction : body.messages?.find((message: any) => message.role === 'system')?.content;
      const user = gemini ? body.input?.[0]?.content : body.messages?.find((message: any) => message.role === 'user')?.content;
      if (typeof system !== 'string') throw new Error('loopback system prompt missing');
      requests++;
      const finishNative = (content: string) => response.end(JSON.stringify({ id: `native-${requests}`, status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: content }] }] }));
      if (gemini && body.tools) {
        assert.equal(body.tools[0].type, 'computer_use'); assert.equal(body.tools[0].environment, 'desktop');
        const results = body.input.filter((step: any) => step.type === 'function_result');
        response.setHeader('Content-Type', 'application/json');
        if (results.length) { nativeResults++; assert.ok(results[0].result.some((block: any) => block.type === 'image')); finishNative('授权步骤完成'); return; }
        const approved = JSON.parse(user[0].text.match(/authorized exactly this one action: (.*?)\. Use the native/s)[1]);
        const args = approved.kind === 'type' ? { text: approved.text, press_enter: false } : { x: Math.round(approved.x * 1000), y: Math.round(approved.y * 1000), ...(approved.kind === 'scroll' ? { direction: approved.direction, magnitude_in_pixels: approved.amount * 100 } : {}) };
        nativeCalls++; response.end(JSON.stringify({ id: `native-${requests}`, status: 'requires_action', steps: [{ type: 'function_call', id: `call-${requests}`, name: approved.kind, arguments: { intent: '虚构持续回复授权动作', ...args } }] })); return;
      }
      if (gemini && system.includes('FLOWDESK_IME_SCENE')) {
        imeRequests++; response.setHeader('Content-Type', 'application/json'); finishNative(JSON.stringify(await fixture.imeScene())); return;
      }
      let content: string;
      if (system.includes('FLOWDESK_CHAT_SCENE')) {
        if (!Array.isArray(user)) throw new Error('scene request has no multimodal content');
        const image = gemini ? `data:image/png;base64,${user.find((item: any) => item.type === 'image')?.data}` : user.find((item: any) => item?.type === 'image_url')?.image_url?.url;
        if (typeof image !== 'string' || !image.startsWith('data:image/png;base64,')) throw new Error('scene request did not include a PNG');
        const png = Buffer.from(image.slice('data:image/png;base64,'.length), 'base64');
        if (png.length < 100 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('scene attachment was not a rendered PNG');
        screenshotAttachments++; sceneRequests++; content = JSON.stringify(scene(await fixture.result()));
      } else if (system.includes('FLOWDESK_CHAT_REPLY')) {
        const inputText = gemini ? user[0].text : user;
        if (typeof inputText !== 'string') throw new Error('reply request did not contain JSON input');
        const input = JSON.parse(inputText) as { conversation?: { name?: string } };
        const name = input.conversation?.name;
        if (!conversations.some(item => item.name === name)) throw new Error('reply request selected an unknown conversation');
        const sequence = (replyNumber.get(name!) ?? 0) + 1;
        replyNumber.set(name!, sequence); generationRequests++; content = `${name} 自动回复 ${sequence}`;
      } else throw new Error('unexpected loopback request type');
      response.writeHead(200, { 'content-type': 'application/json' });
      if (gemini) { finishNative(content); return; }
      response.end(JSON.stringify({ id: `replies-${requests}`, object: 'chat.completion', created: 0, model: body.model, choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] }));
    } catch (error) {
      providerFailure = error instanceof Error ? error : new Error('unknown loopback failure');
      response.writeHead(400, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: providerFailure.message }));
    }
  });
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  const port = (provider.address() as AddressInfo).port;
  const credentials = { baseUrl: `http://127.0.0.1:${port}`, model: 'flowdesk-replies-loopback', apiKey: 'local-fixture-only' };
  const model = gemini ? createGeminiReplyModel(credentials) : createReplyModel({ ...credentials, baseUrl: `${credentials.baseUrl}/v1` });
  const createEngine = async () => createDesktopReplies({
    directory,
    createSurface: async (_targetId, nextConfig) => createDesktopChatSurface({ target: fixture.driver.target, layout: nextConfig.layout, createDriver: async signal => { const driver = driverFactory ? await driverFactory(fixture, signal, gemini ? model.readIme : undefined) : fixture.driver; return gemini ? createGeminiRepliesDriver(driver, credentials, signal, nextConfig.layout) : driver; }, readScene: model.readScene }),
    context: async () => ({ knowledge: '仅供虚构 smoke 的知识。', instructions: '仅测试会话隔离。' }), generate: model.generate,
  });
  let engine = await createEngine();
  try {
    const capture = await fixture.driver.observe();
    assert.ok(capture.width >= 1000 && capture.width <= 1005 && capture.height >= 700 && capture.height <= 705, `unexpected fixture capture ${capture.width}x${capture.height}`); assert.ok(capture.base64.length > 100);
    await engine.saveConfig({ ...config('auto'), ...(gemini ? { modelProtocol: 'gemini-native' as const } : {}) });
    await engine.start({ targetId: fixture.driver.target.id, allowModel: true });
    await engine.waitForIdle();
    assert.equal(engine.state().jobs.length, 0);
    const baselineCycle = engine.state().cycle;
    await sleep(2_200);
    await engine.waitForIdle();
    assert.ok(engine.state().cycle > baselineCycle, '2-second polling timer did not run');

    await fixture.inject('林小雨', '林小雨第一条新消息', '10:01');
    await fixture.inject('陈先生', '陈先生第一条新消息', '10:02');
    await fixture.inject('周女士', '周女士第一条新消息', '10:03');
    if (gemini) await sleep(100); // Let fictional injection paint before the screenshot-grounded native step.
    await engine.tickNow();
    await engine.waitForIdle();
    let result = await fixture.result();
    for (const name of conversations.map(item => item.name)) assert.ok(result.sent.some(item => item.conversation === name && item.text === `${name} 自动回复 1`), `${name} did not receive its own reply: ${JSON.stringify(engine.state().jobs)}`);
    assert.equal(engine.state().jobs.filter(job => job.status === 'visually_confirmed').length, 3);

    await fixture.inject('林小雨', '林小雨第二条新消息', '10:04');
    if (gemini) await sleep(100); // Let fictional injection paint before the screenshot-grounded native step.
    await engine.tickNow();
    await engine.waitForIdle();
    result = await fixture.result();
    assert.ok(result.sent.some(item => item.conversation === '林小雨' && item.text === '林小雨 自动回复 2'), `same conversation did not receive a second distinct reply: ${JSON.stringify(engine.state())}`);

    await fixture.fault({ mode: 'no_send' });
    await fixture.inject('陈先生', '陈先生发送应不确定', '10:05');
    const beforeUncertain = (await fixture.result()).sent.length;
    if (gemini) await sleep(100); // Let fictional injection paint before the screenshot-grounded native step.
    await engine.tickNow();
    await engine.waitForIdle();
    const uncertain = engine.state().jobs.find(job => job.conversationName === '陈先生' && job.input.includes('发送应不确定'));
    assert.equal(uncertain?.status, 'uncertain');
    assert.equal(engine.state().config.conversations.find(item => item.name === '陈先生')?.enabled, false);
    if (gemini) await sleep(100); // Let fictional injection paint before the screenshot-grounded native step.
    await engine.tickNow();
    await engine.waitForIdle();
    assert.equal((await fixture.result()).sent.length, beforeUncertain, 'uncertain delivery was retried');

    await fixture.setComposer('', '陈先生');
    await fixture.fault({ mode: 'normal' });
    await engine.pause();
    const beforePaused = (await fixture.result()).sent.length;
    await fixture.inject('林小雨', '暂停期间只允许建立新基线', '10:06');
    await sleep(2_200);
    assert.equal((await fixture.result()).sent.length, beforePaused, 'paused engine sent a reply');

    await engine.saveConfig({ ...config('manual'), ...(gemini ? { modelProtocol: 'gemini-native' as const } : {}) });
    await engine.start({ targetId: fixture.driver.target.id, allowModel: true });
    await engine.waitForIdle();
    await fixture.inject('周女士', '手动模式消息', '10:07');
    if (gemini) await sleep(100); // Let fictional injection paint before the screenshot-grounded native step.
    await engine.tickNow();
    const manualJob = engine.state().jobs.find(job => job.conversationName === '周女士' && job.input.includes('手动模式消息'));
    assert.equal(manualJob?.status, 'ready');
    const beforeRestart = (await fixture.result()).sent.length;
    await engine.close();

    engine = await createEngine();
    assert.equal(engine.state().status, 'paused');
    assert.equal(engine.state().jobs.find(job => job.id === manualJob?.id)?.status, 'handoff');
    await engine.start({ targetId: fixture.driver.target.id, allowModel: true });
    await engine.waitForIdle();
    assert.equal((await fixture.result()).sent.length, beforeRestart, 'journal recovery replayed an old manual draft');
    assert.ok(sceneRequests > 0 && generationRequests >= 6 && screenshotAttachments === sceneRequests);
    if (providerFailure) throw providerFailure;
    if (gemini) { assert.ok(nativeCalls > 0); assert.equal(nativeCalls, nativeResults); }
    const report = { nativeCalls, nativeResults, imeRequests, requests, sceneRequests, generationRequests, screenshotAttachments, fictionalSends: beforeRestart };
    console.log(`FlowDesk desktop replies smoke passed. ${JSON.stringify(report)}`);
    return report;
  } finally {
    await engine.close(); fixture.close(); provider.closeAllConnections();
    await new Promise<void>(resolve => provider.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}
