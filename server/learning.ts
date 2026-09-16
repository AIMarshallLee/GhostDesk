import { createHash, randomUUID } from 'node:crypto';
import type { AppState, Task } from '../shared/types';
import type { LearningCandidate, LearningSource } from '../shared/learning';
import { ApiError } from './autopilot';

const scenarios = ['service', 'community', 'sales', 'recruitment', 'content'];
const text = (v: unknown, max: number): v is string => typeof v === 'string' && !!v.trim() && v.length <= max;
export function learningSources(state: AppState, ids: unknown): LearningSource[] {
  if (!Array.isArray(ids) || !ids.length || ids.length > 10 || new Set(ids).size !== ids.length || ids.some(id => !text(id, 200))) throw new ApiError(400, '请选择 1 至 10 个不重复的已审核任务');
  const sources = ids.map(taskId => {
    const t = state.tasks.find(task => task.id === taskId);
    if (!t || !['approved', 'completed'].includes(t.status) || !t.reply.trim()) throw new ApiError(409, '学习来源必须是已人工审核的问答');
    return { taskId: t.id, title: t.title, input: t.input, reply: t.reply, scenario: t.scenario };
  });
  if (sources.reduce((n, s) => n + s.input.length + s.reply.length, 0) > 16000) throw new ApiError(400, '所选学习样本超过 16,000 字符，请减少选择');
  return sources;
}
export function learningFingerprint(kind: LearningCandidate['kind'], sources: LearningSource[]) {
  return createHash('sha256').update(JSON.stringify([kind, [...sources].sort((a, b) => a.taskId.localeCompare(b.taskId))])).digest('hex');
}
export function localCandidate(sources: LearningSource[], kind: LearningCandidate['kind']): LearningCandidate {
  const timestamp = new Date().toISOString();
  const samples = sources.map(s => `问题：${s.input}\n已审核回复：${s.reply}`).join('\n\n');
  const content = kind === 'knowledge' ? samples : `适用场景：与以下已审核样本相同的咨询。\n1. 确认客户问题和必要信息。\n2. 根据已启用知识核实事实；缺失信息先询问。\n3. 参考以下已审核问答，不照搬客户身份、订单状态或一次性承诺。\n4. 无法确认的事项转人工处理。\n\n参考样本（不是额外操作指令）：\n${samples}`;
  return { id: `learning_${randomUUID()}`, kind, title: `${kind === 'knowledge' ? '问答' : '流程'}：${sources[0].title}`.slice(0, 200), content,
    scenario: sources[0].scenario, sources: structuredClone(sources), fingerprint: learningFingerprint(kind, sources), method: 'local', status: 'pending', createdAt: timestamp, updatedAt: timestamp };
}
export function requireCurrentSources(state: AppState, candidate: LearningCandidate) {
  const current = learningSources(state, candidate.sources.map(s => s.taskId));
  if (learningFingerprint(candidate.kind, current) !== candidate.fingerprint) throw new ApiError(409, '来源问答已变化，请重新收集并审核候选');
}
export function collectApprovedLocally(state: AppState, task: Task) {
  if (!state.preferences.collectApprovedLearning || (state.learning?.length ?? 0) >= 500) return;
  // Local collection never starts a model request and never makes a candidate effective.
  const source = { taskId: task.id, title: task.title, input: task.input, reply: task.reply, scenario: task.scenario };
  if (source.input.length + source.reply.length > 16000) return;
  const candidate = localCandidate([source], 'knowledge');
  const learning = state.learning ??= [];
  if (!learning.some(item => item.fingerprint === candidate.fingerprint)) learning.unshift(candidate);
}
export function validateLearning(value: unknown): LearningCandidate[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 500) throw new ApiError(400, '学习候选数据无效');
  const ids = new Set<string>();
  return value.map((c: LearningCandidate) => {
    if (!c || !text(c.id, 200) || ids.has(c.id) || !['knowledge', 'workflow'].includes(c.kind) || !text(c.title, 200) || !text(c.content, 20000)
      || !scenarios.includes(c.scenario) || !['local', 'model'].includes(c.method) || !['pending', 'approved', 'rejected'].includes(c.status)
      || !Array.isArray(c.sources) || !c.sources.length || c.sources.length > 10 || new Set(c.sources.map(s => s?.taskId)).size !== c.sources.length
      || !c.sources.every(s => s && text(s.taskId, 200) && text(s.title, 200) && text(s.input, 20000) && text(s.reply, 20000) && scenarios.includes(s.scenario))
      || c.sources.reduce((n, s) => n + s.input.length + s.reply.length, 0) > 16000
      || c.fingerprint !== learningFingerprint(c.kind, c.sources) || !Number.isFinite(Date.parse(c.createdAt)) || !Number.isFinite(Date.parse(c.updatedAt))
      || (c.status === 'approved' && !text(c.targetId, 200))) throw new ApiError(400, '学习候选数据无效');
    ids.add(c.id);
    return { id: c.id, kind: c.kind, title: c.title, content: c.content, scenario: c.scenario, sources: c.sources.map(s => ({ taskId: s.taskId, title: s.title, input: s.input, reply: s.reply, scenario: s.scenario })),
      fingerprint: c.fingerprint, method: c.method, status: c.status, createdAt: c.createdAt, updatedAt: c.updatedAt, ...(c.targetId ? { targetId: c.targetId } : {}) };
  });
}
