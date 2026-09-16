import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDesktopReplies } from './desktop-replies';
import { defaultReplyLayout, type ChatObservation } from '../shared/desktop-replies';

test('虚拟时钟 24 小时：三会话 720 条新消息仅回复一次，记录有界，重启不重放', async () => {
  const root = resolve(tmpdir()); const directory = await mkdtemp(join(root, 'flowdesk-endurance-'));
  let now = Date.parse('2026-09-15T00:00:00Z'); let sends = 0;
  const names = ['A', 'B', 'C']; const sent = new Set<string>();
  const observations = new Map(names.map(name => [name, { conversationName: name, messages: [], composerText: '', observedAt: new Date(now).toISOString() } as ChatObservation]));
  const dependencies = { directory, now: () => now, setTimer: (() => ({}) as NodeJS.Timeout) as unknown as typeof setTimeout, clearTimer: (() => {}) as typeof clearTimeout,
    createSurface: async () => ({ target: { id: 'test:endurance', name: 'Fictional endurance', kind: 'test' as const }, open: async () => {}, close: async () => {},
      observe: async (conversation: { name: string }) => structuredClone(observations.get(conversation.name)!),
      deliver: async (conversation: { name: string }, expected: ChatObservation, reply: string) => {
        const key = `${conversation.name}:${expected.messages.at(-1)?.stamp}`; assert.ok(!sent.has(key), 'duplicate send'); sent.add(key); sends++;
        const next = { ...expected, messages: [...expected.messages, { direction: 'outgoing' as const, text: reply, stamp: `sent-${now}` }].slice(-20) };
        observations.set(conversation.name, next); return { status: 'visually_confirmed' as const, observation: structuredClone(next) };
      } }), context: async () => ({ knowledge: '虚构资料', instructions: '' }), generate: async () => '虚构答复' };
  let api = await createDesktopReplies(dependencies);
  try {
    await api.saveConfig({ conversations: names.map(name => ({ id: name, name, enabled: true })), layout: defaultReplyLayout, mode: 'auto', inputBackend: 'usb', modelProtocol: 'gemini-native', knowledgeIds: [], workflowId: '', pollSeconds: 3600, maxRepliesPerHour: 500 });
    await api.start({ targetId: 'test:endurance', allowModel: true }); await api.waitForIdle();
    for (let cycle = 1; cycle <= 240; cycle++) {
      now += 6 * 60 * 1000;
      for (const name of names) { const row = observations.get(name)!; row.messages.push({ direction: 'incoming', text: '相同文字的新咨询', stamp: `incoming-${cycle}` }); row.messages = row.messages.slice(-20); row.observedAt = new Date(now).toISOString(); }
      await api.tickNow(); await api.tickNow();
      assert.equal(sends, cycle * names.length); assert.ok(api.state().jobs.length <= 600); assert.ok(api.state().events.length <= 80);
    }
    await api.close(); api = await createDesktopReplies(dependencies); assert.equal(api.state().status, 'paused');
    await api.start({ targetId: 'test:endurance', allowModel: true }); await api.waitForIdle(); await api.tickNow(); assert.equal(sends, 720);
  } finally { await api.close(); if (!directory.startsWith(root + '\\') && !directory.startsWith(root + '/')) throw new Error('Invalid cleanup path'); await rm(directory, { recursive: true, force: true }); }
});
