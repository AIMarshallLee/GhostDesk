import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { parseChatTranscript, parseKnowledgeImport } from './knowledge-import';
import { parseKnowledgeImportIsolated } from './knowledge-parser';

const file = (name: string, text: string) => ({ name, size: Buffer.byteLength(text), base64: Buffer.from(text).toString('base64') });
function pdf(text: string) {
  const stream = `BT /F1 12 Tf 72 720 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let body = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body); body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}
async function docx(text: string) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

test('CSV 与 JSON 映射中文和兼容字段，并保留来源定位', async () => {
  const result = await parseKnowledgeImport({ files: [
    file('知识.csv', '标题,问题,标准答案,相似问法,标签,场景\n退款规则,怎么退款,请提供订单号,退款|退货,售后|退款,service'),
    file('faq.json', JSON.stringify({ items: [{ title: '价格', question: '多少钱', answer: '请联系顾问', aliases: '报价|费用', tags: '销售|报价', scenario: 'sales' }] })),
  ] });
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows[0], { title: '退款规则', question: '怎么退款', content: '请提供订单号', aliases: ['退款', '退货'], tags: ['售后', '退款'], scenario: 'service', source: '知识.csv', sourceLocator: 'CSV 第 2 行' });
  assert.equal(result.rows[1].sourceLocator, 'JSON 第 1 项');
  assert.deepEqual(result.rows[1].aliases, ['报价', '费用']);
});

test('聊天只匹配明确角色的相邻问答，未配对文本保留且告警', async () => {
  const result = await parseKnowledgeImport({ textKind: 'chat', sourceName: '售后对话.txt', text: '客户：什么时候退款？\n客服：请提供订单号。\n客户：还有物流问题。\n销售：我来核实。\n客服：单独回复' });
  assert.equal(result.rows[0].question, '什么时候退款？');
  assert.equal(result.rows[0].content, '请提供订单号。');
  assert.equal(result.rows[1].question, '还有物流问题。');
  assert.match(result.rows[2].content, /未配对客服原话/);
  assert.equal(result.warnings.length, 1);
});

test('无明确聊天角色不猜测配对，保留原文并警告', async () => {
  const result = await parseKnowledgeImport({ textKind: 'chat', text: '这个多少钱？\n支持退款。' });
  assert.equal(result.rows.length, 1);
  assert.match(result.rows[0].content, /这个多少钱/);
  assert.match(result.warnings[0], /未识别明确/);
});

test('独立聊天解析入口与导入入口使用同一严格配对规则', () => {
  const result = parseChatTranscript('Q: 怎么退款？\nA: 请提供订单号。', '导入聊天.txt');
  assert.deepEqual(result.rows[0].question, '怎么退款？');
  assert.equal(result.rows[0].source, '导入聊天.txt');
});

test('严格拒绝路径、伪造大小、非规范 Base64 与不支持格式', async () => {
  await assert.rejects(parseKnowledgeImport({ files: [null as any] }), /文件项无效/);
  await assert.rejects(parseKnowledgeImport({ files: [{ name: '../bad.csv', size: 1, base64: 'YQ==' }] }), /不含路径/);
  await assert.rejects(parseKnowledgeImport({ files: [{ name: 'bad.csv', size: 2, base64: 'YQ==' }] }), /大小不一致/);
  await assert.rejects(parseKnowledgeImport({ files: [{ name: 'bad.csv', size: 1, base64: 'YQ' }] }), /规范 Base64/);
  await assert.rejects(parseKnowledgeImport({ files: [file('bad.exe', 'x')] }), /不支持/);
});

test('超出草稿行数时拒绝并要求分批，防止遗漏客户资料', async () => {
  const text = Array.from({ length: 301 }, (_, index) => `第 ${index + 1} 段`).join('\n\n');
  await assert.rejects(() => parseKnowledgeImport({ text }), /300.*分批/);
});

test('保留 Markdown 标题后正文、聊天多行例外和 JSON 数组标签，不截断政策', async () => {
  const markdown = await parseKnowledgeImport({ text: '# 售后\n接受申请，但已完成定制交付的订单除外。' });
  assert.match(markdown.rows[0].content, /定制交付.*除外/);
  const chat = parseChatTranscript('客户：能退款吗？\n客服：可以申请。\n已完成定制交付的订单除外。');
  assert.match(chat.rows[0].content, /可以申请。[\s\S]*除外/);
  const json = await parseKnowledgeImport({ files: [file('faq.json', JSON.stringify([{ title: '售后', content: '核对条件', tags: ['退款'], aliases: ['退钱'] }]))] });
  assert.deepEqual(json.rows[0].tags, ['退款']); assert.deepEqual(json.rows[0].aliases, ['退钱']);
  await assert.rejects(() => parseKnowledgeImport({ files: [file('large.json', JSON.stringify([{ title: '政策', content: '全'.repeat(20001) + '例外' }]))] }), /未截断/);
  await assert.rejects(() => parseKnowledgeImport({ files: [file('wrong.csv', '标题,标准答案,场景\n政策,待核对,slaes')] }), /场景无效/);
});

test('XLSX 只读取单元格文本，并按工作表和行号标记来源', async () => {
  const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet('FAQ');
  sheet.addRow(['标题', '问题', '标准答案', '相似问法', '标签', '场景']);
  sheet.addRow(['发票', '怎么开票', '请提供抬头', '开票|电子发票', '财务|售后', 'service']);
  const bytes = Buffer.from(await book.xlsx.writeBuffer());
  const result = await parseKnowledgeImport({ files: [{ name: 'faq.xlsx', size: bytes.length, base64: bytes.toString('base64') }] });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].sourceLocator, '工作表 FAQ 第 2 行');
  assert.equal(result.rows[0].question, '怎么开票');
});

test('文本 PDF 按页保留来源定位', async () => {
  const bytes = pdf('Refund policy: provide order number');
  const result = await parseKnowledgeImport({ files: [{ name: 'policy.pdf', size: bytes.length, base64: bytes.toString('base64') }] });
  assert.equal(result.rows[0].sourceLocator, '第 1 页 1');
  assert.match(result.rows[0].content, /Refund policy/);
});

test('DOCX 只读取本地压缩包中的文本段落', async () => {
  const bytes = await docx('请提供订单号后核对退款条件');
  const result = await parseKnowledgeImport({ files: [{ name: 'refund.docx', size: bytes.length, base64: bytes.toString('base64') }] });
  assert.equal(result.rows[0].source, 'refund.docx');
  assert.match(result.rows[0].content, /订单号/);
});

test('隔离 worker 返回与直接解析相同的草稿结果', async () => {
  const workerPath = fileURLToPath(new URL('./knowledge-import-worker.ts', import.meta.url));
  const result = await parseKnowledgeImportIsolated({ text: '退款需要订单号。', sourceName: '隔离测试.txt' }, { workerPath });
  assert.equal(result.rows[0].source, '隔离测试.txt');
});

test('隔离 worker 超时后终止阻塞任务', async () => {
  const root = resolve(process.cwd(), 'artifacts', 'package-temp'); await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'knowledge-worker-')); const workerPath = join(directory, 'busy.cjs');
  try {
    await writeFile(workerPath, "const { parentPort } = require('node:worker_threads'); parentPort.once('message', () => { while (true) {} });");
    await assert.rejects(parseKnowledgeImportIsolated({ text: '不会完成' }, { workerPath, timeoutMs: 100 }), /已终止隔离 worker/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
