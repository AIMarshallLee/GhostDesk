import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createDesktopChatSurface, type ChatDriver } from './chat-surface';
import { createDesktopReplies } from './desktop-replies';
import { defaultReplyLayout, type DesktopReplyConfig, type ReplyConversation, type VisibleChatMessage } from '../shared/desktop-replies';
import type { ChatScene } from './reply-model';

const conversation: ReplyConversation = { id: 'lin', name: '林小雨', enabled: true };
const old: VisibleChatMessage = { direction: 'incoming', text: '旧消息', stamp: '1' };
const next: VisibleChatMessage = { direction: 'incoming', text: '刚到的新消息', stamp: '2' };
const config: DesktopReplyConfig = { conversations: [conversation], layout: structuredClone(defaultReplyLayout), mode: 'auto', pollSeconds: 3600, maxRepliesPerHour: 5, knowledgeIds: [], workflowId: 'fixture' };

test('双读之间的正常 incoming 保留旧 checkpoint，并在下轮稳定后仅发送一次', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'flowdesk-arrival-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let messages: VisibleChatMessage[] = [old]; let revision = 0; let arriveDuringRead = false; const sent: string[] = [];
  const target = { id: 'test:arrival', name: 'Fixture', kind: 'test' as const };
  const driver: ChatDriver = {
    target, activate: async () => {}, check: async () => {}, execute: async () => {},
    observe: async () => ({ base64: Buffer.from(`revision:${revision}`).toString('base64'), width: 1, height: 1 }),
  };
  const scene = (): ChatScene => ({ activeConversationName: conversation.name, conversations: [{ name: conversation.name, x: .1, y: .2 }], messages: structuredClone(messages), composerText: '', confidence: 1, deliveryState: 'clear', blocked: false, atBottom: true });
  const surface = createDesktopChatSurface({ target, layout: structuredClone(defaultReplyLayout), createDriver: async () => driver,
    readScene: async () => {
      const snapshot = scene();
      if (arriveDuringRead) { arriveDuringRead = false; messages = [...messages, next]; revision++; }
      return snapshot;
    },
  });
  const api = await createDesktopReplies({ directory,
    createSurface: async () => ({ ...surface, deliver: async (_conversation, expected, reply) => {
      sent.push(reply); const observation = { ...expected, messages: [...expected.messages, { direction: 'outgoing' as const, text: reply, stamp: 'sent' }] };
      messages = observation.messages; revision++; return { status: 'visually_confirmed' as const, observation };
    } }),
    context: async () => ({ knowledge: '', instructions: '' }), generate: async ({ incoming }) => `回复:${incoming[0].text}`,
  });
  t.after(() => api.close());
  await api.saveConfig(config); await api.start({ targetId: target.id, allowModel: true }); await api.waitForIdle();
  assert.deepEqual(api.state().checkpoints.lin.messages, [old]);

  revision++; arriveDuringRead = true;
  await api.tickNow();
  let state = api.state();
  assert.equal(state.status, 'running');
  assert.equal(state.config.conversations[0].enabled, true);
  assert.deepEqual(state.checkpoints.lin.messages, [old]);
  assert.equal(state.jobs.length, 0);
  assert.deepEqual(sent, []);

  await api.tickNow();
  state = api.state();
  assert.deepEqual(sent, ['回复:刚到的新消息']);
  assert.equal(state.jobs.filter(job => job.status === 'visually_confirmed').length, 1);
});

test('双读之间出现人工 outgoing 时仅延后；下一轮稳定观察必须转人工且不生成不发送', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'flowdesk-arrival-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let messages: VisibleChatMessage[] = [old]; let revision = 0; let change = false; let generates = 0; const sent: string[] = [];
  const target = { id: 'test:outgoing-arrival', name: 'Fixture', kind: 'test' as const };
  const driver: ChatDriver = { target, activate: async () => {}, check: async () => {}, execute: async () => {}, observe: async () => ({ base64: Buffer.from(`revision:${revision}`).toString('base64'), width: 1, height: 1 }) };
  const scene = (): ChatScene => ({ activeConversationName: conversation.name, conversations: [{ name: conversation.name, x: .1, y: .2 }], messages: structuredClone(messages), composerText: '', confidence: 1, deliveryState: 'clear', blocked: false, atBottom: true });
  const surface = createDesktopChatSurface({ target, layout: structuredClone(defaultReplyLayout), createDriver: async () => driver, readScene: async () => { const snapshot = scene(); if (change) { change = false; messages = [...messages, { direction: 'outgoing', text: '人工消息', stamp: 'manual' }]; revision++; } return snapshot; } });
  const api = await createDesktopReplies({ directory, createSurface: async () => ({ ...surface, deliver: async () => { sent.push('unexpected'); return { status: 'uncertain' as const }; } }), context: async () => ({ knowledge: '', instructions: '' }), generate: async () => { generates++; return 'unexpected'; } });
  t.after(() => api.close());
  await api.saveConfig(config); await api.start({ targetId: target.id, allowModel: true }); await api.waitForIdle();
  revision++; change = true; await api.tickNow();
  let state = api.state(); assert.equal(state.config.conversations[0].enabled, true); assert.deepEqual(state.checkpoints.lin.messages, [old]); assert.equal(generates, 0); assert.deepEqual(sent, []);
  await api.tickNow(); state = api.state();
  assert.equal(state.config.conversations[0].enabled, false); assert.equal(generates, 0); assert.deepEqual(sent, []); assert.ok(state.events.some(item => item.type === 'handoff'));
});
