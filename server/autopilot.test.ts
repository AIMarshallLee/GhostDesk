import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiError, createAutopilot } from './autopilot.ts';

type Auto = Awaited<ReturnType<typeof createAutopilot>>;
const waitUntil = async (check: () => Promise<boolean> | boolean, message: string, timeout = 1_500) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error(`超时：${message}`);
};
const cleanDir = async (dir: string) => {
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
};
const setup = async (generate?: (text: string) => Promise<string>) => {
  const dir = await mkdtemp(join(tmpdir(), 'flowdesk-auto-'));
  const auto = await createAutopilot({ dataDir: dir, generate: async text => generate ? generate(text) : `live:${text}` });
  return { dir, auto, close: async () => { await auto.close(); await cleanDir(dir); } };
};
const state = (auto: Auto) => auto.request('GET', '/sandbox/state') as Promise<any>;
const start = (auto: Auto, replyMode: 'auto' | 'manual' = 'auto') => auto.request('POST', '/sandbox/control', { action: 'start', mode: 'rules', replyMode });
const customers = (s: any) => s.messages.filter((m: any) => m.role === 'assistant');

test('连续三条客户消息各生成一次本地回复', async () => {
  const ctx = await setup(); try {
    await start(ctx.auto);
    await Promise.all(['a', 'b', 'c'].map((text, i) => ctx.auto.request('POST', '/sandbox/messages', { conversationId: 'lin', text, id: `m${i}` })));
    await waitUntil(async () => (await state(ctx.auto)).jobs.every((j: any) => j.status === 'sent'), '三条消息均发送');
    const s = await state(ctx.auto); assert.equal(customers(s).length, 3); assert.equal(s.jobs.length, 3);
  } finally { await ctx.close(); }
});
test('Windows 瞬时替换锁会重试，不暂停三条并发消息', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flowdesk-auto-')); let remaining = 0, simulated = 0, activated = false;
  const auto = await createAutopilot({
    dataDir: dir,
    renameFile: async (from, to) => {
      const snapshot = JSON.parse(await readFile(from, 'utf8'));
      if (!activated && snapshot.jobs.length === 3 && snapshot.jobs.some((job: any) => job.status === 'generating')) { activated = true; remaining = 2; }
      if (remaining-- > 0) { simulated++; throw Object.assign(new Error('临时文件锁定'), { code: 'EPERM' }); }
      await rename(from, to);
    },
  });
  try {
    await start(auto);
    await Promise.all(['lin', 'chen', 'zhou'].map((conversationId, index) => auto.request('POST', '/sandbox/messages', { conversationId, text: `锁冲突 ${index}`, id: `lock-${index}` })));
    await waitUntil(async () => (await state(auto)).jobs.length === 3 && (await state(auto)).jobs.every((job: any) => job.status === 'sent'), '替换重试后的三条发送');
    const s = await state(auto); assert.equal(activated, true); assert.equal(simulated, 2); assert.equal(s.automation.status, 'running'); assert.equal(s.stats.sent, 3); assert.equal(customers(s).length, 3);
  } finally { await auto.close(); await cleanDir(dir); }
});
test('Windows 持续替换锁达到上限后暂停，不会无限重试', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flowdesk-auto-')); let failures = 0, activated = false;
  const auto = await createAutopilot({
    dataDir: dir,
    renameFile: async (from, to) => {
      const snapshot = JSON.parse(await readFile(from, 'utf8'));
      if (!activated && snapshot.jobs.length === 3 && snapshot.jobs.some((job: any) => job.status === 'generating')) activated = true;
      if (activated) { failures++; throw Object.assign(new Error('持续锁定'), { code: 'EBUSY' }); }
      await rename(from, to);
    },
  });
  try {
    await start(auto);
    await Promise.all(['lin', 'chen', 'zhou'].map((conversationId, index) => auto.request('POST', '/sandbox/messages', { conversationId, text: `持续锁 ${index}`, id: `busy-${index}` })));
    await waitUntil(async () => (await state(auto)).automation.status === 'paused', '持续锁后暂停');
    const s = await state(auto); assert.equal(activated, true); assert.equal(failures, 5); assert.equal(s.jobs.filter((job: any) => job.status === 'handoff').length, 1);
    await new Promise(resolve => setTimeout(resolve, 120)); assert.equal(failures, 5);
  } finally { await auto.close(); await cleanDir(dir); }
});
test('跨会话回复历史严格隔离', async () => {
  const ctx = await setup(); try {
    await start(ctx.auto); await ctx.auto.request('POST', '/sandbox/messages', { conversationId: 'lin', text: '配送', id: 'lin-1' });
    await ctx.auto.request('POST', '/sandbox/messages', { conversationId: 'chen', text: '退货', id: 'chen-1' });
    await waitUntil(async () => customers(await state(ctx.auto)).length === 2, '两条回复');
    const s = await state(ctx.auto); assert.equal(customers(s).filter((m: any) => m.conversationId === 'lin')[0].replyTo, 'lin-1'); assert.equal(customers(s).filter((m: any) => m.conversationId === 'chen')[0].replyTo, 'chen-1');
  } finally { await ctx.close(); }
});
test('重复 ID 幂等，冲突内容被拒绝', async () => {
  const ctx = await setup(); try {
    const one = await ctx.auto.request('POST', '/sandbox/messages', { conversationId: 'zhou', text: '功能', id: 'same' });
    const two = await ctx.auto.request('POST', '/sandbox/messages', { conversationId: 'zhou', text: '功能', id: 'same' });
    assert.deepEqual(two, one); await assert.rejects(() => ctx.auto.request('POST', '/sandbox/messages', { conversationId: 'zhou', text: '别的', id: 'same' }), (e: any) => e instanceof ApiError && e.status === 409);
    assert.equal((await state(ctx.auto)).jobs.length, 1);
  } finally { await ctx.close(); }
});
test('人工消息不会触发自我回复，并接管该会话', async () => {
  const ctx = await setup(); try {
    await start(ctx.auto); await ctx.auto.request('POST', '/sandbox/messages', { conversationId: 'lin', text: '人工说明', role: 'human' });
    await new Promise(resolve => setTimeout(resolve, 40));
    const s = await state(ctx.auto); assert.equal(customers(s).length, 0); assert.equal(s.jobs.length, 0);
  } finally { await ctx.close(); }
});
test('生成中暂停会保留队列，恢复后再发送', async () => {
  let release!: () => void; let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); const enteredGate = new Promise<void>(resolve => { entered = resolve; });
  const ctx = await setup(async () => { entered(); await gate; return 'live reply'; }); try {
    await ctx.auto.request('POST', '/sandbox/control', { action: 'start', mode: 'live', replyMode: 'auto', allowLive: true });
    await ctx.auto.request('POST', '/sandbox/messages', { conversationId: 'lin', text: 'x' }); await enteredGate;
    await ctx.auto.request('POST', '/sandbox/control', { action: 'pause' }); release();
    await waitUntil(async () => (await state(ctx.auto)).jobs[0].status === 'queued', '暂停后恢复队列');
    await ctx.auto.request('POST', '/sandbox/control', { action: 'start', mode: 'live', replyMode: 'auto', allowLive: true });
    await waitUntil(async () => (await state(ctx.auto)).jobs[0].status === 'sent', '恢复后发送');
  } finally { await ctx.close(); }
});
test('生成中人工接管会阻止旧结果发送', async () => {
  let release!: () => void; let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); const enteredGate = new Promise<void>(resolve => { entered = resolve; });
  const ctx = await setup(async () => { entered(); await gate; return '不应发送'; }); try {
    await ctx.auto.request('POST', '/sandbox/control', { action: 'start', mode: 'live', replyMode: 'auto', allowLive: true });
    await ctx.auto.request('POST', '/sandbox/messages', { conversationId: 'lin', text: 'x' }); await enteredGate;
    await ctx.auto.request('POST', '/sandbox/messages', { conversationId: 'lin', text: '人工接管', role: 'human' }); release();
    await waitUntil(async () => (await state(ctx.auto)).jobs[0].status === 'handoff', '人工接管');
    const s = await state(ctx.auto); assert.equal(s.conversations.find((c: any) => c.id === 'lin').enabled, false); assert.equal(customers(s).length, 0);
    await ctx.auto.request('POST', '/sandbox/messages', { conversationId: 'lin', text: '后续消息' });
    assert.equal((await state(ctx.auto)).jobs[1].status, 'handoff');
  } finally { await ctx.close(); }
});
test('接管一个会话不会取消另一个会话的生成', async () => {
  let release!: () => void; let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); const enteredGate = new Promise<void>(resolve => { entered = resolve; });
  const ctx = await setup(async text => { if (text === 'chen pending') { entered(); await gate; } return `live:${text}`; }); try {
    await ctx.auto.request('POST', '/sandbox/control', { action: 'start', mode: 'live', replyMode: 'auto', allowLive: true });
    await ctx.auto.request('POST', '/sandbox/messages', { conversationId: 'chen', text: 'chen pending' }); await enteredGate;
    await ctx.auto.request('POST', '/sandbox/messages', { conversationId: 'lin', text: '人工接管', role: 'human' }); release();
    await waitUntil(async () => (await state(ctx.auto)).jobs[0].status === 'sent', '另一个会话完成发送');
    assert.equal(customers(await state(ctx.auto))[0].conversationId, 'chen');
  } finally { await ctx.close(); }
});
test('关闭再恢复会话不会补发已取消的旧生成', async () => {
  let release!: () => void; let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); const enteredGate = new Promise<void>(resolve => { entered = resolve; });
  const ctx = await setup(async () => { entered(); await gate; return '不应发送'; }); try {
    await ctx.auto.request('POST', '/sandbox/control', { action: 'start', mode: 'live', replyMode: 'auto', allowLive: true });
    await ctx.auto.request('POST', '/sandbox/messages', { conversationId: 'lin', text: 'x' }); await enteredGate;
    await ctx.auto.request('POST', '/sandbox/conversations/lin', { enabled: false });
    await ctx.auto.request('POST', '/sandbox/conversations/lin', { enabled: true }); release();
    await waitUntil(async () => (await state(ctx.auto)).jobs[0].status === 'handoff', '旧生成已交接');
    await new Promise(resolve => setTimeout(resolve, 40)); assert.equal(customers(await state(ctx.auto)).length, 0);
  } finally { await ctx.close(); }
});
test('停止会阻止生成中的旧结果发送', async () => {
  let release!: () => void; let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); const enteredGate = new Promise<void>(resolve => { entered = resolve; });
  const ctx = await setup(async () => { entered(); await gate; return '不应发送'; }); try {
    await ctx.auto.request('POST', '/sandbox/control', { action: 'start', mode: 'live', replyMode: 'auto', allowLive: true });
    await ctx.auto.request('POST', '/sandbox/messages', { conversationId: 'lin', text: 'x' }); await enteredGate;
    await ctx.auto.request('POST', '/sandbox/control', { action: 'stop' }); release();
    await waitUntil(async () => (await state(ctx.auto)).jobs[0].status === 'handoff', '停止后交接');
    assert.equal(customers(await state(ctx.auto)).length, 0);
  } finally { await ctx.close(); }
});
test('禁用会话的新客户消息直接交接并计入统计', async () => {
  const ctx = await setup(); try {
    await ctx.auto.request('POST', '/sandbox/conversations/lin', { enabled: false });
    await ctx.auto.request('POST', '/sandbox/messages', { conversationId: 'lin', text: '人工处理' });
    const s = await state(ctx.auto); assert.equal(s.jobs[0].status, 'handoff'); assert.equal(s.stats.handoff, 1);
  } finally { await ctx.close(); }
});
test('运行中空队列不会设置轮询定时器', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flowdesk-auto-')); let scheduled = 0;
  const auto = await createAutopilot({ dataDir: dir, setTimer: (() => { scheduled++; return 0 as any; }) as any, clearTimer: (() => {}) as any });
  try { await start(auto); assert.equal(scheduled, 0); } finally { await auto.close(); await rm(dir, { recursive: true, force: true }); }
});
test('ACK 丢失和重启都按 deliveryKey 去重且只生成一次', async () => {
  let calls = 0;
  const ctx = await setup(async () => { calls++; return 'live reply'; }); try {
    await ctx.auto.request('POST', '/sandbox/faults', { ackLosses: 1 });
    await ctx.auto.request('POST', '/sandbox/control', { action: 'start', mode: 'live', replyMode: 'auto', allowLive: true });
    await ctx.auto.request('POST', '/sandbox/messages', { conversationId: 'chen', text: '退货' });
    await waitUntil(async () => (await state(ctx.auto)).jobs[0].status === 'sent', 'ACK 重试完成');
    const sent = await state(ctx.auto); assert.equal(customers(sent).length, 1); assert.equal(sent.stats.sent, 1); assert.equal(calls, 1);
    await ctx.auto.close(); const reopened = await createAutopilot({ dataDir: ctx.dir });
    try { assert.equal(customers(await state(reopened)).length, 1); assert.equal((await state(reopened)).automation.status, 'paused'); } finally { await reopened.close(); }
  } finally { await rm(ctx.dir, { recursive: true, force: true }); }
});
test('恢复已保存的实时模式仍需再次明确允许', async () => {
  const ctx = await setup(); try {
    await ctx.auto.request('POST', '/sandbox/control', { action: 'start', mode: 'live', replyMode: 'auto', allowLive: true });
    await ctx.auto.request('POST', '/sandbox/control', { action: 'pause' });
    await assert.rejects(() => ctx.auto.request('POST', '/sandbox/control', { action: 'start' }), (error: any) => error instanceof ApiError && error.status === 400);
  } finally { await ctx.close(); }
});
test('三次生成失败达到上限且 attempts 不重复计数', async () => {
  const ctx = await setup(); try {
    await ctx.auto.request('POST', '/sandbox/faults', { generateFailures: 3 }); await start(ctx.auto);
    await ctx.auto.request('POST', '/sandbox/messages', { conversationId: 'lin', text: 'x' });
    await waitUntil(async () => (await state(ctx.auto)).jobs[0].status === 'failed', '三次生成失败');
    const job = (await state(ctx.auto)).jobs[0]; assert.equal(job.attempts, 3); assert.equal(job.error, '模拟生成失败');
  } finally { await ctx.close(); }
});
test('三次发送失败达到上限且没有模拟投递', async () => {
  const ctx = await setup(); try {
    await ctx.auto.request('POST', '/sandbox/faults', { sendFailures: 3 }); await start(ctx.auto);
    await ctx.auto.request('POST', '/sandbox/messages', { conversationId: 'lin', text: 'x' });
    await waitUntil(async () => (await state(ctx.auto)).jobs[0].status === 'failed', '三次发送失败');
    const s = await state(ctx.auto); assert.equal(s.jobs[0].attempts, 3); assert.equal(customers(s).length, 0);
  } finally { await ctx.close(); }
});
test('人工复制模式只有 ready 草稿，复制不会发送', async () => {
  const ctx = await setup(); try {
    await start(ctx.auto, 'manual'); await ctx.auto.request('POST', '/sandbox/messages', { conversationId: 'zhou', text: '功能' });
    await waitUntil(async () => (await state(ctx.auto)).jobs[0].status === 'ready', '草稿 ready');
    const s = await state(ctx.auto); assert.equal(customers(s).length, 0);
    await ctx.auto.request('POST', '/sandbox/copy', { jobId: s.jobs[0].id }); assert.equal((await state(ctx.auto)).jobs[0].status, 'copied'); assert.equal(customers(await state(ctx.auto)).length, 0);
  } finally { await ctx.close(); }
});
test('切换模式不会把已有 ready 草稿误发', async () => {
  const ctx = await setup(); try {
    await start(ctx.auto, 'manual'); await ctx.auto.request('POST', '/sandbox/messages', { conversationId: 'lin', text: '配送' });
    await waitUntil(async () => (await state(ctx.auto)).jobs[0].status === 'ready', '草稿 ready');
    await start(ctx.auto, 'auto'); await new Promise(resolve => setTimeout(resolve, 60));
    const s = await state(ctx.auto); assert.equal(s.jobs[0].status, 'ready'); assert.equal(customers(s).length, 0);
  } finally { await ctx.close(); }
});
