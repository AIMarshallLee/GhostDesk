import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { defaultReplyLayout, type ChatObservation, type DesktopReplyConfig, type ReplyConversation } from '../shared/desktop-replies';
import { createDesktopReplies, splitReplyBubbles } from './desktop-replies';

const convo = (id: string, name: string): ReplyConversation => ({ id, name, enabled: true });
const message = (direction: 'incoming' | 'outgoing', text: string, stamp: string) => ({ direction, text, stamp });
const config = (conversations: ReplyConversation[], mode: 'manual' | 'auto' = 'auto'): DesktopReplyConfig => ({ conversations, layout: structuredClone(defaultReplyLayout), mode, pollSeconds: 3600, maxRepliesPerHour: 5, knowledgeIds: ['k'], workflowId: 'w' });
async function fixture(configValue = config([convo('a', 'A')]), options: { generate?: (text: string) => Promise<string>; deliver?: () => 'visually_confirmed' | 'uncertain' | 'stale' } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'flowdesk-replies-')); const observations = new Map<string, ChatObservation>(); const sent: string[] = []; let generated = 0;
  const api = await createDesktopReplies({ directory,
    createSurface: async () => ({ target: { id: 'test:target', name: 'Fixture', kind: 'test' }, open: async () => {}, close() {}, observe: async (c) => structuredClone(observations.get(c.id)!), deliver: async (c, expected, reply) => { sent.push(reply); const status = options.deliver?.() ?? 'visually_confirmed'; const next = status === 'visually_confirmed' ? { ...expected, messages: [...expected.messages, message('outgoing', reply, `sent-${reply}`)] } : undefined; if (next) observations.set(c.id, next); return { status, observation: next }; } }),
    context: async () => ({ knowledge: 'k', instructions: 'i' }), generate: async ({ incoming }) => { generated++; return options.generate ? options.generate(incoming[0].text) : `reply:${incoming[0].text}`; },
  });
  const set = (c: ReplyConversation, messages: ChatObservation['messages']) => observations.set(c.id, { conversationName: c.name, messages, composerText: '', observedAt: new Date().toISOString() });
  await api.saveConfig(configValue);
  return { api, directory, set, sent, generated: () => generated, cleanup: async () => { await api.close(); await rm(directory, { recursive: true, force: true }); } };
}

test('首轮仅建立基线，随后新增 incoming 生成并视觉确认', async (t) => {
  const f = await fixture(); t.after(f.cleanup); const a = convo('a', 'A'); f.set(a, [message('incoming', 'old', '1')]); await f.api.start({ targetId: 'test:target', allowModel: true }); await f.api.waitForIdle();
  assert.equal(f.generated(), 0); f.set(a, [message('incoming', 'old', '1'), message('incoming', 'new', '2')]); await f.api.tickNow();
  assert.deepEqual(f.sent, ['reply:new']); assert.equal(f.api.state().jobs[0].status, 'visually_confirmed');
});

test('两个会话各自维护检查点，重复文本按 stamp 不丢失', async (t) => {
  const a = convo('a', 'A'), b = convo('b', 'B'); const f = await fixture(config([a, b])); t.after(f.cleanup); f.set(a, [message('incoming', 'same', '1')]); f.set(b, [message('incoming', 'same', '1')]); await f.api.start({ targetId: 't', allowModel: true }); await f.api.waitForIdle();
  f.set(a, [message('incoming', 'same', '1'), message('incoming', 'same', '2')]); f.set(b, [message('incoming', 'same', '1'), message('incoming', 'b', '2')]); await f.api.tickNow();
  assert.equal(f.sent.length, 2); assert.equal(f.api.state().jobs.length, 2);
});

test('新 outgoing 或不连续历史会关闭该会话自动回复', async (t) => {
  const f = await fixture(); t.after(f.cleanup); const a = convo('a', 'A'); f.set(a, [message('incoming', 'one', '1')]); await f.api.start({ targetId: 't', allowModel: true }); await f.api.waitForIdle();
  f.set(a, [message('outgoing', 'human', '2')]); await f.api.tickNow();
  assert.equal(f.api.state().config.conversations[0].enabled, false); assert.equal(f.sent.length, 0);
});

test('manual copy 只标记 copied，不发送', async (t) => {
  const a = convo('a', 'A'); const f = await fixture(config([a], 'manual')); t.after(f.cleanup); f.set(a, [message('incoming', 'old', '1')]); await f.api.start({ targetId: 't', allowModel: true }); await f.api.waitForIdle(); f.set(a, [message('incoming', 'old', '1'), message('incoming', 'copy', '2')]); await f.api.tickNow();
  const job = f.api.state().jobs[0]; assert.equal(job.status, 'ready'); assert.equal(await f.api.copy(job.id), 'reply:copy'); assert.equal(f.api.state().jobs[0].status, 'copied'); assert.equal(f.sent.length, 0);
});

test('自动模式在视觉确认后保存发送结果', async (t) => {
  const f = await fixture(); t.after(f.cleanup); const a = convo('a', 'A'); f.set(a, [message('incoming', 'old', '1')]); await f.api.start({ targetId: 't', allowModel: true }); await f.api.waitForIdle(); f.set(a, [message('incoming', 'old', '1'), message('incoming', 'new', '2')]);
  await f.api.tickNow();
  assert.equal(f.api.state().jobs[0].status, 'visually_confirmed');
});

test('tickNow 在旧扫描进行时等待后补扫新消息', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'flowdesk-replies-tick-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const a = convo('a', 'A'); let current: ChatObservation = { conversationName: 'A', messages: [message('incoming', 'old', '1')], composerText: '', observedAt: 'old' };
  let blockNext = false; let release!: () => void; let captured!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); const capturedOldScan = new Promise<void>(resolve => { captured = resolve; });
  const sent: string[] = [];
  const api = await createDesktopReplies({ directory,
    createSurface: async () => ({ target: { id: 'test:target', name: 'Fixture', kind: 'test' }, open: async () => {}, close() {},
      observe: async () => { const snapshot = structuredClone(current); if (blockNext) { blockNext = false; captured(); await gate; } return snapshot; },
      deliver: async (_conversation, expected, reply) => { sent.push(reply); const next = { ...expected, messages: [...expected.messages, message('outgoing', reply, 'sent')] }; current = next; return { status: 'visually_confirmed' as const, observation: next }; },
    }),
    context: async () => ({ knowledge: '', instructions: '' }), generate: async ({ incoming }) => `reply:${incoming[0].text}`,
  });
  t.after(() => api.close()); await api.saveConfig(config([a])); await api.start({ targetId: 'test:target', allowModel: true }); await api.waitForIdle();
  blockNext = true; const oldTick = api.tickNow(); await capturedOldScan;
  current = { ...current, messages: [...current.messages, message('incoming', 'new', '2')], observedAt: 'new' };
  const requestedTick = api.tickNow(); release(); await oldTick; await requestedTick;
  assert.deepEqual(sent, ['reply:new']);
});

test('同一会话确认后第二条新消息仍可自动回复', async (t) => {
  const a = convo('a', 'A'); const f = await fixture(config([a])); t.after(f.cleanup); f.set(a, [message('incoming', 'old', '1')]); await f.api.start({ targetId: 't', allowModel: true }); await f.api.waitForIdle(); f.set(a, [message('incoming', 'old', '1'), message('incoming', 'one', '2')]); await f.api.tickNow();
  const seen = f.api.state().checkpoints.a.messages; f.set(a, [...seen, message('incoming', 'two', '3')]); await f.api.tickNow();
  assert.deepEqual(f.sent, ['reply:one', 'reply:two']);
});

test('生成连续失败三次后仅该会话进入人工接管', async (t) => {
  const a = convo('a', 'A'); const f = await fixture(config([a]), { generate: async () => { throw new Error('fixture'); } }); t.after(f.cleanup); f.set(a, [message('incoming', 'old', '1')]); await f.api.start({ targetId: 't', allowModel: true }); await f.api.waitForIdle(); f.set(a, [message('incoming', 'old', '1'), message('incoming', 'new', '2')]);
  await f.api.tickNow(); await f.api.tickNow(); await f.api.tickNow();
  assert.equal(f.api.state().jobs[0].status, 'handoff'); assert.equal(f.api.state().config.conversations[0].enabled, false);
});

test('视觉 stale 保留旧回复给人工且绝不重试发送', async (t) => {
  const a = convo('a', 'A'); const f = await fixture(config([a]), { deliver: () => 'stale' }); t.after(f.cleanup); f.set(a, [message('incoming', 'old', '1')]); await f.api.start({ targetId: 't', allowModel: true }); await f.api.waitForIdle(); f.set(a, [message('incoming', 'old', '1'), message('incoming', 'new', '2')]); await f.api.tickNow();
  assert.equal(f.api.state().jobs[0].status, 'handoff'); assert.equal(f.sent.length, 1);
});

test('重启把 sending 转 uncertain 并保持暂停', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'flowdesk-replies-restart-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const saved = { version: 1, config: config([convo('a', 'A')]), status: 'running', message: '', busy: true, cycle: 1, jobs: [{ id: 'j', conversationId: 'a', conversationName: 'A', input: 'x', reply: 'r', status: 'sending', observation: { conversationName: 'A', messages: [], composerText: '', observedAt: '1' }, attempts: 0, createdAt: '1', updatedAt: '1', detail: '', knowledgeIds: [], knowledgeHash: '', mode: 'auto' }], checkpoints: {}, events: [] };
  await writeFile(join(directory, 'desktop-replies.json'), JSON.stringify(saved));
  const api = await createDesktopReplies({ directory, createSurface: async () => { throw new Error('unused'); }, context: async () => ({ knowledge: '', instructions: '' }), generate: async () => 'unused' });
  assert.equal(api.state().status, 'paused'); assert.equal(api.state().jobs[0].status, 'uncertain'); await api.close();
});

test('splitReplyBubbles splits long multi-sentence text into natural chat bubbles', () => {
  const shortText = '您好，在的！';
  assert.deepEqual(splitReplyBubbles(shortText), [shortText]);

  const longText = '特别理解您的顾虑！很多老客户一开始也有类似想法。但实际使用后一人能管十个窗口，当月即可回本。';
  const bubbles = splitReplyBubbles(longText);
  assert.ok(bubbles.length >= 2);
  assert.equal(bubbles.join(''), longText);
});

test('splitBubbles 开启时将长消息分段发送并触发 onIncomingLead', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'flowdesk-replies-split-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const a = convo('a', 'A');
  const observations = new Map<string, ChatObservation>();
  const sent: string[] = [];
  const leads: Array<{ name: string; text: string }> = [];

  const longReply = '特别理解您的顾虑！很多老客户一开始也有类似想法。但实际使用后一人能管十个窗口，当月即可回本。';
  const api = await createDesktopReplies({
    directory,
    createSurface: async () => ({
      target: { id: 't', name: 'T', kind: 'test' },
      open: async () => {},
      close() {},
      observe: async (c) => structuredClone(observations.get(c.id)!),
      deliver: async (c, expected, reply) => {
        sent.push(reply);
        const next = { ...expected, messages: [...expected.messages, message('outgoing', reply, `sent-${Date.now()}`)] };
        observations.set(c.id, next);
        return { status: 'visually_confirmed', observation: next };
      },
    }),
    context: async () => ({ knowledge: 'k', instructions: 'i' }),
    generate: async () => longReply,
    onIncomingLead: (name, text) => { leads.push({ name, text }); },
  });

  const cfg: DesktopReplyConfig = {
    ...config([a]),
    splitBubbles: true,
    humanDelay: true,
  };
  await api.saveConfig(cfg);

  observations.set('a', { conversationName: 'A', messages: [message('incoming', 'base', '1')], composerText: '', observedAt: '1' });
  await api.start({ targetId: 't', allowModel: true });
  await api.waitForIdle();

  observations.set('a', { conversationName: 'A', messages: [message('incoming', 'base', '1'), message('incoming', '请问能便宜点吗？预算有限', '2')], composerText: '', observedAt: '2' });
  await api.tickNow();

  assert.ok(sent.length >= 2, `Expected at least 2 bubbles sent, got ${sent.length}`);
  assert.equal(leads.length, 1);
  assert.equal(leads[0].name, 'A');
  assert.ok(leads[0].text.includes('便宜点'));
  await api.close();
});
