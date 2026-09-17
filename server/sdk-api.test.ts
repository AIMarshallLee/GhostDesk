import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as nodeRequest } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createHttpServer } from './index.ts';

async function req(server: import('node:http').Server, path: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  const port = (server.address() as import('node:net').AddressInfo).port;
  return new Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders; body: any }>((resolve, reject) => {
    const clientReq = nodeRequest({ host: '127.0.0.1', port, path, method: options.method ?? 'GET', headers: options.headers }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let parsed = data;
        try { parsed = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: parsed });
      });
    });
    clientReq.on('error', reject);
    clientReq.end(options.body);
  });
}

test('Python SDK & Substrate HTTP endpoints (/health, /skills, /hardware/status, /worker/act, /workspace/switch, /worker/dispatch)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ghostdesk-sdk-api-'));
  const dataDir = join(root, 'data');
  const server = await createHttpServer({ root, dataDir, port: 0 });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const port = (server.address() as import('node:net').AddressInfo).port;
    const headers = { Host: `127.0.0.1:${port}` };

    // 1. /health
    const health = await req(server, '/health', { headers });
    assert.equal(health.status, 200);
    assert.equal(health.body.status, 'ok');
    assert.equal(health.body.ok, true);
    assert.equal(health.body.app, 'GhostDesk');

    // 2. /skills
    const skills = await req(server, '/skills', { headers });
    assert.equal(skills.status, 200);
    assert.equal(skills.body.ok, true);
    assert.ok(Array.isArray(skills.body.skills));
    assert.ok(skills.body.skills.length >= 1);
    assert.equal(skills.body.skills[0].id, 'skill_order_to_excel');

    // 3. /hardware/status
    const hw = await req(server, '/hardware/status', { headers });
    assert.equal(hw.status, 200);
    assert.equal(hw.body.ok, true);
    assert.equal(typeof hw.body.connected, 'boolean');

    // 4. /workspace/switch
    const switchRes = await req(server, '/workspace/switch', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ hwnd: '9999' }),
    });
    assert.equal(switchRes.status, 200);
    assert.equal(switchRes.body.ok, true);

    // 5. /worker/act
    const actRes = await req(server, '/worker/act', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetProcess: 'notepad.exe',
        action: { kind: 'type', text: 'Hello GhostDesk' },
        policy: 'fast',
      }),
    });
    assert.equal(actRes.status, 200);
    assert.equal(actRes.body.ok, true);
    assert.equal(actRes.body.channel, 'fast');

    // 6. /worker/dispatch
    const dispatchRes = await req(server, '/worker/dispatch', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skillId: 'skill_order_to_excel',
        targetWindows: [
          { hwnd: '101', pid: 10, process: 'wechat.exe', title: '微信' },
          { hwnd: '102', pid: 11, process: 'excel.exe', title: '订单.xlsx' },
        ],
      }),
    });
    assert.equal(dispatchRes.status, 200);
    assert.equal(dispatchRes.body.ok, true);
    assert.equal(dispatchRes.body.state.status, 'completed');
    assert.equal(dispatchRes.body.state.progressPercentage, 100);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
