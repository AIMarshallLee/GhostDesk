import assert from 'node:assert/strict';
import test from 'node:test';
import { createDesktopChatSurface, type ChatDriver } from './chat-surface';
import { defaultReplyLayout, type ChatObservation, type ReplyConversation } from '../shared/desktop-replies';
import type { ChatScene } from './reply-model';

const target = { id: 'window:9:fixture', name: '虚构测试窗口', kind: 'test' as const };
const conversation: ReplyConversation = { id: 'a', name: '阿林', enabled: true };
const incoming = { direction: 'incoming' as const, text: '你好', stamp: '10:00' };
const base = (extra: Partial<ChatScene> = {}): ChatScene => ({ activeConversationName: '阿林', conversations: [{ name: '阿林', x: .12, y: .2 }], messages: [incoming], composerText: '', confidence: 1, deliveryState: 'clear', blocked: false, atBottom: true, ...extra });
const expected = (): ChatObservation => ({ conversationName: '阿林', messages: [incoming], composerText: '', observedAt: 'now' });

async function fixture(scenes: ChatScene[], options: { loseFocusAfterComposer?: boolean } = {}) {
  const actions: Array<{ kind: string; [key: string]: unknown }> = [];
  let focused = true;
  const driver: ChatDriver = {
    target, activate: async () => {}, observe: async () => ({ base64: `image-${Math.random()}`, width: 10, height: 10 }),
    check: async () => { if (!focused) throw new Error('目标窗口失焦'); },
    execute: async action => { actions.push(action); if (options.loseFocusAfterComposer && action.kind === 'click' && action.x > .5 && action.y > .7) focused = false; },
  };
  let reads = 0;
  const surface = createDesktopChatSurface({ target, layout: structuredClone(defaultReplyLayout), createDriver: async () => driver,
    readScene: async () => structuredClone(scenes[reads++] || scenes.at(-1)!), });
  const controller = new AbortController(); await surface.open(controller.signal);
  return { surface, actions, controller, reads: () => reads };
}

test('切换仅接受会话列表内唯一的精确名称', async () => {
  const duplicate = base({ conversations: [{ name: '阿林', x: .12, y: .2 }, { name: '阿林', x: .14, y: .3 }] });
  const first = await fixture([duplicate]);
  await assert.rejects(first.surface.observe(conversation, first.controller.signal), /重名/);
  assert.equal(first.actions.length, 0);

  const outside = base({ activeConversationName: '其他人', conversations: [{ name: '阿林', x: .7, y: .2 }] });
  const second = await fixture([outside]);
  await assert.rejects(second.surface.observe(conversation, second.controller.signal), /列表区域/);
  assert.equal(second.actions.length, 0);
});

test('观察需要两次稳定视觉结果，既有新消息会阻止输入', async () => {
  const changing = base({ messages: [incoming, { direction: 'incoming', text: '新消息', stamp: '10:01' }] });
  const f = await fixture([changing, changing]);
  const result = await f.surface.deliver(conversation, expected(), '好的，我马上处理。', f.controller.signal);
  assert.equal(result.status, 'stale');
  assert.equal(f.actions.length, 0);
  assert.equal(f.reads(), 2);
});

test('已有输入草稿时绝不占用输入框', async () => {
  const f = await fixture([base({ composerText: '人工草稿' }), base({ composerText: '人工草稿' })]);
  const result = await f.surface.deliver(conversation, expected(), '不可输入', f.controller.signal);
  assert.equal(result.status, 'stale');
  assert.equal(f.actions.length, 0);
});

test('输入后界面变化标为结果不明，不点击发送或重试', async () => {
  const changed = base({ messages: [incoming, { direction: 'incoming', text: '刚到的新消息', stamp: '10:01' }], composerText: '草稿' });
  const f = await fixture([base(), base(), changed]);
  const result = await f.surface.deliver(conversation, expected(), '草稿', f.controller.signal);
  assert.equal(result.status, 'uncertain');
  assert.equal(f.actions.filter(action => action.kind === 'type').length, 1);
  assert.equal(f.actions.filter(action => action.kind === 'click').length, 1);
});

test('旧的相同 outgoing 气泡不能作为新发送确认', async () => {
  const old = base({ messages: [incoming, { direction: 'outgoing', text: '相同回复', stamp: '09:59' }] });
  const typed = base({ messages: old.messages, composerText: '相同回复' });
  const f = await fixture([old, old, typed, old, old, old]);
  const result = await f.surface.deliver(conversation, { ...expected(), messages: old.messages }, '相同回复', f.controller.signal);
  assert.equal(result.status, 'uncertain');
  assert.equal(f.actions.filter(action => action.kind === 'click').length, 2);
});

test('输入前失焦检查会停止后续 type，返回结果不明而不重试', async () => {
  const f = await fixture([base(), base()], { loseFocusAfterComposer: true });
  const result = await f.surface.deliver(conversation, expected(), '不得写入', f.controller.signal);
  assert.equal(result.status, 'uncertain');
  assert.equal(f.actions.filter(action => action.kind === 'type').length, 0);
});
