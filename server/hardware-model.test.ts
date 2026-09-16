import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createService, LiveModelHardwareUnavailable } from './service';

async function fixture(fetchImpl: typeof fetch, beforeLiveModel: () => Promise<void>) {
  const dataDir = await mkdtemp(join(tmpdir(), 'flowdesk-hardware-model-'));
  const service = await createService({ dataDir, fetchImpl, beforeLiveModel });
  await service.request({ method: 'PUT', path: '/settings', body: { provider: { baseUrl: 'http://127.0.0.1:9999/v1', model: 'fictional-model', temperature: 0 } } });
  const task = await service.request({ method: 'POST', path: '/tasks', body: { input: '仅虚构硬件测试' } });
  return { service, task, async close() {
    await service.close();
    assert.ok(resolve(dataDir).startsWith(resolve(tmpdir(), 'flowdesk-hardware-model-')));
    await rm(dataDir, { recursive: true, force: true });
  } };
}
const generated = () => new Response(JSON.stringify({ choices: [{ message: { content: '不应在拔出后保存的虚构回复' } }] }), { headers: { 'content-type': 'application/json' } });

test('live task and provider test require hardware before fetch; offline demo remains available', async () => {
  let requests = 0, checks = 0;
  const f = await fixture(async () => { requests++; return generated(); }, async () => { checks++; throw new LiveModelHardwareUnavailable(); });
  try {
    await assert.rejects(f.service.request({ method: 'POST', path: `/tasks/${f.task.id}/generate`, body: { mode: 'live' } }), /必须连接匹配/);
    await assert.rejects(f.service.request({ method: 'POST', path: '/provider/test' }), /必须连接匹配/);
    assert.equal(requests, 0); assert.equal(checks, 2);
    await f.service.request({ method: 'POST', path: `/tasks/${f.task.id}/generate`, body: { mode: 'demo' } });
    assert.equal(requests, 0); assert.equal(checks, 2);
  } finally { await f.close(); }
});

test('unplugging during ordinary model request prevents a late reply from being saved', async () => {
  let connected = true, checks = 0, started!: () => void, respond!: (response: Response) => void;
  const fetching = new Promise<void>(resolve => { started = resolve; });
  const response = new Promise<Response>(resolve => { respond = resolve; });
  const f = await fixture(async () => { started(); return response; }, async () => { checks++; if (!connected) throw new LiveModelHardwareUnavailable(); });
  try {
    const generation = f.service.request({ method: 'POST', path: `/tasks/${f.task.id}/generate`, body: { mode: 'live' } });
    await fetching; connected = false; respond(generated());
    await assert.rejects(generation, /必须连接匹配/);
    const state = await f.service.request({ method: 'GET', path: '/state' });
    assert.equal(state.tasks.find((item: { id: string }) => item.id === f.task.id).reply, '');
    assert.equal(checks, 2);
  } finally { respond(generated()); await f.close(); }
});
