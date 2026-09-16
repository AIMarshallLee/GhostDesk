import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { createService } from './service';

async function fixture(fetchImpl: typeof fetch = async () => { throw new Error('unexpected model request'); }, gate?: () => Promise<void>) {
  const base = resolve(tmpdir()); const directory = await mkdtemp(join(base, 'flowdesk-learning-'));
  const service = await createService({ dataDir: directory, fetchImpl, beforeLiveModel: gate });
  const call = (method: string, path: string, body?: unknown) => service.request({ method, path, body });
  const sample = async () => {
    const task = await call('POST', '/tasks', { title: '退款处理', input: '退款申请需要提供什么？', sourceName: '虚构问答测试' });
    await call('PUT', `/tasks/${task.id}`, { reply: '请提供订单号，我们将核对退款条件。' });
    await call('POST', `/tasks/${task.id}/approve`); return task;
  };
  return { directory, service, call, sample, close: async () => { await service.close(); if (!directory.startsWith(base + '\\') && !directory.startsWith(base + '/')) throw new Error('Invalid test cleanup path'); await rm(directory, { recursive: true, force: true }); } };
}

test('附件草稿仅由主进程能力保存，保留来源且进入待审核，公开请求不可伪造', async () => {
  const f = await fixture();
  try {
    const before = await f.call('GET', '/state'); const knowledge = before.knowledge.find((item: any) => item.enabled);
    const data = { title: '虚构附件', input: '用户编辑后的提取文字', reply: '待审核回复', sourceName: '明确选择附件：fiction.txt', knowledgeIds: [knowledge.id] };
    await assert.rejects(f.call('POST', '/tasks/from-attachment', data), /不存在/);
    const task = await f.service.recordAttachmentDraft(data);
    assert.equal(task.status, 'review'); assert.equal(task.mode, 'live'); assert.equal(task.sourceName, data.sourceName);
    assert.deepEqual(task.knowledgeIds, [knowledge.id]);
    const after = await f.call('GET', '/state'); assert.equal(after.tasks.length, before.tasks.length + 1);
    await f.call('PUT', `/knowledge/${knowledge.id}`, { ...knowledge, enabled: false });
    await assert.rejects(f.service.recordAttachmentDraft(data), /所选知识已变化/);
    const backup = await f.call('GET', '/export'); await f.call('POST', '/import', { data: backup });
    assert.equal((await f.call('GET', '/state')).tasks.find((item: any) => item.id === task.id).status, 'review');
  } finally { await f.close(); }
});

test('学习候选经编辑审核后才参与检索，重复收集与审核幂等，备份恢复保留来源', async () => {
  const f = await fixture();
  try {
    const task = await f.sample(); const before = await f.call('GET', '/state');
    const body = { taskIds: [task.id], kind: 'knowledge', method: 'local' };
    const candidate = await f.call('POST', '/learning/collect', body);
    assert.equal(candidate.status, 'pending'); assert.equal(candidate.method, 'local');
    assert.equal((await f.call('GET', '/state')).knowledge.length, before.knowledge.length);
    assert.equal((await f.call('POST', '/learning/collect', body)).id, candidate.id);
    const approved = await f.call('POST', `/learning/${candidate.id}/approve`, { title: '退款规则', content: '退款咨询先询问订单号，再核对处理条件。' });
    await f.call('POST', `/learning/${candidate.id}/approve`, { title: '不得重复', content: '不得重复' });
    const after = await f.call('GET', '/state');
    assert.equal(after.knowledge.length, before.knowledge.length + 1); assert.ok(after.knowledge.find((k: any) => k.id === approved.targetId)?.enabled);
    const next = await f.call('POST', '/tasks', { input: '退款要怎么处理' });
    const draft = await f.call('POST', `/tasks/${next.id}/generate`, { mode: 'demo' }); assert.ok(draft.knowledgeIds.includes(approved.targetId));
    const exported = await f.call('GET', '/export'); await f.call('POST', '/import', { data: exported });
    assert.deepEqual((await f.call('GET', '/state')).learning, exported.learning);
  } finally { await f.close(); }
});

test('SOP 审核写入工作流，拒绝不生效，未审核或已变更来源不可采纳', async () => {
  const f = await fixture();
  try {
    const task = await f.sample();
    const candidate = await f.call('POST', '/learning/collect', { taskIds: [task.id], kind: 'workflow', method: 'local' });
    const workflow = await f.call('POST', `/learning/${candidate.id}/approve`, { title: '退款 SOP', content: '先确认问题，再索取订单号核对。' });
    assert.ok((await f.call('GET', '/state')).workflows.some((w: any) => w.id === workflow.targetId));
    const k = await f.call('POST', '/learning/collect', { taskIds: [task.id], kind: 'knowledge', method: 'local' });
    await f.call('PUT', `/tasks/${task.id}`, { reply: '已变更但尚未审核' });
    await assert.rejects(f.call('POST', `/learning/${k.id}/approve`, { title: k.title, content: k.content }), /已人工审核/);
    await f.call('POST', `/tasks/${task.id}/approve`);
    await assert.rejects(f.call('POST', `/learning/${k.id}/approve`, { title: k.title, content: k.content }), /已变化/);
    await f.call('POST', `/learning/${k.id}/reject`);
    await assert.rejects(f.call('POST', `/learning/${k.id}/approve`, { title: k.title, content: k.content }), /已处理/);
  } finally { await f.close(); }
});

test('开启自动收集后仅为新审核问答建本地候选，关闭后停止，设置保存不会重置偏好', async () => {
  const f = await fixture();
  try {
    await f.call('PUT', '/learning/settings', { collectApprovedLearning: true }); await f.sample();
    let state = await f.call('GET', '/state'); assert.equal(state.learning.length, 1); assert.equal(state.learning[0].status, 'pending');
    await f.call('PUT', '/settings', { preferences: { workspaceName: '测试空间', operatorName: '测试员' } });
    state = await f.call('GET', '/state'); assert.equal(state.preferences.collectApprovedLearning, true);
    await f.call('PUT', '/learning/settings', { collectApprovedLearning: false }); await f.sample();
    assert.equal((await f.call('GET', '/state')).learning.length, 1);
    const backup = await f.call('GET', '/export'); delete backup.learning; delete backup.preferences.collectApprovedLearning;
    await f.call('POST', '/import', { data: backup }); assert.deepEqual((await f.call('GET', '/state')).learning, []);
  } finally { await f.close(); }
});

test('模型学习只传选中样本且需明确授权，USB 检查前后均执行，失败不保存候选', async () => {
  let calls = 0, gates = 0, payload = '';
  const fetchImpl: typeof fetch = async (_url, init) => { calls++; payload = String(init?.body); return new Response(JSON.stringify({ choices: [{ message: { content: '退款咨询应先收集订单号，再核对适用条件。' } }] })); };
  const f = await fixture(fetchImpl, async () => { if (++gates === 4) throw new Error('USB 已断开'); });
  try {
    await f.call('PUT', '/settings', { provider: { baseUrl: 'http://127.0.0.1:9999/v1', model: 'test', temperature: 0 } });
    const task = await f.sample(); await f.call('POST', '/tasks', { title: '未选择的资料', input: 'PRIVATE_UNSELECTED_SENTINEL' });
    const body = { taskIds: [task.id], kind: 'knowledge', method: 'model' };
    await assert.rejects(f.call('POST', '/learning/collect', body), /明确确认/); assert.equal(calls, 0);
    const candidate = await f.call('POST', '/learning/collect', { ...body, allowModel: true }); assert.equal(candidate.method, 'model'); assert.equal(gates, 2);
    assert.ok(payload.includes('退款申请')); assert.ok(!payload.includes('PRIVATE_UNSELECTED_SENTINEL'));
    await assert.rejects(f.call('POST', '/learning/collect', { ...body, kind: 'workflow', allowModel: true }), /USB 已断开/);
    assert.equal((await f.call('GET', '/state')).learning.length, 1);
  } finally { await f.close(); }
});

test('模型等待期间来源更改时丢弃过时学习结果；导入候选校验指纹', async () => {
  let release!: () => void; let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); const ready = new Promise<void>(resolve => { entered = resolve; });
  const f = await fixture(async () => { entered(); await gate; return new Response(JSON.stringify({ choices: [{ message: { content: '过时候选' } }] })); });
  try {
    await f.call('PUT', '/settings', { provider: { baseUrl: 'http://127.0.0.1:9999/v1', model: 'test', temperature: 0 } });
    const task = await f.sample(); const body = { taskIds: [task.id], kind: 'knowledge', method: 'model', allowModel: true };
    const pending = f.call('POST', '/learning/collect', body); const rejected = assert.rejects(pending, /已人工审核/); await ready;
    await assert.rejects(f.call('POST', '/learning/collect', body), /正在提炼/);
    await f.call('PUT', `/tasks/${task.id}`, { reply: '新的答复' }); release(); await rejected;
    assert.equal((await f.call('GET', '/state')).learning?.length ?? 0, 0);
    await f.call('POST', `/tasks/${task.id}/approve`); await f.call('POST', '/learning/collect', { ...body, method: 'local' });
    const exported = await f.call('GET', '/export'); exported.learning[0].sources[0].reply = '被替换的来源';
    await assert.rejects(f.call('POST', '/import', { data: exported }), /学习候选数据无效/);
  } finally { release(); await f.close(); }
});
