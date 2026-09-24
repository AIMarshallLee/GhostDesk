import { parse } from 'csv-parse/sync';
import type { KnowledgeDraft, KnowledgeImportFile, KnowledgeImportInput } from '../shared/knowledge';
import type { Scenario } from '../shared/types';
import { KNOWLEDGE_IMPORT_LIMITS as LIMITS } from '../shared/knowledge';

const scenarios = new Set<Scenario | 'all'>(['service', 'community', 'sales', 'recruitment', 'content', 'all']);
const safeZipBytes = 16 * 1024 * 1024;
const documentExtensions = new Set(['txt', 'md', 'csv', 'json', 'xlsx', 'docx', 'pdf']);

const fail = (message: string): never => { throw new Error(`知识导入失败：${message}`); };
const extension = (name: string) => name.slice(name.lastIndexOf('.') + 1).toLowerCase();
const normalize = (value: unknown, max = 20000) => { const text = typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : ''; if (text.length > max) fail(`单个字段超过 ${max} 字符，请拆分后导入；原文未截断`); return text; };
const splitValues = (value: unknown) => (Array.isArray(value) ? value.map(item => normalize(item, 500)) : normalize(value, 2000).split('|')).map(item => item.trim()).filter(Boolean);
const titleFor = (text: string, fallback: string) => text.replace(/\s+/g, ' ').slice(0, 120) || fallback;

function validateName(name: unknown, field = '文件名'): string {
  if (typeof name !== 'string' || !name.trim() || name.length > 200 || /[\\/]/.test(name) || name === '.' || name === '..') fail(`${field}必须是不含路径的文件名`);
  return (name as string).trim();
}

function decodeFile(file: KnowledgeImportFile): Uint8Array {
  const name = validateName(file?.name);
  if (!Number.isSafeInteger(file?.size) || file.size < 0 || file.size > LIMITS.fileBytes) fail(`文件“${name}”大小无效或超过 8MB`);
  if (typeof file?.base64 !== 'string' || !file.base64 || file.base64.length > LIMITS.base64Characters || file.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64)) fail(`文件“${name}”不是规范 Base64`);
  const bytes = Buffer.from(file.base64, 'base64');
  if (!bytes.length && file.size) fail(`文件“${name}”Base64 内容为空`);
  if (bytes.toString('base64') !== file.base64 || bytes.byteLength !== file.size) fail(`文件“${name}”Base64 与声明大小不一致`);
  return bytes;
}

/** Refuse zip bombs before giving Office bytes to a document library. */
function assertSafeZip(bytes: Uint8Array, name: string) {
  if (bytes.byteLength < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) fail(`文件“${name}”不是有效的 Office 压缩包`);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) { eocd = i; break; }
  if (eocd < 0) fail(`文件“${name}”缺少压缩目录`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = view.getUint16(eocd + 10, true); const directoryOffset = view.getUint32(eocd + 16, true);
  if (entries > 2000 || directoryOffset >= bytes.length) fail(`文件“${name}”压缩目录超过安全限制`);
  let offset = directoryOffset; let total = 0;
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) fail(`文件“${name}”压缩目录无效`);
    total += view.getUint32(offset + 24, true);
    if (total > safeZipBytes) fail(`文件“${name}”解压后超过安全限制`);
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
}

function draft(source: string, sourceLocator: string, values: Partial<KnowledgeDraft> & { content: string; title?: string }): KnowledgeDraft {
  const content = normalize(values.content);
  if (!content) fail(`“${source}”的${sourceLocator}没有可导入文本`);
  if (values.scenario && !scenarios.has(values.scenario)) fail(`“${source}”的${sourceLocator}场景无效，请使用模板中的场景标识`);
  return { title: values.title ? normalize(values.title, 200) : titleFor(values.question || content, `${source} ${sourceLocator}`), content, tags: values.tags ?? [], aliases: values.aliases ?? [], scenario: values.scenario || 'all', source, sourceLocator, ...(values.question ? { question: normalize(values.question, 2000) } : {}) };
}

function textChunks(text: string, source: string, prefix = '段落'): KnowledgeDraft[] {
  const groups = text.replace(/\r\n/g, '\n').split(/\n\s*\n/).map(part => part.trim()).filter(Boolean);
  const rows: KnowledgeDraft[] = []; let heading = '';
  for (let part of groups) {
    if (/^#{1,6}\s+/.test(part)) { const lines = part.split('\n'); heading = lines.shift()!.replace(/^#{1,6}\s+/, ''); part = lines.join('\n').trim(); if (!part) continue; }
    rows.push(draft(source, `${prefix} ${rows.length + 1}`, { title: titleFor(heading || part, source), content: part }));
  }
  if (!rows.length && text.trim()) rows.push(draft(source, `${prefix} 1`, { content: text }));
  return rows;
}

function recordToDraft(record: Record<string, unknown>, source: string, locator: string): KnowledgeDraft | undefined {
  const get = (...names: string[]) => names.map(name => record[name]).find(value => value !== undefined && (Array.isArray(value) ? value.length > 0 : normalize(value)));
  const question = normalize(get('问题', 'question'));
  const answer = normalize(get('标准答案', '答案', 'answer', 'content'));
  const content = answer || normalize(get('内容', 'content'));
  if (!content && !question && Object.values(record).every(value => !normalize(value))) return undefined;
  if (!content) fail(`“${source}”的${locator}缺少答案或内容，请检查表头和空值`);
  return draft(source, locator, { title: normalize(get('标题', 'title')) || titleFor(question, source), question, content, aliases: splitValues(get('相似问法', 'aliases')), tags: splitValues(get('标签', 'tags')), scenario: normalize(get('场景', 'scenario')) as Scenario | 'all' });
}

function parseRecords(records: unknown[], source: string, locatorFor: (index: number) => string): KnowledgeDraft[] {
  const rows: KnowledgeDraft[] = [];
  records.forEach((record, index) => {
    if (!record || Array.isArray(record) || typeof record !== 'object') return fail(`“${source}”的${locatorFor(index)}不是有效知识对象`);
    const item = recordToDraft(record as Record<string, unknown>, source, locatorFor(index));
    if (item) rows.push(item);
  });
  return rows;
}

export function parseChatTranscript(text: string, sourceName = '粘贴聊天'): { rows: KnowledgeDraft[]; warnings: string[] } {
  if (typeof text !== 'string' || !text.trim()) fail('聊天文本不能为空');
  const source = validateName(sourceName, '聊天来源名');
  const warnings: string[] = [];
  const turns: Array<{ index: number; role: string; content: string }> = []; const prefix: string[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const match = /^\s*(客户|用户|买家|咨询者|客服|销售|顾问|商家|助手|Q|A)\s*[：:]\s*(.*?)\s*$/i.exec(line);
    if (match) turns.push({ index: index + 1, role: match[1], content: match[2] });
    else if (turns.length) turns[turns.length - 1].content += `\n${line}`;
    else prefix.push(line);
  });
  if (!turns.length) { warnings.push('未识别明确客户/客服/销售/Q/A角色；已保留原文，未推断问答关系。'); return { rows: textChunks(text, source, '聊天原文段'), warnings }; }
  const rows: KnowledgeDraft[] = prefix.join('\n').trim() ? textChunks(prefix.join('\n'), source, '未配对原文段') : []; let pending: { text: string; line: number } | undefined;
  if (rows.length) warnings.push('角色标签前的原文已单独保留，请审核其用途。');
  const isQuestion = (role: string) => /^(客户|用户|买家|咨询者|q)$/i.test(role);
  for (const turn of turns) {
    const { role, content } = turn;
    if (isQuestion(role)) {
      if (pending) { rows.push(draft(source, `聊天第 ${pending.line} 行`, { content: `【未配对客户原话】\n${pending.text}` })); warnings.push(`聊天第 ${pending.line} 行客户提问未找到后续客服回复，已保留原文。`); }
      pending = { text: content, line: turn.index };
    } else if (pending) {
      rows.push(draft(source, `聊天第 ${pending.line}-${turn.index} 行`, { title: pending.text, question: pending.text, content })); pending = undefined;
    } else {
      rows.push(draft(source, `聊天第 ${turn.index} 行`, { content: `【未配对客服原话】\n${content}` })); warnings.push(`聊天第 ${turn.index} 行客服回复没有明确对应问题，已保留原文。`);
    }
  }
  if (pending) { rows.push(draft(source, `聊天第 ${pending.line} 行`, { content: `【未配对客户原话】\n${pending.text}` })); warnings.push(`聊天第 ${pending.line} 行客户提问未找到后续客服回复，已保留原文。`); }
  return { rows, warnings };
}

async function parseXlsx(bytes: Uint8Array, source: string): Promise<KnowledgeDraft[]> {
  assertSafeZip(bytes, source);
  const excelModule = await import('exceljs'); const ExcelJS = (excelModule as any).default ?? excelModule; const book = new ExcelJS.Workbook();
  try { await book.xlsx.load(bytes as any); } catch { return fail(`Excel 文件“${source}”无法读取，可能已加密或损坏`); }
  const rows: KnowledgeDraft[] = [];
  if (book.worksheets.length > 20) fail(`Excel 文件“${source}”超过 20 个工作表，请拆分`);
  for (const sheet of book.worksheets) {
    if (sheet.rowCount > 10000) fail(`工作表“${sheet.name}”超过 10,000 行，请拆分`);
    const header = sheet.getRow(1).values as unknown[];
    const keys = header.map(value => normalize(value));
    for (let number = 2; number <= Math.min(sheet.rowCount, 10000); number++) {
      const values = sheet.getRow(number).values as unknown[]; const record: Record<string, unknown> = {};
      keys.forEach((key, index) => { if (key) record[key] = values[index]; });
      const item = recordToDraft(record, source, `工作表 ${sheet.name} 第 ${number} 行`); if (item) rows.push(item);
    }
  }
  return rows;
}

async function parseDocx(bytes: Uint8Array, source: string): Promise<KnowledgeDraft[]> {
  assertSafeZip(bytes, source);
  const mammoth = await import('mammoth');
  try { const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) }); if (!result.value.trim()) return fail(`Word 文件“${source}”没有可提取文字，可能是扫描件或空文档`); return textChunks(result.value, source); } catch (error) { if (error instanceof Error && error.message.startsWith('知识导入失败')) throw error; return fail(`Word 文件“${source}”无法读取，可能已加密或损坏`); }
}

async function parsePdf(bytes: Uint8Array, source: string): Promise<KnowledgeDraft[]> {
  try {
    const { extractText, getDocumentProxy } = await import('unpdf'); const pdf = await getDocumentProxy(new Uint8Array(bytes));
    if (pdf.numPages > 100) return fail(`PDF 文件“${source}”页数超过 100 页限制`);
    const extracted = await extractText(pdf, { mergePages: false }); const pages = extracted.text;
    const pageTexts = Array.isArray(pages) ? pages.map(page => normalize(page, LIMITS.extractedCharacters)) : [normalize(pages, LIMITS.extractedCharacters)];
    const rows = pageTexts.flatMap((text, index) => text ? textChunks(text, source, `第 ${index + 1} 页`) : []);
    if (!rows.length) return fail(`PDF 文件“${source}”没有可提取文字，扫描件需要 OCR 后再导入`);
    return rows;
  } catch (error) { if (error instanceof Error && error.message.startsWith('知识导入失败')) throw error; return fail(`PDF 文件“${source}”无法读取，可能已加密、损坏或不是文本 PDF${error instanceof Error && error.message ? `：${error.message}` : ''}`); }
}

async function parseFile(file: KnowledgeImportFile): Promise<KnowledgeDraft[]> {
  if (!file || typeof file !== 'object') fail('文件项无效');
  const name = validateName(file.name); const kind = extension(name); if (!documentExtensions.has(kind)) fail(`不支持文件“${name}”的格式`);
  const bytes = decodeFile(file); const text = () => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  try {
    if (kind === 'txt' || kind === 'md') return textChunks(text(), name);
    if (kind === 'csv') return parseRecords(parse(text(), { columns: true, skip_empty_lines: true, relax_column_count: false, bom: true, trim: true, max_record_size: 200000 }), name, index => `CSV 第 ${index + 2} 行`);
    if (kind === 'json') { const value = JSON.parse(text()); const records = Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : fail(`JSON 文件“${name}”必须是数组或包含 items 数组`); return parseRecords(records, name, index => `JSON 第 ${index + 1} 项`); }
    if (kind === 'xlsx') return await parseXlsx(bytes, name);
    if (kind === 'docx') return await parseDocx(bytes, name);
    return await parsePdf(bytes, name);
  } catch (error) { if (error instanceof Error && error.message.startsWith('知识导入失败')) throw error; return fail(`文件“${name}”解析失败：${error instanceof Error ? error.message : '格式无效'}`); }
}

export async function parseKnowledgeImport(input: KnowledgeImportInput): Promise<{ rows: KnowledgeDraft[]; warnings: string[] }> {
  if (!input || typeof input !== 'object') fail('导入参数无效');
  const files = input.files ?? []; const warnings: string[] = [];
  if (!Array.isArray(files) || files.length > LIMITS.files) fail(`最多可导入 ${LIMITS.files} 个文件`);
  const totalBase64 = files.reduce((sum, file) => sum + (typeof file?.base64 === 'string' ? file.base64.length : 0), 0);
  if (totalBase64 > LIMITS.base64Characters) fail('文件 Base64 总量超过 12MB');
  let rows: KnowledgeDraft[] = [];
  for (const file of files) { const parsed = await parseFile(file); if (!parsed.length) fail(`文件“${file.name}”没有可识别条目，请检查表头或内容`); rows.push(...parsed); }
  if (input.text !== undefined) {
    if (typeof input.text !== 'string' || input.text.length > LIMITS.extractedCharacters) fail('粘贴文本必须是字符串且不超过 50 万字符');
    if (input.text.trim()) {
      const source = input.sourceName ? validateName(input.sourceName, '文本来源名') : '粘贴文本';
      if (input.textKind === 'chat') { const chat = parseChatTranscript(input.text, source); rows.push(...chat.rows); warnings.push(...chat.warnings); }
      else rows.push(...textChunks(input.text, source));
    }
  }
  if (!files.length && !input.text?.trim()) fail('请提供至少一个文件或一段文本');
  if (!rows.length) fail('未从导入内容中识别到可编辑的文本条目');
  const totalText = rows.reduce((sum, row) => sum + row.title.length + row.content.length + (row.question?.length ?? 0), 0);
  if (totalText > LIMITS.extractedCharacters) fail('提取文本总量超过 50 万字符');
  if (rows.length > LIMITS.rows) fail(`单次超过 ${LIMITS.rows} 条草稿，请分批导入；未截断原文`);
  return { rows, warnings };
}
