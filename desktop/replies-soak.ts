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

const people: ReplyConversation[] = [{ id: 'lin', name: '林小雨', enabled: true }, { id: 'chen', name: '陈先生', enabled: true }, { id: 'zhou', name: '周女士', enabled: true }];
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const config = (): DesktopReplyConfig => ({ conversations: structuredClone(people), layout: structuredClone(defaultReplyLayout), mode: 'auto', pollSeconds: 2, maxRepliesPerHour: 500, knowledgeIds: ['fixture-only'], workflowId: 'fixture-soak' });
const compactScene = (state: DesktopRepliesFixtureResult) => {
  const active = state.conversations.find(item => item.name === state.activeConversationName);
  return { activeConversationName: state.activeConversationName, conversations: state.conversations.map((item, index) => ({ name: item.name, x: .125, y: (113 + index * 86) / 700 })), messages: (active?.messages ?? []).slice(-4), composerText: active?.composer ?? '', confidence: 1, deliveryState: state.deliveryState, blocked: state.sceneBlocked, atBottom: true };
};

/** Five-minute, app-owned fixture soak. Never sends screenshots or text to a real provider. */
export async function runDesktopRepliesSoak(seconds = 300, driverFactory?: (fixture: Awaited<ReturnType<typeof createDesktopRepliesFixture>>, signal: AbortSignal) => Promise<ChatDriver>) {
  if (!Number.isInteger(seconds) || seconds < 60 || seconds > 330) throw new Error('replies soak duration must be 60..330 seconds');
  await app.whenReady();
  const fixture = await createDesktopRepliesFixture(true);
  const directory = await mkdtemp(join(tmpdir(), 'flowdesk-replies-soak-'));
  let requests = 0, sceneRequests = 0, generationRequests = 0, pngAttachments = 0;
  let failure: Error | undefined;
  const replySequence = new Map<string, number>();
  const provider = createServer(async (request, response) => {
    try {
      if (request.method !== 'POST' || request.url !== '/v1/chat/completions') throw new Error('unexpected loopback request');
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of request) { const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += part.length; if (size > 2_000_000) throw new Error('loopback request too large'); chunks.push(part); }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { model?: string; messages?: Array<{ role?: string; content?: unknown }> };
      if (body.model !== 'flowdesk-replies-soak-loopback' || !body.messages) throw new Error('bad loopback model request');
      const system = body.messages.find(item => item.role === 'system')?.content;
      const user = body.messages.find(item => item.role === 'user')?.content;
      if (typeof system !== 'string') throw new Error('missing system prompt');
      requests++;
      let content: string;
      if (system.includes('FLOWDESK_CHAT_SCENE')) {
        const image = Array.isArray(user) && user.find((item: any) => item?.type === 'image_url')?.image_url?.url;
        if (typeof image !== 'string' || !image.startsWith('data:image/png;base64,')) throw new Error('normal visual model did not receive a PNG');
        const png = Buffer.from(image.slice(22), 'base64');
        if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('visual attachment was not PNG');
        pngAttachments++; sceneRequests++; content = JSON.stringify(compactScene(await fixture.result()));
      } else if (system.includes('FLOWDESK_CHAT_REPLY')) {
        const input = typeof user === 'string' ? JSON.parse(user) as { conversation?: { name?: string } } : undefined;
        const name = input?.conversation?.name;
        if (!people.some(item => item.name === name)) throw new Error('generation crossed conversation boundary');
        const number = (replySequence.get(name!) ?? 0) + 1; replySequence.set(name!, number); generationRequests++; content = `${name} soak 回复 ${number}`;
      } else throw new Error('unexpected prompt');
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content } }] }));
    } catch (error) { failure = error instanceof Error ? error : new Error('loopback failure'); response.writeHead(400).end(); }
  });
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  const port = (provider.address() as AddressInfo).port;
  const model = createReplyModel({ baseUrl: `http://127.0.0.1:${port}/v1`, model: 'flowdesk-replies-soak-loopback', apiKey: 'fixture-only' });
  const engine = await createDesktopReplies({ directory, createSurface: async (_id, saved) => createDesktopChatSurface({ target: fixture.driver.target, layout: saved.layout, createDriver: async signal => driverFactory ? driverFactory(fixture, signal) : fixture.driver, readScene: model.readScene }), context: async () => ({ knowledge: '虚构测试知识', instructions: '仅在当前虚构会话回复' }), generate: model.generate });
  const started = Date.now(); let batches = 0;
  const progress = setInterval(() => { const state = engine.state(); console.log(`FlowDesk replies soak progress ${JSON.stringify({ elapsedSeconds: Math.floor((Date.now() - started) / 1000), batches, sent: state.jobs.filter(job => job.status === 'visually_confirmed').length, jobs: state.jobs.length, checkpoints: Object.keys(state.checkpoints).length, heapMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) })}`); }, 30_000);
  try {
    const capture = await fixture.driver.observe(); assert.ok(capture.width >= 1000 && capture.height >= 700 && capture.base64.length > 100, 'hidden fixture capture unavailable');
    await engine.saveConfig(config()); await engine.start({ targetId: fixture.driver.target.id, allowModel: true }); await engine.waitForIdle();
    while (Date.now() - started < seconds * 1000) {
      batches++;
      for (const person of people) await fixture.inject(person.name, `${person.name} 第${batches}批虚构新消息`, `soak-${batches}-${person.id}`);
      await engine.tickNow(); await engine.waitForIdle();
      const result = await fixture.result();
      for (const person of people) assert.equal(result.sent.filter(item => item.conversation === person.name).length, batches, `${person.name} send count drifted in batch ${batches}: ${JSON.stringify(engine.state())}`);
      assert.equal(engine.state().jobs.filter(job => job.status === 'visually_confirmed').length, batches * people.length, 'every accepted batch must have an independent visual confirmation');
      assert.equal(Object.keys(engine.state().checkpoints).length, 3, 'each conversation needs its own checkpoint');
      if (failure) throw failure;
      const remaining = seconds * 1000 - (Date.now() - started); if (remaining > 0) await sleep(Math.min(20_000, remaining));
    }
    assert.ok(batches * people.length >= 12, 'soak must complete at least 12 independent auto confirmations');
    const beforePause = (await fixture.result()).sent.length;
    await engine.pause(); await fixture.inject('林小雨', '暂停后不得自动发送', `pause-${Date.now()}`); await sleep(2_500);
    assert.equal((await fixture.result()).sent.length, beforePause, 'manual pause allowed a later send');
    const report = { seconds: Math.floor((Date.now() - started) / 1000), batches, requests, sceneRequests, generationRequests, pngAttachments, confirmed: engine.state().jobs.filter(job => job.status === 'visually_confirmed').length, jobs: engine.state().jobs.length, checkpoints: Object.keys(engine.state().checkpoints).length, heapMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) };
    console.log(`FlowDesk desktop replies soak passed. ${JSON.stringify(report)}`);
    return report;
  } finally {
    clearInterval(progress); await engine.close(); provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve())); await rm(directory, { recursive: true, force: true });
    // Keep the app-owned hidden fixture until the Electron smoke owner calls app.exit().
  }
}
