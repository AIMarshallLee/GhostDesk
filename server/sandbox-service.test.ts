import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createService } from './service.ts';

test('模拟器规则不调用模型，live 仅发送测试文本，正式工作区不被修改', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flowdesk-sandbox-service-'));
  const requests: string[] = [];
  const service = await createService({ dataDir: dir, fetchImpl: (async (_url, init) => {
    requests.push(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: '受控模型夹具回复' } }] }), { status: 200 });
  }) as typeof fetch });
  const state = () => service.request({ method: 'GET', path: '/sandbox/state' });
  const waitJob = async (status: string) => {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if ((await state()).jobs.at(-1)?.status === status) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail(`模拟任务未到达 ${status}`);
  };
  try {
    await service.request({ method: 'PUT', path: '/settings', body: { provider: { baseUrl: 'http://127.0.0.1:9999/v1', model: 'fixture-model', temperature: 0 } } });
    await service.request({ method: 'POST', path: '/knowledge', body: { title: '配送', content: 'PRIVATE_KNOWLEDGE_SENTINEL', enabled: true } });
    await service.request({ method: 'POST', path: '/tasks', body: { input: 'PRIVATE_TASK_SENTINEL' } });
    const original = await service.request({ method: 'GET', path: '/export' });
    assert.equal((await state()).provider.model, 'fixture-model');
    await service.request({ method: 'POST', path: '/sandbox/control', body: { action: 'start', mode: 'rules', replyMode: 'auto' } });
    await service.request({ method: 'POST', path: '/sandbox/messages', body: { conversationId: 'lin', text: '配送规则测试' } });
    await waitJob('sent');
    assert.equal(requests.length, 0);
    await service.request({ method: 'POST', path: '/sandbox/control', body: { action: 'start', mode: 'live', replyMode: 'manual', allowLive: true } });
    await service.request({ method: 'POST', path: '/sandbox/messages', body: { conversationId: 'lin', text: '配送虚构客户问题' } });
    await waitJob('ready');
    assert.equal(requests.length, 1);
    assert.match(requests[0], /配送虚构客户问题/);
    assert.doesNotMatch(requests[0], /PRIVATE_KNOWLEDGE_SENTINEL|PRIVATE_TASK_SENTINEL/);
    assert.deepEqual(await service.request({ method: 'GET', path: '/export' }), original);
    assert.equal((await state()).messages.filter((message: { role: string }) => message.role === 'assistant').length, 1);
  } finally { await service.close(); await rm(dir, { recursive: true, force: true }); }
});
