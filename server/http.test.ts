import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as nodeRequest } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createHttpServer } from './index.ts';

async function http(server: import('node:http').Server, path: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  const port = (server.address() as import('node:net').AddressInfo).port;
  return new Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = nodeRequest({ host: '127.0.0.1', port, path, method: options.method ?? 'GET', headers: options.headers }, res => { let body = ''; res.on('data', c => body += c); res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body })); }); req.on('error', reject); req.end(options.body);
  });
}

test('HTTP bootstrap、Origin/Host、会话、静态路径和下载边界', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowdesk-http-root-')); const dataDir = join(root, 'data');
  await mkdir(join(root, 'dist')); await writeFile(join(root, 'dist', 'index.html'), 'ok'); await writeFile(join(root, 'dist', 'app.js'), 'export {}');
  const server = await createHttpServer({ root, dataDir, port: 0 }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const port = (server.address() as import('node:net').AddressInfo).port; const correctHost = `127.0.0.1:${port}`;
    const noSession = await http(server, '/api/health', { headers: { Host: correctHost } }); assert.equal(noSession.status, 401); assert.deepEqual(JSON.parse(noSession.body), { error: '请先建立本地会话' });
    assert.equal((await http(server, '/api/bootstrap', { headers: { Host: correctHost, Origin: 'http://evil.invalid' } })).status, 403);
    assert.equal((await http(server, '/api/bootstrap', { headers: { Host: 'evil.invalid' } })).status, 403);
    const boot = await http(server, '/api/bootstrap', { headers: { Host: correctHost, Origin: `http://127.0.0.1:${port}` } }); assert.equal(boot.status, 200); assert.match(String(boot.headers['set-cookie']), /HttpOnly/);
    const cookie = String(boot.headers['set-cookie']).split(';')[0]; const health = await http(server, '/api/health', { headers: { Host: correctHost, Cookie: cookie } }); assert.equal(health.status, 200); assert.deepEqual(JSON.parse(health.body), { ok: true });
    const script = await http(server, '/app.js', { headers: { Host: correctHost } }); assert.equal(script.status, 200); assert.match(String(script.headers['content-type']), /^text\/javascript/);
    const justOverOneMeg = JSON.stringify({ input: 'x'.repeat(1_100_000) }); const largeSafe = await http(server, '/api/tasks', { method: 'POST', headers: { Host: correctHost, Cookie: cookie, 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(justOverOneMeg)) }, body: justOverOneMeg }); assert.equal(largeSafe.status, 400); assert.doesNotMatch(largeSafe.body, /请求体过大/);
    assert.equal((await http(server, '/%2e%2e/package.json', { headers: { Host: correctHost } })).status, 404);
    const missing = await http(server, '/downloads/windows', { headers: { Host: correctHost } }); assert.equal(missing.status, 404); assert.match(missing.body, /尚未生成/);
    const downloadHead = await http(server, '/downloads/windows', { method: 'HEAD', headers: { Host: correctHost } }); assert.equal(downloadHead.status, 404); assert.equal(downloadHead.body, '');
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
});
