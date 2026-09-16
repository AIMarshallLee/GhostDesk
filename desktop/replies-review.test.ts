import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { defaultReplyLayout, type ChatObservation, type DesktopReplyConfig, type ReplyConversation } from '../shared/desktop-replies';
import { createDesktopReplies } from './desktop-replies';

const message = (text: string, stamp: string) => ({ direction: 'incoming' as const, text, stamp });
const config = (conversations: ReplyConversation[]): DesktopReplyConfig => ({ conversations, layout: structuredClone(defaultReplyLayout), mode: 'auto', pollSeconds: 3600, maxRepliesPerHour: 10, knowledgeIds: [], workflowId: '' });
const observation = (conversationName: string, messages: ChatObservation['messages']): ChatObservation => ({ conversationName, messages, composerText: '', observedAt: 'now' });
const temporary = () => mkdtemp(join(tmpdir(), 'flowdesk-replies-review-'));

test('生成中接管会将旧任务交人工，不遗留 generating 状态', async (t) => {
  const directory = await temporary(); t.after(() => rm(directory, { recursive: true, force: true }));
  const conversation: ReplyConversation = { id: 'a', name: 'A', enabled: true };
  let current = observation('A', [message('old', '1')]);
  let generationStarted!: () => void;
  const generationStartedPromise = new Promise<void>(resolve => { generationStarted = resolve; });
  const api = await createDesktopReplies({ directory,
    createSurface: async () => ({ target: { id: 'test:a', name: 'A', kind: 'test' }, open: async () => {}, close() {}, observe: async () => structuredClone(current), deliver: async () => ({ status: 'stale' as const }) }),
    context: async () => ({ knowledge: '', instructions: '' }),
    generate: async (_input, signal) => new Promise<string>((_resolve, reject) => { generationStarted(); signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }); }),
  });
  t.after(() => api.close());
  await api.saveConfig(config([conversation]));
  await api.start({ targetId: 'test:a', allowModel: true });
  await api.waitForIdle();
  current = observation('A', [message('old', '1'), message('new', '2')]);
  const ticking = api.tickNow();
  await generationStartedPromise;
  await api.takeover('a', false);
  await ticking;
  const state = api.state();
  assert.equal(state.status, 'paused');
  assert.equal(state.config.conversations[0].enabled, false);
  assert.equal(state.jobs[0].status, 'handoff');
  assert.notEqual(state.jobs[0].status, 'generating');
});

test('发送中暂停会禁用结果不明的会话，恢复不会再向其自动发送', async (t) => {
  const directory = await temporary(); t.after(() => rm(directory, { recursive: true, force: true }));
  const a: ReplyConversation = { id: 'a', name: 'A', enabled: true };
  const b: ReplyConversation = { id: 'b', name: 'B', enabled: true };
  const observations = new Map<string, ChatObservation>([
    ['a', observation('A', [message('old A', '1')])], ['b', observation('B', [message('old B', '1')])],
  ]);
  let releaseDelivery!: () => void;
  const deliveryGate = new Promise<void>(resolve => { releaseDelivery = resolve; });
  let deliveryStarted!: () => void;
  const deliveryStartedPromise = new Promise<void>(resolve => { deliveryStarted = resolve; });
  const delivered: string[] = [];
  const api = await createDesktopReplies({ directory,
    createSurface: async () => ({ target: { id: 'test:ab', name: 'Fixture', kind: 'test' }, open: async () => {}, close() {},
      observe: async conversation => structuredClone(observations.get(conversation.id)!),
      deliver: async (conversation, expected, reply) => {
        delivered.push(`${conversation.id}:${reply}`);
        if (conversation.id === 'a') { deliveryStarted(); await deliveryGate; return { status: 'uncertain' as const }; }
        const next = { ...expected, messages: [...expected.messages, { direction: 'outgoing' as const, text: reply, stamp: 'sent' }] };
        observations.set(conversation.id, next); return { status: 'visually_confirmed' as const, observation: next };
      },
    }),
    context: async () => ({ knowledge: '', instructions: '' }), generate: async ({ conversation }) => `reply-${conversation.id}`,
  });
  t.after(() => api.close());
  await api.saveConfig(config([a, b]));
  await api.start({ targetId: 'test:ab', allowModel: true });
  await api.waitForIdle();
  observations.set('a', observation('A', [message('old A', '1'), message('new A', '2')]));
  const ticking = api.tickNow();
  await deliveryStartedPromise;
  const pausing = api.pause();
  releaseDelivery();
  await pausing;
  await ticking;
  let state = api.state();
  assert.equal(state.jobs[0].status, 'uncertain');
  assert.equal(state.config.conversations.find(item => item.id === 'a')?.enabled, false);
  const beforeResume = delivered.length;
  await api.start({ targetId: 'test:ab', allowModel: true });
  await api.waitForIdle();
  observations.set('a', observation('A', [message('old A', '1'), message('new A', '2'), message('later A', '3')]));
  await api.tickNow();
  state = api.state();
  assert.equal(delivered.length, beforeResume);
  assert.equal(state.config.conversations.find(item => item.id === 'a')?.enabled, false);
});
