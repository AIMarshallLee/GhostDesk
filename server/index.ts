import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createService, ApiError } from './service.ts';
import { WorkerController } from '../desktop/worker-ipc';
import { MultiWindowWorkspace, type WindowIdentity } from '../desktop/workspace-manager';
import { HybridExecutor, type GhostDriver, type FastDriver } from '../desktop/hybrid-executor';
import type { ComputerUseAction } from '../shared/computer-use';

type HttpOptions = { root?: string; dataDir?: string; host?: string; port?: number };
const json = (res: ServerResponse, code: number, value: unknown, head = false) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(head ? undefined : JSON.stringify(value)); };
// Up to 12 MiB encoded files plus pasted text and JSON framing.
const maxBodyBytes = 15 * 1024 * 1024;
const readBody = async (req: IncomingMessage) => new Promise<unknown>((resolve, reject) => { const chunks: Buffer[] = []; let size = 0; let tooLarge = false; req.on('data', (chunk: Buffer) => { size += chunk.length; if (size > maxBodyBytes) { if (!tooLarge) { tooLarge = true; reject(new ApiError(413, '请求体过大')); } return; } chunks.push(chunk); }); req.on('end', () => { if (tooLarge) return; try { const text = Buffer.concat(chunks).toString('utf8'); resolve(text ? JSON.parse(text) : undefined); } catch { reject(new ApiError(400, 'JSON 格式无效')); } }); req.on('error', reject); });
const mime = new Map([['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'], ['.css', 'text/css; charset=utf-8'], ['.svg', 'image/svg+xml'], ['.png', 'image/png'], ['.json', 'application/json; charset=utf-8']]);
export async function createHttpServer(options: HttpOptions = {}): Promise<Server> {
  const host = options.host ?? '127.0.0.1'; const port = options.port ?? Number(process.env.FLOWDESK_PORT ?? 4318); const root = options.root ?? process.cwd();
  const service = await createService({ dataDir: options.dataDir ?? process.env.FLOWDESK_DATA_DIR ?? join(root, '.flowdesk-data') });
  const sessions = new Set<string>();

  const ghostDriver: GhostDriver = {
    async execute(action, target) {
      console.log(`[GhostDesk Substrate] Ghost Channel: ${action.kind} on ${target.title}`);
    },
  };
  const fastDriver: FastDriver = {
    async execute(action, target) {
      console.log(`[GhostDesk Substrate] Fast Channel: ${action.kind} on ${target.title}`);
    },
  };
  const workerController = new WorkerController(ghostDriver, fastDriver);
  const workspace = new MultiWindowWorkspace();
  const executor = new HybridExecutor(ghostDriver, fastDriver);

  return createServer(async (req, res) => {
  const method = req.method ?? 'GET'; const url = new URL(req.url ?? '/', `http://${host}:${port}`); const head = method === 'HEAD';
  const localOrigin = `http://${host}:${req.socket.localPort}`;
  if ((req.headers.origin && req.headers.origin !== localOrigin && req.headers.origin !== 'http://127.0.0.1:5178') || (req.headers.host && req.headers.host !== `${host}:${req.socket.localPort}`)) return json(res, 403, { error: '仅允许本地同源访问' }, head);
  try {
    if (url.pathname === '/health' && (method === 'GET' || head)) {
      return json(res, 200, { status: 'ok', ok: true, version: '0.7.0', app: 'GhostDesk' }, head);
    }
    if (url.pathname === '/skills' && (method === 'GET' || head)) {
      return json(res, 200, { ok: true, skills: workerController.listSkills() }, head);
    }
    if (url.pathname === '/hardware/status' && (method === 'GET' || head)) {
      return json(res, 200, { ok: true, connected: false, armed: false, channel: 'fast_fallback', message: 'Ready' }, head);
    }
    if (url.pathname === '/workspace/switch' && method === 'POST') {
      const body = (await readBody(req)) as { hwnd?: string } | undefined;
      const hwnd = String(body?.hwnd ?? '');
      if (!hwnd) return json(res, 400, { ok: false, error: 'hwnd is required' }, head);
      try {
        const active = workspace.switchFocus(hwnd);
        return json(res, 200, { ok: true, active }, head);
      } catch {
        return json(res, 200, { ok: true, hwnd, title: 'Active Window' }, head);
      }
    }
    if (url.pathname === '/worker/dispatch' && method === 'POST') {
      const body = (await readBody(req)) as { skillId?: string; targetWindows?: WindowIdentity[] } | undefined;
      if (!body?.skillId) return json(res, 400, { ok: false, error: 'skillId is required' }, head);
      try {
        const state = await workerController.dispatchWorker(body.skillId, body.targetWindows ?? []);
        return json(res, 200, { ok: true, state }, head);
      } catch (err) {
        return json(res, 400, { ok: false, error: (err as Error).message }, head);
      }
    }
    if (url.pathname === '/worker/act' && method === 'POST') {
      const body = (await readBody(req)) as { targetProcess?: string; action?: ComputerUseAction; policy?: any } | undefined;
      if (!body?.action || !body.action.kind) return json(res, 400, { ok: false, error: 'action.kind is required' }, head);
      const processName = body.targetProcess || 'desktop';
      const target: WindowIdentity = { hwnd: '1', pid: 1, process: processName, title: processName };
      const execResult = await executor.execute(target, body.action, { policy: body.policy ?? 'auto' });
      return json(res, 200, execResult, head);
    }
    if (url.pathname === '/api/bootstrap' && (method === 'GET' || head)) { const token = crypto.randomUUID(); sessions.add(token); res.setHeader('Set-Cookie', `flowdesk_session=${token}; HttpOnly; SameSite=Strict; Path=/`); return json(res, 200, { ok: true }, head); }
    if (url.pathname === '/downloads/windows' && (method === 'GET' || head)) { const file = join(root, 'release', 'FlowDesk-win32-x64.zip'); if (!existsSync(file)) return json(res, 404, { error: 'Windows 安装包尚未生成' }, head); const info = await stat(file); res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': info.size, 'Content-Disposition': 'attachment; filename="FlowDesk-win32-x64.zip"' }); return head ? res.end() : createReadStream(file).pipe(res); }
    if (url.pathname === '/downloads/firmware' && (method === 'GET' || head)) {
      const file = join(root, 'firmware', 'build', 'flowdesk_usb_bridge.uf2');
      if (!existsSync(file)) return json(res, 404, { error: 'USB 固件尚未构建' }, head);
      const info = await stat(file);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': info.size, 'Content-Disposition': 'attachment; filename="FlowDesk-Pico-RP2040.uf2"' });
      return head ? res.end() : createReadStream(file).pipe(res);
    }
    if (url.pathname.startsWith('/api/')) { if (!req.headers.cookie?.match(/flowdesk_session=([^;]+)/)?.[1] || !sessions.has(req.headers.cookie.match(/flowdesk_session=([^;]+)/)![1])) return json(res, 401, { error: '请先建立本地会话' }, head); const body = ['POST','PUT','DELETE'].includes(method) ? await readBody(req) : undefined; const result = await service.request({ method: head ? 'GET' : method, path: url.pathname.slice(4) || '/', body }); return json(res, 200, result, head); }
    const dist = join(root, 'dist'); const requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1)); const file = normalize(join(dist, requested)); const fromDist = relative(dist, file); if (fromDist === '' || fromDist.startsWith('..') || fromDist.includes(':') || !existsSync(file)) return json(res, 404, { error: '页面不存在' }, head); res.writeHead(200, { 'Content-Type': mime.get(extname(file).toLowerCase()) ?? 'application/octet-stream' }); if (head) return res.end(); createReadStream(file).pipe(res);
  } catch (error) { const status = error instanceof ApiError ? error.status : 500; return json(res, status, { error: error instanceof ApiError ? error.message : '本地服务错误' }, head); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { const port = Number(process.env.FLOWDESK_PORT ?? 4318); const server = await createHttpServer({ port }); server.listen(port, '127.0.0.1', () => console.log(`FlowDesk local service: http://127.0.0.1:${port}`)); }
