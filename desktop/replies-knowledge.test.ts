import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { Knowledge } from '../shared/types';
import { defaultReplyLayout, type ChatObservation, type DesktopReplyConfig, type ReplyConversation } from '../shared/desktop-replies';
import { retrieveKnowledge } from '../server/knowledge';
import { createDesktopReplies } from './desktop-replies';

const conversation: ReplyConversation = { id: 'customer', name: '客户', enabled: true };
const message = (text: string, stamp: string) => ({ direction: 'incoming' as const, text, stamp });
const knowledge = (id: string, title: string, content: string, pending = false): Knowledge => ({ id, title, content, tags: [], enabled: !pending, reviewStatus: pending ? 'pending' : 'approved', createdAt: '2026-01-01', updatedAt: '2026-01-01' });
const entries = [knowledge('refund', '退款规则', '退款例外：已完成定制交付的订单不支持退款。'), knowledge('shipping', '发货时效', '现货订单将在付款后两个工作日内发货。'), knowledge('pending', '待审核价格', '不应发送的待审核内容。', true)];
const config = (knowledgeMode: 'selected' | 'retrieve', knowledgeIds: string[]): DesktopReplyConfig => ({ conversations: [conversation], layout: structuredClone(defaultReplyLayout), mode: 'manual', pollSeconds: 3600, maxRepliesPerHour: 5, knowledgeMode, knowledgeIds, workflowId: '' });

async function engine(configValue: DesktopReplyConfig) {
  const directory = await mkdtemp(join(tmpdir(), 'flowdesk-replies-knowledge-')); let observation: ChatObservation = { conversationName: '客户', messages: [], composerText: '', observedAt: '0' }; const received: Array<{ knowledge: string; ids: string[] }> = []; let delivered = 0;
  const api = await createDesktopReplies({ directory, createSurface: async () => ({ target: { id: 'test:t', name: 'T', kind: 'test' }, open: async () => {}, close() {}, observe: async () => structuredClone(observation), deliver: async () => { delivered++; return { status: 'visually_confirmed' as const, observation }; } }), context: async (saved, query) => {
    if (!query) return { knowledge: '', instructions: '', knowledgeIds: [] }; const mode = saved.knowledgeMode ?? 'selected'; const source = mode === 'retrieve' ? retrieveKnowledge(entries, { query, ids: saved.knowledgeIds.length ? saved.knowledgeIds : undefined }).hits : entries.filter(item => saved.knowledgeIds.includes(item.id) && item.enabled && item.reviewStatus !== 'pending').map(item => ({ id: item.id, title: item.title, content: item.content }));
    return { knowledge: source.map(item => `【${item.title}】\n${item.content}`).join('\n\n'), instructions: source.length ? '' : '资料未覆盖，请澄清或转人工，不编造价格/承诺。', knowledgeIds: source.map(item => item.id) };
  }, generate: async input => { received.push({ knowledge: input.knowledge, ids: api.state().jobs[0]?.knowledgeIds || [] }); return '草稿'; } });
  await api.saveConfig(configValue); return { api, received, set: (messages: ChatObservation['messages']) => { observation = { conversationName: '客户', messages, composerText: '', observedAt: String(messages.length) }; }, delivered: () => delivered, cleanup: async () => { await api.close(); await rm(directory, { recursive: true, force: true }); } };
}

test('检索模式按每条新消息命中不同知识来源，并固化实际命中 ID', async (t) => {
  const f = await engine(config('retrieve', [])); t.after(f.cleanup); f.set([message('旧消息', '1')]); await f.api.start({ targetId: 'test:t', allowModel: true }); await f.api.waitForIdle(); f.set([message('旧消息', '1'), message('退款有哪些例外？', '2')]); await f.api.tickNow(); assert.equal(f.api.state().jobs[0].knowledgeIds[0], 'refund'); assert.match(f.received[0].knowledge, /退款例外/);
  f.set([message('旧消息', '1'), message('退款有哪些例外？', '2'), message('现货订单何时发货？', '3')]); await f.api.tickNow(); assert.equal(f.api.state().jobs[0].knowledgeIds[0], 'shipping'); assert.match(f.received[1].knowledge, /两个工作日/); assert.doesNotMatch(f.received[1].knowledge, /待审核/);
});

test('手动选择模式不越过选中范围，取消不会发送', async (t) => {
  const f = await engine(config('selected', ['shipping'])); t.after(f.cleanup); f.set([message('旧消息', '1')]); await f.api.start({ targetId: 'test:t', allowModel: true }); await f.api.waitForIdle(); f.set([message('旧消息', '1'), message('退款例外是什么？', '2')]); await f.api.tickNow(); assert.deepEqual(f.api.state().jobs[0].knowledgeIds, ['shipping']); assert.doesNotMatch(f.received[0].knowledge, /退款例外/); assert.equal(f.delivered(), 0); await f.api.pause(); assert.equal(f.delivered(), 0);
});
