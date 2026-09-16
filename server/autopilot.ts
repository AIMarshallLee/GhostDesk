import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AutoJob, AutoMode, ReplyMode, SandboxMessage, SandboxState } from '../shared/autopilot.ts';

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
type Generate = (text: string, mode: AutoMode) => Promise<string>;
type Options = { dataDir: string; generate?: Generate; setTimer?: typeof setTimeout; clearTimer?: typeof clearTimeout; renameFile?: typeof rename };
type Body = Record<string, unknown>;
const MAX_TEXT = 20_000, MAX_ID = 200, RETRY_MS = 25;
const uid = () => crypto.randomUUID(), iso = () => new Date().toISOString();
const pending = new Set(['queued', 'generating', 'retrying']);
const terminal = new Set(['ready', 'copied', 'sent', 'failed', 'handoff']);
const keyFor = (job: AutoJob) => `sandbox-delivery:${job.id}`;

function seed(): SandboxState {
  return { version: 1,
    conversations: [{ id: 'lin', name: '林女士配送', topic: '配送', enabled: true }, { id: 'chen', name: '陈先生售后', topic: '退货', enabled: true }, { id: 'zhou', name: '周同学产品', topic: '产品', enabled: true }],
    messages: [], jobs: [], automation: { status: 'paused', mode: 'rules', replyMode: 'auto', processing: false },
    faults: { generateFailures: 0, sendFailures: 0, ackLosses: 0, delayMs: 0 },
    stats: { received: 0, sent: 0, duplicates: 0, failed: 0, handoff: 0, pending: 0 }, events: [], provider: { configured: false, baseUrl: '', model: '' } };
}
function rules(text: string, id: string) {
  if (id === 'lin') return text.includes('地址') ? '本地测试规则：配送地址修改需在发货前确认。请提供订单号和新地址。' : '本地测试规则：常规配送为下单后 1—2 个工作日发出；请提供订单号以核对进度。';
  if (id === 'chen') return text.includes('退') ? '本地测试规则：退货需提供订单号、商品状态和原因；签收后 7 天内可申请。' : '本地测试规则：请提供订单号和售后问题，便于核对退换条件。';
  return text.includes('功能') ? '本地测试规则：产品支持基础工作流与本地草稿。请说明您想确认的具体功能。' : '本地测试规则：请说明您想了解的产品功能或使用场景。';
}
function validState(value: unknown): value is SandboxState {
  const state = value as SandboxState;
  return !!state && state.version === 1 && Array.isArray(state.conversations) && Array.isArray(state.messages) && Array.isArray(state.jobs) && !!state.automation && !!state.faults && !!state.stats && Array.isArray(state.events) && !!state.provider;
}

export async function createAutopilot(options: Options) {
  await mkdir(options.dataDir, { recursive: true });
  const file = join(options.dataDir, 'flowdesk-sandbox.json');
  let state: SandboxState;
  try {
    const read = JSON.parse(await readFile(file, 'utf8'));
    if (!validState(read)) throw new ApiError(500, '本地模拟器状态无效');
    state = read; state.automation.status = 'paused'; state.automation.processing = false;
    for (const job of state.jobs) if (job.status === 'generating') job.status = 'queued';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    state = seed();
  }
  let timer: ReturnType<typeof setTimeout> | undefined, closed = false, epoch = 0, writing: Promise<void> = Promise.resolve();
  const set = options.setTimer ?? setTimeout, clear = options.clearTimer ?? clearTimeout;
  const renameFile = options.renameFile ?? rename;
  const replaceFile = async (temporary: string) => {
    let failure: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
      try { await renameFile(temporary, file); return; }
      catch (error) {
        failure = error;
        const code = (error as NodeJS.ErrnoException).code;
        if (!['EACCES', 'EBUSY', 'EPERM'].includes(code ?? '') || attempt === 4) break;
        await new Promise(resolve => setTimeout(resolve, 15 * (attempt + 1)));
      }
    }
    try { await unlink(temporary); } catch { /* Preserve the original replace error. */ }
    throw failure;
  };
  const persist = async () => {
    state.stats.pending = state.jobs.filter(job => pending.has(job.status)).length;
    const snapshot = JSON.stringify(state), temporary = `${file}.${process.pid}.${uid()}.tmp`;
    const write = writing.then(async () => { await writeFile(temporary, snapshot, 'utf8'); await replaceFile(temporary); });
    writing = write.catch(() => undefined); await write;
  };
  const record = (type: string, detail: string) => { state.events.unshift({ at: iso(), type, detail }); state.events = state.events.slice(0, 200); };
  const invalidate = () => { epoch++; state.automation.processing = false; };
  const handoff = (job: AutoJob, detail: string) => { if (!terminal.has(job.status)) { job.status = 'handoff'; state.stats.handoff++; record('handoff', detail); } };
  const schedule = () => {
    if (timer) { clear(timer); timer = undefined; }
    if (closed || state.automation.status !== 'running' || state.automation.processing) return;
    const due = state.jobs.some(job => job.status === 'queued' || (job.status === 'retrying' && (job.nextAttemptAt ?? 0) <= Date.now()));
    const next = state.jobs.filter(job => job.status === 'retrying' && (job.nextAttemptAt ?? Infinity) > Date.now()).map(job => job.nextAttemptAt!).sort((a, b) => a - b)[0];
    if (!due && !next) return;
    timer = set(() => { timer = undefined; void tick(); }, due ? Math.max(1, state.faults.delayMs) : Math.max(1, next - Date.now()));
  };
  const fail = (job: AutoJob, detail: string) => {
    job.error = detail;
    if (job.attempts >= 3) { job.status = 'failed'; state.stats.failed++; record('failed', detail); }
    else { job.status = 'retrying'; job.nextAttemptAt = Date.now() + RETRY_MS * job.attempts; record('retry', detail); }
  };
  const pauseForPersistenceFailure = (job: AutoJob, detail: string) => {
    state.automation.status = 'paused';
    state.automation.processing = false;
    if (job.status === 'generating') handoff(job, detail);
    record('persistence_failed', detail);
  };
  const tick = async (): Promise<void> => {
    if (closed || state.automation.status !== 'running' || state.automation.processing) return;
    const job = state.jobs.find(item => item.status === 'queued' || (item.status === 'retrying' && (item.nextAttemptAt ?? 0) <= Date.now()));
    if (!job) { schedule(); return; }
    const conversation = state.conversations.find(item => item.id === job.conversationId);
    const source = state.messages.find(item => item.id === job.messageId && item.conversationId === job.conversationId && item.role === 'customer');
    if (!conversation?.enabled) { handoff(job, '会话已由人工接管'); await persist(); schedule(); return; }
    if (!source) { job.status = 'failed'; job.error = '原始客户消息不存在'; state.stats.failed++; await persist(); schedule(); return; }
    const token = ++epoch, replyMode = state.automation.replyMode, mode = state.automation.mode;
    state.automation.processing = true; job.status = 'generating'; job.attempts++; job.nextAttemptAt = undefined;
    try { await persist(); } catch { pauseForPersistenceFailure(job, '本地状态保存失败，自动回复已暂停'); return; }
    try {
      const key = keyFor(job);
      if (state.messages.some(message => message.deliveryKey === key)) {
        job.status = 'sent'; job.error = undefined; state.stats.sent++; record('sent', job.id);
        await persist(); return;
      }
      if (state.faults.generateFailures > 0) { state.faults.generateFailures--; throw new Error('模拟生成失败'); }
      const reply = mode === 'rules' ? rules(source.text, source.conversationId) : await (() => {
        if (!options.generate) throw new ApiError(400, '实时模式未配置模型生成器');
        return options.generate(source.text, mode);
      })();
      if (closed || token !== epoch || state.automation.status !== 'running' || !conversation.enabled || job.status !== 'generating') return;
      job.reply = reply.trim().slice(0, MAX_TEXT);
      if (!job.reply) throw new Error('模型未返回可用文本');
      // 切换期间的旧结果只保留为草稿，不能补发。
      if (replyMode === 'manual' || state.automation.replyMode !== replyMode) { job.status = 'ready'; await persist(); return; }
      if (state.faults.sendFailures > 0) { state.faults.sendFailures--; throw new Error('模拟发送失败'); }
      state.messages.push({ id: uid(), conversationId: job.conversationId, role: 'assistant', text: job.reply, createdAt: iso(), replyTo: source.id, deliveryKey: key, source: mode });
      await persist(); // 先落盘交付键，ACK 丢失或重启都不会重复投递。
      if (closed || token !== epoch || state.automation.status !== 'running' || state.automation.replyMode !== replyMode || !conversation.enabled || job.status !== 'generating') return;
      if (state.faults.ackLosses > 0) { state.faults.ackLosses--; job.status = 'retrying'; job.nextAttemptAt = Date.now() + RETRY_MS; record('ack_lost', job.id); }
      else { job.status = 'sent'; job.error = undefined; state.stats.sent++; record('sent', job.id); }
    } catch (error) {
      if (!closed && token === epoch && state.automation.status === 'running' && job.status === 'generating') fail(job, error instanceof Error ? error.message : '模拟失败');
    } finally {
      if (token === epoch) state.automation.processing = false;
      try { await persist(); } catch { pauseForPersistenceFailure(job, '本地状态保存失败，自动回复已暂停'); return; }
      schedule();
    }
  };
  const bodyOf = (value: unknown): Body => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, '请求参数无效'); return value as Body; };
  const request = async (method: string, path: string, raw: unknown = {}) => {
    const body = bodyOf(raw);
    if (method === 'GET' && path === '/sandbox/state') return structuredClone(state);
    if (method === 'POST' && path === '/sandbox/messages') {
      const conversationId = typeof body.conversationId === 'string' ? body.conversationId : '', conversation = state.conversations.find(item => item.id === conversationId);
      const text = typeof body.text === 'string' ? body.text.trim() : '', role = body.role ?? 'customer';
      if (!conversation || !text || text.length > MAX_TEXT || !['customer', 'human'].includes(role as string)) throw new ApiError(400, '模拟消息无效');
      const messageId = body.id === undefined ? uid() : typeof body.id === 'string' && body.id.length > 0 && body.id.length <= MAX_ID ? body.id : (() => { throw new ApiError(400, '消息 ID 无效'); })();
      const old = state.messages.find(message => message.id === messageId);
      if (old) { if (old.conversationId !== conversationId || old.text !== text || old.role !== role) throw new ApiError(409, '消息 ID 冲突'); state.stats.duplicates++; await persist(); return structuredClone(old); }
      const message: SandboxMessage = { id: messageId, conversationId, role: role as 'customer' | 'human', text, createdAt: iso(), ...(role === 'human' ? { source: 'human' as const } : {}) };
      state.messages.push(message);
      if (role === 'customer') {
        state.stats.received++;
        const job: AutoJob = { id: uid(), conversationId, messageId, status: 'queued', attempts: 0 };
        state.jobs.push(job);
        if (!conversation.enabled) handoff(job, '会话已由人工接管');
      }
      else { conversation.enabled = false; for (const job of state.jobs.filter(job => job.conversationId === conversationId)) handoff(job, '人工消息已接管会话'); }
      await persist(); schedule(); return structuredClone(message);
    }
    if (method === 'POST' && path === '/sandbox/control') {
      const action = body.action;
      if (!['start', 'pause', 'stop', 'reset'].includes(action as string)) throw new ApiError(400, '控制动作无效');
      if (body.mode !== undefined && !['rules', 'live'].includes(body.mode as string)) throw new ApiError(400, '模式无效');
      if (body.replyMode !== undefined && !['auto', 'manual'].includes(body.replyMode as string)) throw new ApiError(400, '回复方式无效');
      if (action === 'reset') { invalidate(); state = seed(); await persist(); return structuredClone(state); }
      if (action === 'start') {
        const mode = (body.mode ?? state.automation.mode) as AutoMode;
        const replyMode = (body.replyMode ?? state.automation.replyMode) as ReplyMode;
        if (mode === 'live' && body.allowLive !== true) throw new ApiError(400, '实时模式需明确允许');
        if (mode === 'live' && !options.generate) throw new ApiError(400, '实时模式未配置模型服务');
        if (state.automation.mode !== mode || state.automation.replyMode !== replyMode) {
          invalidate();
          for (const job of state.jobs) if (pending.has(job.status)) handoff(job, '回复模式已切换，旧队列不自动投递');
        }
        state.automation.status = 'running'; state.automation.mode = mode; state.automation.replyMode = replyMode;
      } else if (action === 'pause') {
        invalidate(); state.automation.status = 'paused';
        for (const job of state.jobs) if (job.status === 'generating') { job.status = 'queued'; job.nextAttemptAt = undefined; }
      } else { invalidate(); state.automation.status = 'stopped'; for (const job of state.jobs) if (pending.has(job.status)) handoff(job, '自动回复已停止'); }
      await persist(); schedule(); return structuredClone(state);
    }
    if (method === 'POST' && path === '/sandbox/copy') {
      const job = typeof body.jobId === 'string' ? state.jobs.find(item => item.id === body.jobId) : undefined;
      if (!job || job.status !== 'ready') throw new ApiError(400, '没有可复制的草稿');
      job.status = 'copied'; record('copied', job.id); await persist(); return structuredClone(job);
    }
    const match = path.match(/^\/sandbox\/conversations\/(lin|chen|zhou)$/);
    if (method === 'POST' && match) {
      if (typeof body.enabled !== 'boolean') throw new ApiError(400, '会话无效');
      const conversation = state.conversations.find(item => item.id === match[1])!; conversation.enabled = body.enabled;
      if (!conversation.enabled) for (const job of state.jobs.filter(job => job.conversationId === conversation.id)) handoff(job, '会话已关闭自动回复');
      await persist(); schedule(); return structuredClone(conversation);
    }
    if (method === 'POST' && path === '/sandbox/faults') {
      const keys = ['generateFailures', 'sendFailures', 'ackLosses', 'delayMs'] as const;
      if (Object.keys(body).some(key => !keys.includes(key as typeof keys[number]))) throw new ApiError(400, '故障参数无效');
      for (const key of keys) if (body[key] !== undefined && (!Number.isInteger(body[key]) || (body[key] as number) < 0 || (body[key] as number) > 10_000)) throw new ApiError(400, '故障参数无效');
      state.faults = { ...state.faults, ...body }; await persist(); schedule(); return structuredClone(state.faults);
    }
    throw new ApiError(404, '接口不存在');
  };
  await persist();
  return { request, close: async () => { closed = true; invalidate(); if (timer) clear(timer); await writing; } };
}
