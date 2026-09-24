import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { defaultReplyLayout, type ChatObservation, type DesktopReplyConfig, type DesktopReplyJob, type DesktopReplyStart, type DesktopReplyState, type ReplyConversation, type VisibleChatMessage } from '../shared/desktop-replies';
import { TransientChatChange, type DesktopRepliesDependencies, type DesktopChatSurface } from './replies-contract';
import { analyzePsychologyAndIntent, generateTripleCandidates } from '../server/psychology-diagnostic';

const fileName = 'desktop-replies.json';
const maxJobs = 600;
const same = (a: VisibleChatMessage, b: VisibleChatMessage) => a.direction === b.direction && a.text === b.text && a.stamp === b.stamp;
const clone = <T>(value: T): T => structuredClone(value);
const defaultConfig = (): DesktopReplyConfig => ({ conversations: [], layout: clone(defaultReplyLayout), mode: 'manual', pollSeconds: 15, maxRepliesPerHour: 30, knowledgeMode: 'selected', knowledgeIds: [], workflowId: '', inputBackend: 'usb', modelProtocol: 'gemini-native', humanDelay: true, splitBubbles: false });
const initial = (): DesktopReplyState => ({ version: 1, config: defaultConfig(), status: 'stopped', message: '', busy: false, cycle: 0, jobs: [], checkpoints: {}, events: [] });
function event(state: DesktopReplyState, type: string, detail: string) { state.events.unshift({ at: new Date().toISOString(), type, detail: detail.slice(0, 240) }); state.events.splice(80); }
function validConfig(value: DesktopReplyConfig): void {
  if (value?.knowledgeMode !== undefined && !['selected', 'retrieve'].includes(value.knowledgeMode)) throw new Error('知识使用方式无效');
  if (value?.modelProtocol !== undefined && !['gemini-native', 'openai-vision'].includes(value.modelProtocol)) throw new Error('持续回复模型协议无效');
  if (value?.inputBackend !== undefined && !['windows', 'usb'].includes(value.inputBackend)) throw new Error('输入执行方式无效');
  if (value?.humanDelay !== undefined && typeof value.humanDelay !== 'boolean') throw new Error('拟人延时配置无效');
  if (value?.splitBubbles !== undefined && typeof value.splitBubbles !== 'boolean') throw new Error('气泡拆分配置无效');
  if (!value || !Array.isArray(value.conversations) || value.conversations.length > 30 || !['manual', 'auto'].includes(value.mode) || !Number.isInteger(value.pollSeconds) || value.pollSeconds < 2 || value.pollSeconds > 3600 || !Number.isInteger(value.maxRepliesPerHour) || value.maxRepliesPerHour < 1 || value.maxRepliesPerHour > 500 || !Array.isArray(value.knowledgeIds) || value.knowledgeIds.length > 50 || typeof value.workflowId !== 'string' || value.workflowId.length > 200) throw new Error('回复配置无效');
  const seen = new Set<string>();
  const ids = new Set<string>(); for (const item of value.conversations) { if (!item || typeof item.id !== 'string' || typeof item.name !== 'string' || !item.id.trim() || !item.name.trim() || item.id !== item.id.trim() || item.name !== item.name.trim() || item.id.length > 200 || item.name.length > 200 || ['__proto__', 'constructor', 'prototype'].includes(item.id) || seen.has(item.name) || ids.has(item.id) || typeof item.enabled !== 'boolean') throw new Error('会话配置必须使用唯一名称'); seen.add(item.name); ids.add(item.id); }
  if (!value.layout || Object.keys(value.layout).length !== 5 || !['conversations', 'header', 'messages', 'composer', 'send'].every((key) => Object.hasOwn(value.layout, key))) throw new Error('窗口区域无效'); for (const rect of Object.values(value.layout)) if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0 || rect.x + rect.width > 1 || rect.y + rect.height > 1) throw new Error('窗口区域无效');
  if (value.knowledgeIds.some((id) => typeof id !== 'string' || !id || id.length > 200)) throw new Error('知识资料无效');
}
function observation(value: ChatObservation): boolean { return !!value && typeof value.conversationName === 'string' && value.conversationName.length <= 200 && Array.isArray(value.messages) && value.messages.length <= 60 && typeof value.composerText === 'string' && value.composerText.length <= 4096 && typeof value.observedAt === 'string' && value.messages.every((m) => m && (m.direction === 'incoming' || m.direction === 'outgoing') && typeof m.text === 'string' && m.text.length <= 4096 && typeof m.stamp === 'string' && m.stamp.length <= 200); }
function validStored(value: DesktopReplyState) {
  if (!value || value.version !== 1 || !Array.isArray(value.jobs) || value.jobs.length > maxJobs || !Array.isArray(value.events) || value.events.length > 80 || !Number.isInteger(value.cycle)) throw new Error('invalid journal');
  validConfig(value.config);
  for (const job of value.jobs) if (!job || typeof job.id !== 'string' || typeof job.conversationId !== 'string' || typeof job.conversationName !== 'string'
    || typeof job.input !== 'string' || typeof job.reply !== 'string' || job.reply.length > 4096 || !observation(job.observation)
    || !['queued', 'generating', 'ready', 'copied', 'sending', 'visually_confirmed', 'uncertain', 'handoff', 'failed'].includes(job.status)
    || !Number.isInteger(job.attempts) || typeof job.createdAt !== 'string' || typeof job.updatedAt !== 'string'
    || !Array.isArray(job.knowledgeIds) || typeof job.knowledgeHash !== 'string' || !['manual', 'auto'].includes(job.mode)) throw new Error('invalid journal job');
  for (const item of value.events) if (!item || typeof item.at !== 'string' || typeof item.type !== 'string' || typeof item.detail !== 'string') throw new Error('invalid event');
}
function overlap(old: VisibleChatMessage[], next: VisibleChatMessage[]): VisibleChatMessage[] | undefined {
  if (!old.length) return next;
  for (let size = Math.min(old.length, next.length); size > 0; size--) {
    if (old.slice(-size).every((m, i) => same(m, next[i]))) return next.slice(size);
  }
  return old.length === next.length && old.every((m, i) => same(m, next[i])) ? [] : undefined;
}

export async function createDesktopReplies(deps: DesktopRepliesDependencies) {
  const path = join(deps.directory, fileName); let state = initial(); let surface: DesktopChatSurface | undefined; const jobContexts = new Map<string, { knowledge: string; instructions: string }>();
  let timer: ReturnType<typeof setTimeout> | undefined; let run: Promise<void> | undefined; let aborter: AbortController | undefined; let epoch = 0; let closed = false; let ioFault = state.status === 'needs_attention'; let writeTail = Promise.resolve(); let writeId = 0;
  try { const raw = await readFile(path, 'utf8'); if (raw.length > 32000000) throw new Error('journal too large'); const stored = JSON.parse(raw) as DesktopReplyState; validStored(stored); state = stored; state.status = 'paused'; state.busy = false; state.checkpoints = {}; delete state.nextScanAt; for (const job of state.jobs) { if (job.status === 'sending') job.status = 'uncertain'; if (['queued', 'ready', 'generating'].includes(job.status)) job.status = 'handoff'; if (job.status === 'uncertain') { const conversation = state.config.conversations.find(item => item.id === job.conversationId); if (conversation) conversation.enabled = false; } } event(state, 'restart', '重启后已暂停，旧任务交人工并等待新基线'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { ioFault = true; state = initial(); state.status = 'needs_attention'; state.message = '本地状态无法读取，未覆盖原记录；请备份并检查日志文件'; } }
  let closing = Promise.resolve();
  const releaseSurface = () => { const active = surface; surface = undefined; closing = closing.then(async () => { await active?.close(); }).catch(() => { ioFault = true; aborter?.abort(); state.status = 'needs_attention'; state.message = '设备会话停止失败，请检查连接并重新打开软件'; throw new Error(state.message); }); void closing.catch(() => {}); return closing; };
  const now = () => deps.now?.() ?? Date.now(); const set = deps.setTimer ?? setTimeout; const clear = deps.clearTimer ?? clearTimeout;
  const persist = async () => { if (ioFault) throw new Error('保存不可用'); const snapshot = JSON.stringify(state); const write = async () => { if (ioFault) throw new Error('保存不可用'); try { await mkdir(deps.directory, { recursive: true }); const temp = `${path}.${process.pid}.${Date.now()}.${++writeId}.tmp`; await writeFile(temp, snapshot, { encoding: 'utf8', mode: 0o600, flush: true }); await rename(temp, path); } catch { ioFault = true; aborter?.abort(); if (timer) clear(timer); state.status = 'needs_attention'; state.message = '本地状态保存失败，已暂停'; state.busy = false; throw new Error('保存失败'); } }; const next = writeTail.then(write); writeTail = next.catch(() => {}); return next; };
  const schedule = () => { if (timer) clear(timer); if (closed || state.status !== 'running') return; state.nextScanAt = new Date(now() + state.config.pollSeconds * 1000).toISOString(); timer = set(() => { timer = undefined; void tick(); }, state.config.pollSeconds * 1000); };
  const cancel = () => { epoch++; aborter?.abort(); if (timer) { clear(timer); timer = undefined; } delete state.nextScanAt; return epoch; };
  const unfinished = () => { for (const job of state.jobs) { if (job.status === 'sending') { job.status = 'uncertain'; const conversation = state.config.conversations.find(item => item.id === job.conversationId); if (conversation) conversation.enabled = false; } else if (['queued', 'generating'].includes(job.status) || (job.mode === 'auto' && job.status === 'ready')) { job.status = 'handoff'; job.detail = '运行已中断，旧任务不自动重放'; } } jobContexts.clear(); };
  // Count attempts, including uncertain outcomes. Retention must not reset the rolling limit.
  const sentThisHour = () => state.jobs.filter((job) => ['visually_confirmed', 'uncertain', 'sending'].includes(job.status) && now() - Date.parse(job.updatedAt) < 3_600_000).length;
  const handoff = (conversation: ReplyConversation, detail: string) => { conversation.enabled = false; event(state, 'handoff', `${conversation.name}: ${detail}`); };
  const processJob = async (job: DesktopReplyJob, conversation: ReplyConversation, signal: AbortSignal, token: number) => {
    if (!surface || ioFault || state.status !== 'running' || !conversation.enabled || token !== epoch || signal.aborted || job.status === 'uncertain' || job.status === 'handoff') return;
    if (job.status === 'queued') {
      job.status = 'generating'; job.updatedAt = new Date(now()).toISOString(); await persist();
      try {
        const context = jobContexts.get(job.id) ?? await deps.context(state.config, job.input); if (signal.aborted || token !== epoch) return;
        const reply = await deps.generate({ conversation, incoming: [{ direction: 'incoming', text: job.input, stamp: job.observation.messages.at(-1)?.stamp ?? '' }], history: job.observation.messages, knowledge: context.knowledge, instructions: context.instructions }, signal);
        if (signal.aborted || token !== epoch) return;
        const psychology = analyzePsychologyAndIntent(job.input, job.observation.messages);
        const candidates = generateTripleCandidates(reply.trim(), psychology, job.input);
        job.psychology = psychology; job.candidates = candidates; job.selectedCandidateId = 'warm';
        job.reply = reply.trim(); job.status = 'ready'; job.updatedAt = new Date(now()).toISOString(); await persist();
      } catch {
        if (signal.aborted || token !== epoch) return;
        job.attempts++; job.updatedAt = new Date(now()).toISOString(); job.detail = '生成失败';
        job.status = job.attempts >= 3 ? 'handoff' : 'queued'; if (job.status === 'handoff') handoff(conversation, '生成连续失败'); await persist(); return;
      }
    }
    if (state.config.mode !== 'auto' || job.mode !== 'auto' || job.status !== 'ready' || signal.aborted || token !== epoch) return;
    if (sentThisHour() >= state.config.maxRepliesPerHour) { job.status = 'handoff'; job.detail = '已达到小时发送上限'; handoff(conversation, job.detail); await persist(); return; }
    const fresh = await surface.observe(conversation, signal); if (signal.aborted || token !== epoch || ioFault) return;
    if (!observation(fresh) || fresh.conversationName !== conversation.name || fresh.composerText || !sameMessages(fresh.messages, job.observation.messages)) { job.status = 'handoff'; job.detail = '发现新消息或人工草稿，未发送旧回复'; handoff(conversation, job.detail); await persist(); return; }
    job.status = 'sending'; job.updatedAt = new Date(now()).toISOString(); await persist();
    if (signal.aborted || token !== epoch || ioFault) return;
    const bubbles = state.config.splitBubbles ? splitReplyBubbles(job.reply) : [job.reply];
    let currentObservation = fresh;
    let lastResult: { status: 'visually_confirmed' | 'uncertain' | 'stale'; observation?: ChatObservation } = { status: 'uncertain' };
    const isTest = process.env.NODE_ENV === 'test' || Boolean(process.env.TEST) || process.execArgv.some(a => a.includes('--test')) || process.argv.some(a => a.includes('--test'));
    if (state.config.humanDelay && !deps.now && !isTest) {
      const delayMs = 1500 + Math.floor(Math.random() * 2000);
      await new Promise<void>((r) => { const t = setTimeout(r, delayMs); signal.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true }); });
      if (signal.aborted || token !== epoch) return;
    }
    try {
      for (let i = 0; i < bubbles.length; i++) {
        const bubble = bubbles[i];
        if (i > 0 && state.config.humanDelay && !deps.now && !isTest) {
          const pauseMs = 600 + Math.floor(Math.random() * 1000);
          await new Promise<void>((r) => { const t = setTimeout(r, pauseMs); signal.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true }); });
          if (signal.aborted || token !== epoch) return;
        }
        const result = await surface.deliver(conversation, currentObservation, bubble, signal);
        lastResult = result;
        if (result.status !== 'visually_confirmed' || !result.observation) break;
        currentObservation = result.observation;
      }
      if (signal.aborted || token !== epoch) { job.status = 'uncertain'; job.detail = '发送过程被中断，等待人工确认'; handoff(conversation, job.detail); await persist(); return; }
      const confirmed = lastResult.status === 'visually_confirmed' && lastResult.observation && observation(lastResult.observation) && lastResult.observation.conversationName === conversation.name;
      job.status = confirmed ? 'visually_confirmed' : lastResult.status === 'stale' ? 'handoff' : 'uncertain'; job.observation = confirmed ? lastResult.observation! : fresh; if (confirmed) state.checkpoints[conversation.id] = { ...job.observation, messages: job.observation.messages.slice(-60) }; else handoff(conversation, lastResult.status === 'stale' ? '发送前上下文已变化' : '发送结果不确定'); job.updatedAt = new Date(now()).toISOString(); job.detail = confirmed ? '视觉确认已发送' : lastResult.status === 'stale' ? '发送前上下文已变化' : '发送结果不确定，等待人工'; await persist();
    } catch { job.status = 'uncertain'; handoff(conversation, '发送结果不确定'); job.updatedAt = new Date(now()).toISOString(); job.detail = '发送结果不确定，等待人工确认'; try { await persist(); } catch { /* already fail-closed */ } }
  };
  const scan = async (conversation: ReplyConversation, signal: AbortSignal, token: number) => {
    if (!surface || !conversation.enabled || signal.aborted || token !== epoch) return;
    try {
      const next = await surface.observe(conversation, signal); if (signal.aborted || token !== epoch || ioFault) return;
      if (!observation(next) || next.conversationName !== conversation.name) { handoff(conversation, '会话识别不一致'); return; }
      const old = state.checkpoints[conversation.id]; if (!old) { state.checkpoints[conversation.id] = { ...next, messages: next.messages.slice(-60) }; return; }
      const added = overlap(old.messages, next.messages);
      state.checkpoints[conversation.id] = { ...next, messages: next.messages.slice(-60) };
      if (added === undefined || added.some((m) => m.direction === 'outgoing')) { handoff(conversation, added === undefined ? '消息连续性无法确认' : '检测到人工发出消息'); return; }
      const incoming = added.filter((m) => m.direction === 'incoming'); if (incoming.length) {
        const input = incoming.map((m) => m.text).join('\n');
        if (deps.onIncomingLead) { void Promise.resolve(deps.onIncomingLead(conversation.name, input)).catch(() => {}); }
        if (input.length > 4096) { handoff(conversation, '新增消息过长，请人工处理'); return; } const context = await deps.context(state.config, input); if (signal.aborted || token !== epoch) return; const id = `reply-${now()}-${Math.random().toString(36).slice(2, 8)}`; jobContexts.set(id, context); state.jobs.unshift({ id, conversationId: conversation.id, conversationName: conversation.name, input, reply: '', status: 'queued', observation: next, attempts: 0, createdAt: new Date(now()).toISOString(), updatedAt: new Date(now()).toISOString(), detail: '', knowledgeIds: clone(context.knowledgeIds ?? state.config.knowledgeIds), knowledgeHash: createHash('sha256').update(JSON.stringify(context)).digest('hex'), mode: state.config.mode }); }
      if (state.jobs.length > maxJobs) { const removable = state.jobs.findIndex(job => !['queued', 'generating', 'ready', 'sending', 'uncertain'].includes(job.status) && now() - Date.parse(job.updatedAt) >= 3600000); if (removable >= 0) state.jobs.splice(removable, 1); else { handoff(conversation, '本地保留任务已满，请等待一小时后继续'); state.jobs.shift(); } }
      for (const id of jobContexts.keys()) if (!state.jobs.some(job => job.id === id && ['queued', 'generating'].includes(job.status))) jobContexts.delete(id);
      for (const job of state.jobs.filter((j) => j.conversationId === conversation.id && (j.status === 'queued' || j.status === 'ready'))) await processJob(job, conversation, signal, token);
    } catch (error) {
      if (!signal.aborted && token === epoch) {
        if (error instanceof TransientChatChange) event(state, 'deferred', `${conversation.name}: 消息正在变化，保留旧检查点等待下轮复核`);
        else handoff(conversation, '会话扫描失败');
      }
    }
  };
  const tick = async () => { if (run || closed || ioFault || state.status !== 'running' || !surface) return; const token = epoch; const controller = aborter ?? new AbortController(); state.busy = true; state.cycle++; state.lastScanAt = new Date(now()).toISOString();
    run = (async () => { try { for (const conversation of state.config.conversations) { if (ioFault || state.status !== 'running' || controller.signal.aborted || token !== epoch) break; await scan(conversation, controller.signal, token); } if (state.status === 'running' && !state.config.conversations.some(item => item.enabled)) { state.status = 'needs_attention'; state.message = '所有会话已转人工，请处理提示后重新启动'; cancel(); await releaseSurface(); } if (!ioFault) await persist(); } catch { /* persist fail-closed */ } finally { state.busy = false; run = undefined; if (!ioFault && !controller.signal.aborted && token === epoch) schedule(); } })(); await run; };
  return {
    state: () => clone(state),
    async saveConfig(config: DesktopReplyConfig) { if (ioFault || closed) throw new Error('本地状态需人工修复'); validConfig(config); const token = cancel(); await run; if (token !== epoch) return clone(state); await releaseSurface(); if (token !== epoch) return clone(state); unfinished(); state.status = 'paused'; state.message = '配置已变更，请重新开始监听'; state.config = clone(config); event(state, 'config', '配置已保存'); await persist(); return clone(state); },
    async start(input: DesktopReplyStart) { if (ioFault || closed) throw new Error('本地状态需人工修复'); if (!input || typeof input.targetId !== 'string' || !input.targetId || input.allowModel !== true || !state.config.conversations.some(item => item.enabled)) throw new Error('启动授权或会话配置无效'); validConfig(state.config); await deps.context(state.config); const token = cancel(); await run; if (token !== epoch) return clone(state); await releaseSurface(); if (token !== epoch) return clone(state); unfinished(); const candidate = await deps.createSurface(input.targetId, clone(state.config)); if (token !== epoch) { await candidate.close(); return clone(state); } const controller = new AbortController(); aborter = controller; try { await candidate.open(controller.signal); } catch { await candidate.close(); if (token !== epoch) return clone(state); state.status = 'needs_attention'; state.message = '无法打开所选窗口，请重新选择并检查模型配置'; await persist(); throw new Error(state.message); } if (token !== epoch || controller.signal.aborted) { await candidate.close(); return clone(state); } surface = candidate; state.checkpoints = {}; state.target = clone(surface.target); state.status = 'running'; state.message = ''; event(state, 'start', '已开始监听'); await persist(); if (token === epoch) void tick(); return clone(state); },
    async pause() { const token = cancel(); const pendingClose = releaseSurface(); state.status = 'paused'; state.message = '已暂停'; await run; await pendingClose; if (token !== epoch) return clone(state); unfinished(); await persist(); return clone(state); },
    async stop() { const token = cancel(); const pendingClose = releaseSurface(); state.status = 'stopped'; state.message = '已停止'; await run; await pendingClose; if (token !== epoch) return clone(state); unfinished(); await persist(); return clone(state); },
    async takeover(conversationId: string, enabled: boolean) { const conversation = state.config.conversations.find((c) => c.id === conversationId); if (!conversation || typeof enabled !== 'boolean') throw new Error('会话不存在或状态无效'); const token = cancel(); const pendingClose = releaseSurface(); state.status = 'paused'; await run; await pendingClose; if (token !== epoch) return clone(state); unfinished(); conversation.enabled = enabled; state.message = '人工接管后已暂停，请手动重新开始'; event(state, 'takeover', `${conversation.name}: ${enabled ? '恢复配置' : '人工接管'}`); await persist(); return clone(state); },
    async copy(jobId: string) { const job = state.jobs.find((j) => j.id === jobId); if (!job || !job.reply) throw new Error('草稿不存在'); if (job.status === 'ready') { job.status = 'copied'; job.updatedAt = new Date(now()).toISOString(); await persist(); } return job.reply; },
    async resolve(jobId: string) { const job = state.jobs.find((j) => j.id === jobId); if (!job) throw new Error('任务不存在'); if (job.status === 'uncertain' || job.status === 'handoff' || job.status === 'failed') { job.status = 'handoff'; job.detail = '已由人工处理'; job.updatedAt = new Date(now()).toISOString(); await persist(); } return clone(state); },
    async selectCandidate(jobId: string, candidateId: 'quick' | 'warm' | 'conversion') {
      const job = state.jobs.find((j) => j.id === jobId);
      if (!job) throw new Error('任务不存在');
      const candidate = job.candidates?.find(c => c.id === candidateId);
      if (candidate) {
        job.reply = candidate.text;
        job.selectedCandidateId = candidateId;
        job.updatedAt = new Date(now()).toISOString();
        await persist();
      }
      return clone(state);
    },
    async close() { if (closed) { await run; await closing; await writeTail; return; } closed = true; cancel(); const pendingClose = releaseSurface(); state.status = ioFault ? 'needs_attention' : 'paused'; await run; await pendingClose; unfinished(); if (!ioFault) await persist(); await writeTail; },
    async waitForIdle() { while (run) await run; },
    async tickNow() { const requestedEpoch = epoch; const pending = run; if (pending) await pending; if (requestedEpoch !== epoch || closed || ioFault || state.status !== 'running' || !surface) return clone(state); await tick(); return clone(state); },
  };
}
function sameMessages(a: VisibleChatMessage[], b: VisibleChatMessage[]) { return a.length === b.length && a.every((m, i) => same(m, b[i])); }
export function splitReplyBubbles(text: string): string[] {
  if (text.length <= 30) return [text];
  const parts = text.split(/(?<=[。\n！？!?])\s*/).filter(p => p.trim().length > 0);
  if (parts.length <= 1) return [text];
  const chunks: string[] = [];
  let current = '';
  for (const part of parts) {
    if ((current + part).length > 25 && current.length > 0) {
      chunks.push(current.trim());
      current = part;
    } else {
      current += part;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text];
}
