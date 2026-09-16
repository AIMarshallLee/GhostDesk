import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { defaultReplyLayout, type DesktopReplyConfig } from '../shared/desktop-replies';
import { createDesktopReplies } from './desktop-replies';

const config = (overrides: Partial<DesktopReplyConfig> = {}): DesktopReplyConfig => ({ conversations: [{ id: 'a', name: 'A', enabled: true }], layout: structuredClone(defaultReplyLayout), mode: 'auto', pollSeconds: 3600, maxRepliesPerHour: 5, knowledgeIds: [], workflowId: '', ...overrides });
const obs = (messages: Array<{ direction: 'incoming' | 'outgoing'; text: string; stamp: string }>) => ({ conversationName: 'A', messages, composerText: '', observedAt: 'now' });
async function temp() { const directory = await mkdtemp(join(tmpdir(), 'flowdesk-life-')); return { directory, cleanup: () => rm(directory, { recursive: true, force: true }) }; }
function deps(directory: string, options: { create?: () => Promise<unknown>; generate?: () => Promise<string>; deliver?: () => Promise<void> } = {}) {
  let current = obs([{ direction: 'incoming', text: 'old', stamp: '1' }]); let opened = 0;
  return { set: (value: typeof current) => { current = value; }, opened: () => opened, dependencies: { directory,
    createSurface: async () => { const custom = await options.create?.(); if (custom) return custom as never; return { target: { id: 'test:t', name: 'T', kind: 'test' as const }, open: async () => { opened++; }, close() {}, observe: async () => structuredClone(current), deliver: async (_c: unknown, expected: typeof current, reply: string) => { await options.deliver?.(); const result = { ...expected, messages: [...expected.messages, { direction: 'outgoing' as const, text: reply, stamp: 'sent' }] }; current = result; return { status: 'visually_confirmed' as const, observation: result }; } }; },
    context: async () => ({ knowledge: '', instructions: '' }), generate: async () => options.generate ? options.generate() : 'reply',
  } };
}

test('损坏状态文件 fail-closed，save/start 均不覆盖原文件', async (t) => {
  const f = await temp(); t.after(f.cleanup); const path = join(f.directory, 'desktop-replies.json'); await writeFile(path, '{not json'); const d = deps(f.directory);
  const api = await createDesktopReplies(d.dependencies); t.after(() => api.close()); await assert.rejects(api.saveConfig(config())); await assert.rejects(api.start({ targetId: 'test:t', allowModel: true }));
  assert.equal(await readFile(path, 'utf8'), '{not json');
});

test('createSurface 延迟完成后 stop 不会打开窗口或恢复 running', async (t) => {
  const f = await temp(); t.after(f.cleanup); let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; }); let opened = 0;
  const d = deps(f.directory, { create: async () => { await gate; return { target: { id: 'test:t', name: 'T', kind: 'test' as const }, open: async () => { opened++; }, close() {}, observe: async () => obs([]), deliver: async () => ({ status: 'stale' as const }) }; } }); const api = await createDesktopReplies(d.dependencies); await api.saveConfig(config()); const starting = api.start({ targetId: 'test:t', allowModel: true }); await Promise.resolve(); await api.stop(); release(); await starting;
  assert.equal(opened, 0); assert.equal(api.state().status, 'stopped');
});

test('空 layout 与重复 conversation id 被拒绝', async (t) => {
  const f = await temp(); t.after(f.cleanup); const api = await createDesktopReplies(deps(f.directory).dependencies);
  await assert.rejects(api.saveConfig(config({ layout: {} as never }))); await assert.rejects(api.saveConfig(config({ conversations: [{ id: 'a', name: 'A', enabled: true }, { id: 'a', name: 'B', enabled: true }] })));
});

test('两个并发 start 至多打开一个 surface', async (t) => {
  const f = await temp(); t.after(f.cleanup); const d = deps(f.directory); const api = await createDesktopReplies(d.dependencies); t.after(() => api.close()); await api.saveConfig(config()); await Promise.all([api.start({ targetId: 'test:t', allowModel: true }), api.start({ targetId: 'test:t', allowModel: true })]); await api.waitForIdle();
  assert.equal(d.opened(), 1); await api.close();
});

test('暂停等待异步设备停止，迟到的暂停不会覆盖后来启动的状态', async (t) => {
  const f = await temp(); t.after(f.cleanup);
  let release!: () => void; let closing!: () => void; let opened = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const startedClosing = new Promise<void>(resolve => { closing = resolve; });
  const d = deps(f.directory, { create: async () => ({
    target: { id: 'test:t', name: 'T', kind: 'test' as const },
    open: async () => { opened++; }, observe: async () => obs([]), deliver: async () => ({ status: 'stale' as const }),
    close: async () => { if (opened === 1) { closing(); await gate; } },
  }) });
  const api = await createDesktopReplies(d.dependencies); await api.saveConfig(config());
  await api.start({ targetId: 'test:t', allowModel: true }); await api.waitForIdle();
  let paused = false; const pause = api.pause().then(() => { paused = true; }); await startedClosing;
  const start = api.start({ targetId: 'test:t', allowModel: true });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(opened, 1); assert.equal(paused, false);
  release(); await Promise.all([pause, start]); await api.waitForIdle();
  assert.equal(opened, 2); assert.equal(api.state().status, 'running'); await api.close();
});

test('设备停止失败后不可重新启动，避免两个输入会话并存', async (t) => {
  const f = await temp(); t.after(f.cleanup);
  const d = deps(f.directory, { create: async () => ({ target: { id: 'test:t', name: 'T', kind: 'test' as const },
    open: async () => {}, observe: async () => obs([]), deliver: async () => ({ status: 'stale' as const }), close: async () => { throw new Error('simulated USB stop failure'); },
  }) });
  const api = await createDesktopReplies(d.dependencies); await api.saveConfig(config()); await api.start({ targetId: 'test:t', allowModel: true }); await api.waitForIdle();
  await assert.rejects(api.stop(), /设备会话停止失败/); assert.equal(api.state().status, 'needs_attention');
  await assert.rejects(api.start({ targetId: 'test:t', allowModel: true })); await api.close().catch(() => {});
});
