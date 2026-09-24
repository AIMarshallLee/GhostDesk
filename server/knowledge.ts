import { createHash, randomUUID } from 'node:crypto';
import type { AppState, Knowledge, Scenario } from '../shared/types';
import type { KnowledgeDraft, KnowledgeEvaluationResult, KnowledgeHit, KnowledgeImportPreview, KnowledgeSearchInput, KnowledgeSearchResult } from '../shared/knowledge';
import { KNOWLEDGE_IMPORT_LIMITS } from '../shared/knowledge';
import { ApiError } from './autopilot';

const scenarios = ['all', 'service', 'community', 'sales', 'recruitment', 'content'];
const norm = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
// Decimal points, minus signs and ranges are part of business facts, not formatting.
const fingerprintText = (value: string) => norm(value).replace(/\s+/g, '').replace(/[?？。!！]+$/, '');
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max: number, required = false): value is string => typeof value === 'string' && value.length <= max && (!required || !!value.trim());
const strings = (value: unknown, count: number, length: number): value is string[] => Array.isArray(value) && value.length <= count && value.every(item => text(item, length, true));
export const knowledgeAvailable = (item: Knowledge) => item.enabled && item.reviewStatus !== 'pending';
export function knowledgeMetadataValid(item: Knowledge) {
  return (item.question === undefined || text(item.question, 2000)) && (item.aliases === undefined || strings(item.aliases, 30, 500))
    && (item.scenario === undefined || scenarios.includes(item.scenario)) && (item.source === undefined || text(item.source, 200))
    && (item.sourceLocator === undefined || text(item.sourceLocator, 300)) && (item.importId === undefined || text(item.importId, 100, true))
    && (item.reviewStatus === undefined || ['pending', 'approved'].includes(item.reviewStatus))
    && (item.approvedAt === undefined || text(item.approvedAt, 50) && Number.isFinite(Date.parse(item.approvedAt)))
    && !(item.reviewStatus === 'pending' && item.enabled);
}
export function readKnowledgeDraft(raw: unknown): KnowledgeDraft {
  if (!object(raw) || !text(raw.title, 200, true) || !text(raw.content, 20000, true) || !strings(raw.tags, 20, 100)
    || (raw.question !== undefined && !text(raw.question, 2000)) || (raw.aliases !== undefined && !strings(raw.aliases, 30, 500))
    || (raw.scenario !== undefined && !scenarios.includes(raw.scenario as string))) throw new ApiError(400, '知识条目无效：请检查标题、正文、相似问法、标签和场景');
  return { title: raw.title.trim(), content: raw.content.trim(), tags: [...new Set(raw.tags.map(t => t.trim()))],
    question: typeof raw.question === 'string' ? raw.question.trim() : '', aliases: [...new Set((raw.aliases as string[] | undefined ?? []).map(t => t.trim()))], scenario: (raw.scenario ?? 'all') as Scenario | 'all' };
}
export function knowledgeFingerprint(item: KnowledgeDraft) {
  return createHash('sha256').update(JSON.stringify([fingerprintText(item.question || item.title), fingerprintText(item.content), item.scenario || 'all'])).digest('hex');
}

const stopTerms = new Set(['你好', '您好', '请问', '一下', '可以', '可不', '能不', '不能', '怎么', '怎样', '什么', '你们', '我们', '这个', '那个', '是否', '的吗', '吗', '的', '是', 'a', 'the', 'is', 'what']);
function queryTerms(query: string) {
  const values = new Set<string>();
  const topic = query.replace(/请问|您好|你好|你们|我们|有哪些|有什么|是什么|会不会|能不能|可不可以|如何|怎么|怎样|何时|是否|能否|可以|吗|呢/g, ' ');
  for (const run of topic.match(/[\p{Script=Han}]+|[a-z0-9]+/gu) ?? []) {
    if (/^[a-z0-9]+$/.test(run)) values.add(run);
    else for (let i = 0; i < run.length - 1; i++) values.add(run.slice(i, i + 2));
  }
  // Preserve single-letter product identifiers when they follow Chinese text.
  for (const match of query.matchAll(/[\p{Script=Han}]([a-z])\b/gu)) values.add(`@${match[1]}`);
  return [...values].filter(value => !stopTerms.has(value)).slice(0, 80);
}
const containsTerm = (field: string, term: string) => term.startsWith('@') ? new RegExp(`(^|[^a-z0-9])${term.slice(1)}([^a-z0-9]|$)`).test(field) : field.includes(term);
export function retrieveKnowledge(knowledge: Knowledge[], input: KnowledgeSearchInput): KnowledgeSearchResult {
  if (!object(input) || !text(input.query, 4000, true) || (input.scenario !== undefined && !scenarios.includes(input.scenario))
    || (input.ids !== undefined && !strings(input.ids, 1000, 200)) || ('includePending' in input)) throw new ApiError(400, '请输入 1–4000 字的测试问题并选择有效场景');
  const query = norm(input.query); const terms = queryTerms(query); const allowed = input.ids === undefined ? undefined : new Set(input.ids);
  const hits: KnowledgeHit[] = [];
  for (const item of knowledge) {
    if (!knowledgeAvailable(item) || (allowed && !allowed.has(item.id))
      || (input.scenario && input.scenario !== 'all' && item.scenario && item.scenario !== 'all' && item.scenario !== input.scenario)) continue;
    const fields: Array<[string, string, number]> = [['问题', item.question ?? '', 7], ['相似问法', (item.aliases ?? []).join('\n'), 8], ['标题', item.title, 5], ['标签', item.tags.join(' '), 4], ['正文', item.content, 1]];
    let score = 0; const matched = new Set<string>(); const matchedFields: string[] = [];
    for (const [name, raw, weight] of fields) {
      const field = norm(raw); if (!field) continue;
      const found = terms.filter(term => containsTerm(field, term));
      const exact = query.length >= 2 && (field === query || (name === '相似问法' && (item.aliases ?? []).some(alias => norm(alias) === query)));
      if (found.length || exact) { matchedFields.push(name); found.forEach(term => matched.add(term)); score += weight * found.length / Math.sqrt(Math.max(1, field.length / 100)) + (exact ? 40 : 0); }
    }
    // A shared product name alone must not answer a question about an unknown policy.
    if (!score || matched.size < Math.ceil(terms.length * 0.35)
      || (!matchedFields.includes('问题') && !matchedFields.includes('相似问法') && matched.size < Math.min(2, terms.length))) continue;
    hits.push({ id: item.id, title: item.title, content: item.content, question: item.question, source: item.source, sourceLocator: item.sourceLocator,
      score: Math.round(score * 100) / 100, matchedTerms: [...matched].map(term => term.replace(/^@/, '')), matchedFields });
  }
  hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return { query: input.query.trim(), hits: hits.slice(0, 5), status: hits.length ? 'matched' : 'no_match', note: '本地关键词检索，不调用模型；分数仅用于排序，不代表回答正确率。无匹配时应澄清或转人工。' };
}

export function createKnowledgeWorkbench(options: {
  getState(): AppState;
  mutate(action: string, taskId: string | undefined, detail: string, change: () => void): Promise<void>;
  parse(input: unknown): Promise<{ rows: KnowledgeDraft[]; warnings: string[] }>;
}) {
  const previews = new Map<string, { value: KnowledgeImportPreview; result?: { created: Knowledge[]; skipped: number; importId: string }; commit?: Promise<unknown>; signature?: string }>();
  let parsing = false;
  function cleanup() { for (const [key, entry] of previews) if (Date.parse(entry.value.expiresAt) <= Date.now()) previews.delete(key); }
  return {
    async handle(method: string, path: string, body: Record<string, unknown>): Promise<unknown> {
      const state = options.getState();
      if (method === 'POST' && path === '/knowledge/search') return retrieveKnowledge(state.knowledge, body as unknown as KnowledgeSearchInput);
      if (method === 'POST' && path === '/knowledge/evaluate') {
        if (!Array.isArray(body.cases) || !body.cases.length || body.cases.length > 100) throw new ApiError(400, '每次演练需要 1–100 个问题');
        const results = body.cases.map(row => {
          if (!object(row) || !text(row.question, 4000, true) || (row.expectedTitle !== undefined && !text(row.expectedTitle, 200))) throw new ApiError(400, '测试问题或预期标题无效');
          const result = retrieveKnowledge(state.knowledge, { query: row.question, scenario: body.scenario as Scenario | 'all' | undefined });
          const expectedTitle = (row.expectedTitle as string | undefined)?.trim();
          return { ...result, expectedTitle, passed: expectedTitle ? result.hits[0]?.title === expectedTitle : !result.hits.length };
        });
        return { total: results.length, matched: results.filter(r => r.hits.length).length, passed: results.filter(r => r.passed).length, results } satisfies KnowledgeEvaluationResult;
      }
      if (method === 'POST' && path === '/knowledge/import/preview') {
        if (parsing) throw new ApiError(409, '已有资料正在解析，请稍后再试');
        parsing = true;
        try {
          const parsed = await options.parse(body); cleanup();
          if (!parsed.rows.length || parsed.rows.length > KNOWLEDGE_IMPORT_LIMITS.rows) throw new ApiError(400, '未找到知识条目或超出单次 300 条，请分批导入');
          const fingerprints = new Map(options.getState().knowledge.map(item => [knowledgeFingerprint(item), item.id]));
          const rows = parsed.rows.map((row, index) => {
            const rowId = String(index + 1); const errors: string[] = [];
            try { readKnowledgeDraft(row); } catch (error) { errors.push((error as Error).message); }
            const fingerprint = knowledgeFingerprint(row); const duplicateOf = fingerprints.get(fingerprint);
            if (!duplicateOf) fingerprints.set(fingerprint, `本批第 ${rowId} 条`);
            return { ...row, rowId, errors, ...(duplicateOf ? { duplicateOf } : {}) };
          });
          const value: KnowledgeImportPreview = { previewId: randomUUID(), expiresAt: new Date(Date.now() + 30 * 60000).toISOString(), rows, warnings: parsed.warnings };
          if (previews.size >= 4) previews.delete(previews.keys().next().value!);
          previews.set(value.previewId, { value }); return structuredClone(value);
        } finally { parsing = false; }
      }
      if (method === 'POST' && path === '/knowledge/import/commit') {
        cleanup();
        if (body.confirm !== true || typeof body.previewId !== 'string' || !Array.isArray(body.rows) || !body.rows.length || body.rows.length > 300) throw new ApiError(400, '请预览并确认要导入的知识条目');
        const entry = previews.get(body.previewId); if (!entry) throw new ApiError(409, '导入预览已失效，请重新预览');
        const signature = JSON.stringify(body.rows);
        if (entry.signature && entry.signature !== signature) throw new ApiError(409, '此预览已经提交，请在知识库中编辑');
        if (entry.result) return structuredClone(entry.result);
        if (entry.commit) return entry.commit;
        const rowIds = new Set<string>();
        const drafts = body.rows.map(raw => {
          if (!object(raw) || typeof raw.rowId !== 'string' || rowIds.has(raw.rowId) || Object.keys(raw).some(key => !['rowId', 'title', 'content', 'tags', 'question', 'aliases', 'scenario'].includes(key))) throw new ApiError(400, '导入行或字段无效');
          rowIds.add(raw.rowId); const original = entry.value.rows.find(row => row.rowId === raw.rowId);
          if (!original) throw new ApiError(400, '导入行不属于此预览');
          return { ...readKnowledgeDraft(raw), source: original.source, sourceLocator: original.sourceLocator };
        });
        entry.signature = signature;
        entry.commit = (async () => {
          const created: Knowledge[] = []; let skipped = 0; const importId = `import_${randomUUID()}`;
          await options.mutate('knowledge_imported', undefined, `导入 ${drafts.length} 条已预览资料，默认停用并等待审核`, () => {
            const current = options.getState();
            const known = new Set(current.knowledge.map(knowledgeFingerprint)); const timestamp = new Date().toISOString();
            const additions = new Set(drafts.map(knowledgeFingerprint).filter(fingerprint => !known.has(fingerprint)));
            if (current.knowledge.length + additions.size > 10000) throw new ApiError(400, '知识库最多保留 10,000 条，请先整理已有资料');
            for (const draft of drafts) {
              const fingerprint = knowledgeFingerprint(draft); if (known.has(fingerprint)) { skipped++; continue; } known.add(fingerprint);
              const item: Knowledge = { ...draft, id: `knowledge_${randomUUID()}`, enabled: false, reviewStatus: 'pending', importId, createdAt: timestamp, updatedAt: timestamp };
              current.knowledge.push(item); created.push(item);
            }
          });
          entry.result = { created: structuredClone(created), skipped, importId }; return structuredClone(entry.result);
        })();
        try { return await entry.commit; } catch (error) { entry.signature = undefined; throw error; } finally { entry.commit = undefined; }
      }
      if (method === 'POST' && path === '/knowledge/review') {
        if (body.approved !== true || !strings(body.ids, 300, 200) || !body.ids.length || new Set(body.ids).size !== body.ids.length) throw new ApiError(400, '请明确审核 1–300 条知识');
        const ids = body.ids;
        await options.mutate('knowledge_reviewed', undefined, `人工审核并启用 ${ids.length} 条知识`, () => {
          const current = options.getState(); const selected = ids.map(id => current.knowledge.find(item => item.id === id));
          if (selected.some(item => !item)) throw new ApiError(409, '知识条目已变化，请刷新后重试');
          for (const item of selected as Knowledge[]) {
            const question = fingerprintText(item.question || item.title);
            if (current.knowledge.some(other => other.id !== item.id && (knowledgeAvailable(other) || ids.includes(other.id))
              && (other.scenario === item.scenario || !other.scenario || !item.scenario || other.scenario === 'all' || item.scenario === 'all')
              && fingerprintText(other.question || other.title) === question && fingerprintText(other.content) !== fingerprintText(item.content))) throw new ApiError(409, `“${item.title}”存在同问题不同答案，请先区分适用场景或停用旧条目`);
          }
          for (const item of selected as Knowledge[]) { item.reviewStatus = 'approved'; item.enabled = true; item.approvedAt = new Date().toISOString(); item.updatedAt = item.approvedAt; }
        });
        return structuredClone(options.getState());
      }
      return undefined;
    },
  };
}
