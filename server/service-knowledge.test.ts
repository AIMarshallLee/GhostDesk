import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { createService } from './service';

type Service = Awaited<ReturnType<typeof createService>>;
type Preview = { previewId: string; rows: Array<{ rowId: string; title: string; content: string; tags: string[]; question?: string; aliases?: string[]; scenario?: string; source?: string; sourceLocator?: string; errors: string[] }> };

async function fixture(fetchImpl?: typeof fetch) {
  const base = resolve(process.cwd(), 'artifacts', 'package-temp'); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, 'knowledge-service-')); const service = await createService({ dataDir: directory, fetchImpl });
  const call = (method: string, path: string, body?: unknown) => service.request({ method, path, body });
  return { service, call, close: async () => { await service.close(); await rm(directory, { recursive: true, force: true }); } };
}
function commitRows(preview: Preview) {
  return preview.rows.map(({ rowId, title, content, tags, question = '', aliases = [], scenario = 'all' }) => ({ rowId, title, content, tags, question, aliases, scenario }));
}
async function preview(service: Service, text: string, sourceName = '导入资料.csv') {
  const bytes = Buffer.from(text);
  return service.request({ method: 'POST', path: '/knowledge/import/preview', body: { files: [{ name: sourceName, size: bytes.length, base64: bytes.toString('base64') }] } }) as Promise<Preview>;
}

test('预览不持久化；提交幂等、重复跳过且来源由预览固定', async () => {
  const f = await fixture();
  try {
    const before = await f.call('GET', '/state');
    const p = await preview(f.service, '标题,问题,标准答案,相似问法,标签,场景\n退款,怎么退款,请提供订单号,退货怎么处理,售后|退款,service');
    assert.equal((await f.call('GET', '/state')).knowledge.length, before.knowledge.length);
    const body = { previewId: p.previewId, rows: commitRows(p), confirm: true };
    await assert.rejects(f.call('POST', '/knowledge/import/commit', { ...body, rows: [{ ...body.rows[0], rowId: 'unknown' }] }), /不属于此预览/);
    const first = await f.call('POST', '/knowledge/import/commit', body); const second = await f.call('POST', '/knowledge/import/commit', body);
    assert.deepEqual(second, first); assert.equal(first.created.length, 1); assert.equal(first.created[0].source, '导入资料.csv');
    const duplicate = await preview(f.service, '标题,问题,标准答案,相似问法,标签,场景\n退款2,怎么退款,请提供订单号,退款流程,售后,service');
    const skipped = await f.call('POST', '/knowledge/import/commit', { previewId: duplicate.previewId, rows: commitRows(duplicate), confirm: true });
    assert.equal(skipped.created.length, 0); assert.equal(skipped.skipped, 1);
    const forged = await preview(f.service, '标题,问题,标准答案,相似问法,标签,场景\n价格,多少钱,请咨询商务,报价,销售,sales');
    await assert.rejects(f.call('POST', '/knowledge/import/commit', { previewId: forged.previewId, rows: [{ ...commitRows(forged)[0], source: '伪造.csv' }], confirm: true }), /字段无效/);
  } finally { await f.close(); }
});

test('提交中的错误行原子失败；待审核不可检索，审核后才生效', async () => {
  const f = await fixture();
  try {
    const p = await preview(f.service, '标题,问题,标准答案,相似问法,标签,场景\n退款,怎么退款,请提供订单号,退款流程,售后,service\n价格,多少钱,请咨询商务,报价,销售,sales');
    const before = (await f.call('GET', '/state')).knowledge.length;
    const rows = commitRows(p); rows[1].content = '';
    await assert.rejects(f.call('POST', '/knowledge/import/commit', { previewId: p.previewId, rows, confirm: true }), /知识条目无效/);
    assert.equal((await f.call('GET', '/state')).knowledge.length, before);
    const committed = await f.call('POST', '/knowledge/import/commit', { previewId: p.previewId, rows: commitRows(p), confirm: true });
    const created = committed.created[0];
    assert.equal(created.reviewStatus, 'pending'); assert.equal(created.enabled, false);
    assert.equal((await f.call('POST', '/knowledge/search', { query: '怎么退款', scenario: 'service' })).hits.some((hit: any) => hit.id === created.id), false);
    await f.call('POST', '/knowledge/review', { ids: committed.created.map((item: any) => item.id), approved: true });
    assert.equal((await f.call('POST', '/knowledge/search', { query: '退款流程', scenario: 'service' })).hits[0]?.id, created.id);
  } finally { await f.close(); }
});

test('同问题不同答案不可同时审核；事实编辑撤销审核，待审核不能 PUT 启用', async () => {
  const f = await fixture();
  try {
    const p = await preview(f.service, '标题,问题,标准答案,相似问法,标签,场景\n退款A,怎么退款,提供订单号,退款,售后,service\n退款B,怎么退款,直接退款,退款,售后,service');
    const committed = await f.call('POST', '/knowledge/import/commit', { previewId: p.previewId, rows: commitRows(p), confirm: true });
    await assert.rejects(f.call('POST', '/knowledge/review', { ids: committed.created.map((item: any) => item.id), approved: true }), /同问题不同答案/);
    await f.call('POST', '/knowledge/review', { ids: [committed.created[0].id], approved: true });
    const approved = await f.call('PUT', `/knowledge/${committed.created[0].id}`, { ...committed.created[0], content: '更新后的退款规则' });
    assert.equal(approved.reviewStatus, 'pending'); assert.equal(approved.enabled, false); assert.equal(approved.approvedAt, undefined);
    await assert.rejects(f.call('PUT', `/knowledge/${approved.id}`, { ...approved, enabled: true }), /待审核知识/);
  } finally { await f.close(); }
});

test('所有新增知识默认待审核，旧 API 的 enabled true 不能绕过审核', async () => {
  const f = await fixture();
  try {
    const pending = await f.call('POST', '/knowledge', { title: '待审核', content: '仅供审核', tags: [] });
    const legacy = await f.call('POST', '/knowledge', { title: '旧 API', content: '人工创建兼容条目', tags: [], enabled: true });
    assert.equal(pending.reviewStatus, 'pending'); assert.equal(pending.enabled, false);
    assert.equal(legacy.reviewStatus, 'pending'); assert.equal(legacy.enabled, false); assert.equal(legacy.approvedAt, undefined);
    assert.equal((await f.call('POST', '/knowledge/search', { query: '人工创建兼容条目' })).hits.length, 0);
  } finally { await f.close(); }
});

test('公开模板的十条演练预期首命中或无命中', async () => {
  const f = await fixture();
  try {
    const template = await readFile(resolve(process.cwd(), 'public', 'knowledge-template.csv'), 'utf8');
    const evaluation = await readFile(resolve(process.cwd(), 'public', 'knowledge-evaluation-template.csv'), 'utf8');
    const p = await preview(f.service, template, 'knowledge-template.csv');
    const committed = await f.call('POST', '/knowledge/import/commit', { previewId: p.previewId, rows: commitRows(p), confirm: true });
    await f.call('POST', '/knowledge/review', { ids: committed.created.map((item: any) => item.id), approved: true });
    const cases = evaluation.trim().split(/\r?\n/).slice(1).map(line => { const comma = line.lastIndexOf(','); return { question: line.slice(0, comma), ...(line.slice(comma + 1) ? { expectedTitle: line.slice(comma + 1) } : {}) }; });
    const result = await f.call('POST', '/knowledge/evaluate', { cases });
    assert.equal(result.passed, 10, JSON.stringify(result.results.map((row: any) => ({ question: row.query, expected: row.expectedTitle, actual: row.hits[0]?.title }))));
  } finally { await f.close(); }
});

test('备份恢复保留导入来源、定位、批次和审核元数据', async () => {
  const f = await fixture();
  try {
    const p = await preview(f.service, '标题,问题,标准答案,相似问法,标签,场景\n退款,怎么退款,请提供订单号,退款流程,售后,service', 'metadata.csv');
    const committed = await f.call('POST', '/knowledge/import/commit', { previewId: p.previewId, rows: commitRows(p), confirm: true });
    const one = committed.created[0]; await f.call('POST', '/knowledge/review', { ids: [one.id], approved: true });
    const exported = await f.call('GET', '/export'); await f.call('POST', '/import', { data: exported });
    const restored = await f.call('GET', '/state'); const item = restored.knowledge.find((row: any) => row.id === one.id);
    assert.equal(item.source, 'metadata.csv'); assert.equal(item.sourceLocator, 'CSV 第 2 行'); assert.equal(item.importId, one.importId); assert.equal(item.reviewStatus, 'approved'); assert.ok(item.approvedAt);
  } finally { await f.close(); }
});

test('生成中撤销知识审核时拒绝旧事实草稿，实际来源必须仍然有效', async () => {
  let release!: () => void; let started!: () => void; const requested = new Promise<void>(resolve => { started = resolve; });
  const f = await fixture((async () => { started(); await new Promise<void>(resolve => { release = resolve; }); return new Response(JSON.stringify({ choices: [{ message: { content: '虚构旧价格草稿' } }] }), { status: 200 }); }) as typeof fetch);
  try {
    await f.call('PUT', '/settings', { provider: { baseUrl: 'http://127.0.0.1:9999/v1', model: 'local-stub', temperature: 0 } });
    const knowledge = await f.call('POST', '/knowledge', { title: '虚构试用价格', question: '虚构试用价格多少', content: '虚构试用价格 1.5 元', tags: [] });
    await f.call('POST', '/knowledge/review', { ids: [knowledge.id], approved: true });
    const task = await f.call('POST', '/tasks', { input: '虚构试用价格多少', workflowId: '' });
    const generating = f.call('POST', `/tasks/${task.id}/generate`, { mode: 'live' });
    await requested;
    await f.call('PUT', `/knowledge/${knowledge.id}`, { content: '虚构试用价格 15 元' });
    const rejected = assert.rejects(generating, /知识已修改或停用/); release(); await rejected;
    const state = await f.call('GET', '/state'); assert.equal(state.tasks.find((item: { id: string }) => item.id === task.id).reply, '');
  } finally { release?.(); await f.close(); }
});
