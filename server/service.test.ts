import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createService } from './service.ts';

async function fixture(fetchImpl?: typeof fetch) {
  const dir = await mkdtemp(join(tmpdir(), 'flowdesk-test-'));
  const service = await createService({ dataDir: dir, fetchImpl });
  return { dir, service, done: async () => { await service.close(); await rm(dir, { recursive: true, force: true }); } };
}

test('任务必须有审核内容，编辑已通过回复会撤销批准', async () => {
  const f = await fixture();
  try {
    const task = await f.service.request({ method: 'POST', path: '/tasks', body: { title: '测试任务' } });
    await assert.rejects(() => f.service.request({ method: 'POST', path: `/tasks/${task.id}/approve` }), /审核回复不能为空/);
    await f.service.request({ method: 'POST', path: `/tasks/${task.id}/generate`, body: { mode: 'demo' } });
    await f.service.request({ method: 'POST', path: `/tasks/${task.id}/approve` });
    const edited = await f.service.request({ method: 'PUT', path: `/tasks/${task.id}`, body: { reply: '人工改写的回复' } });
    assert.equal(edited.status, 'review');
    await assert.rejects(() => f.service.request({ method: 'POST', path: `/tasks/${task.id}/complete`, body: { method: 'copied' } }), /须先人工审核通过/);
  } finally { await f.done(); }
});

test('实时模型成功和失败不会伪造演示结果', async () => {
  let requested: any;
  const goodFetch = async (_input: RequestInfo | URL, init?: RequestInit) => { requested = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ choices: [{ message: { content: '真实模型回复' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  const f = await fixture(goodFetch as typeof fetch);
  try {
    await f.service.request({ method: 'PUT', path: '/settings', body: { provider: { baseUrl: 'http://127.0.0.1:9999/v1', model: 'test', temperature: 0 } } });
    const task = await f.service.request({ method: 'POST', path: '/tasks', body: {} });
    const result = await f.service.request({ method: 'POST', path: `/tasks/${task.id}/generate`, body: { mode: 'live', image: 'data:image/png;base64,aGVsbG8=' } });
    assert.equal(result.reply, '真实模型回复'); assert.equal(result.mode, 'live');
    assert.equal(requested.messages[1].content[1].type, 'image_url');
  } finally { await f.done(); }
  const failed = await fixture((async () => new Response('bad', { status: 500 })) as typeof fetch);
  try {
    await failed.service.request({ method: 'PUT', path: '/settings', body: { provider: { baseUrl: 'http://127.0.0.1:9999/v1', model: 'test', temperature: 0 } } });
    const task = await failed.service.request({ method: 'POST', path: '/tasks', body: {} });
    await assert.rejects(() => failed.service.request({ method: 'POST', path: `/tasks/${task.id}/generate`, body: { mode: 'live' } }), /模型服务请求失败/);
    const state = await failed.service.request({ method: 'GET', path: '/state' });
    assert.equal(state.tasks.find((x: { id: string }) => x.id === task.id).reply, '');
  } finally { await failed.done(); }
});

test('实时生成只带入匹配的启用知识，生成中不能审核旧回复', async () => {
  let release!: () => void; let requested: any;
  const delayedFetch = async (_input: RequestInfo | URL, init?: RequestInit) => { requested = JSON.parse(String(init?.body)); await new Promise<void>(resolve => { release = resolve; }); return new Response(JSON.stringify({ choices: [{ message: { content: '新回复' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  const f = await fixture(delayedFetch as typeof fetch);
  try {
    await f.service.request({ method: 'PUT', path: '/settings', body: { provider: { baseUrl: 'http://127.0.0.1:9999/v1', model: 'test', temperature: 0 } } });
    const enabled = await f.service.request({ method: 'POST', path: '/knowledge', body: { title: '交付周期', content: '标准交付周期为三个工作日。', tags: ['订单'], enabled: true } });
    await f.service.request({ method: 'POST', path: '/knowledge', body: { title: '禁用资料', content: '不应发送给模型。', tags: ['订单'], enabled: false } });
    const task = await f.service.request({ method: 'POST', path: '/tasks', body: { workflowId: '', input: '客户问订单交付周期', title: '知识测试' } });
    await f.service.request({ method: 'PUT', path: `/tasks/${task.id}`, body: { reply: '旧回复' } });
    const generating = f.service.request({ method: 'POST', path: `/tasks/${task.id}/generate`, body: { mode: 'live' } });
    await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(() => f.service.request({ method: 'POST', path: `/tasks/${task.id}/approve` }), /正在生成/);
    release(); const result = await generating;
    assert.deepEqual(result.knowledgeIds, [enabled.id]); assert.match(requested.messages[1].content, /标准交付周期/); assert.doesNotMatch(requested.messages[1].content, /不应发送/);
  } finally { await f.done(); }
});

test('导入会拒绝关联不完整或不安全的实体字段', async () => {
  const f = await fixture();
  try {
    const state = await f.service.request({ method: 'GET', path: '/export' });
    state.tasks[0].workflowId = 'missing'; await assert.rejects(() => f.service.request({ method: 'POST', path: '/import', body: { data: state } }), /任务数据无效/);
    state.tasks[0].workflowId = state.workflows[0].id; state.provider.baseUrl = 'http://example.invalid/v1'; await assert.rejects(() => f.service.request({ method: 'POST', path: '/import', body: { data: state } }), /服务商设置无效/);
  } finally { await f.done(); }
});

test('设置空密钥保留现有密钥，编辑输入撤销批准，provider 测试不带知识', async () => {
  let requestBody: any;
  const f = await fixture((async (_url: RequestInfo | URL, init?: RequestInit) => { requestBody = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ choices: [{ message: { content: '连接成功' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }) as typeof fetch);
  try {
    await f.service.request({ method: 'PUT', path: '/settings', body: { provider: { baseUrl: 'http://127.0.0.1:9999/v1', model: 'test', temperature: 0, apiKey: 'saved-key' } } });
    await f.service.request({ method: 'PUT', path: '/settings', body: { provider: { baseUrl: 'http://127.0.0.1:9999/v1', model: 'test', temperature: 0, apiKey: '' } } });
    assert.equal((await f.service.request({ method: 'GET', path: '/state' })).provider.hasKey, true);
    await f.service.request({ method: 'POST', path: '/knowledge', body: { title: '连接成功', content: '私有知识不得用于测试。', tags: [], enabled: true } });
    await f.service.request({ method: 'POST', path: '/provider/test' }); assert.doesNotMatch(requestBody.messages[1].content, /私有知识/);
    const task = await f.service.request({ method: 'POST', path: '/tasks', body: {} }); await f.service.request({ method: 'PUT', path: `/tasks/${task.id}`, body: { reply: '可审核回复' } }); await f.service.request({ method: 'POST', path: `/tasks/${task.id}/approve` });
    const edited = await f.service.request({ method: 'PUT', path: `/tasks/${task.id}`, body: { input: '已更新输入', reply: '' } }); assert.equal(edited.status, 'draft'); assert.equal(edited.reply, '');
  } finally { await f.done(); }
});

test('持久化可恢复，导出和导入不包含密钥', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flowdesk-test-'));
  let secret = '';
  const secrets = { get: async () => secret || undefined, set: async (v: string) => { secret = v; }, delete: async () => { secret = ''; } };
  try {
    const one = await createService({ dataDir: dir, secrets });
    await one.request({ method: 'PUT', path: '/settings', body: { provider: { baseUrl: 'http://127.0.0.1:9999/v1', model: 'test', temperature: 0, apiKey: 'top-secret' } } });
    const k = await one.request({ method: 'POST', path: '/knowledge', body: { title: '持久化', content: '内容', tags: [], enabled: true } });
    const exported = await one.request({ method: 'GET', path: '/export' });
    assert.equal(JSON.stringify(exported).includes('top-secret'), false); assert.equal(exported.provider.hasKey, false);
    const two = await createService({ dataDir: dir, secrets }); const state = await two.request({ method: 'GET', path: '/state' });
    assert.ok(state.knowledge.some((x: { id: string }) => x.id === k.id)); assert.equal(state.provider.hasKey, true);
    await two.request({ method: 'POST', path: '/import', body: { data: exported } });
    assert.equal((await two.request({ method: 'GET', path: '/state' })).provider.hasKey, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
