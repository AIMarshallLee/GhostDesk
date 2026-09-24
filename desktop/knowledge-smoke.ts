import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { parseKnowledgeImportIsolated } from '../server/knowledge-parser';

const file = (name: string, bytes: Uint8Array) => ({ name, size: bytes.byteLength, base64: Buffer.from(bytes).toString('base64') });
function pdf(text: string) {
  const stream = `BT /F1 12 Tf 72 720 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let body = '%PDF-1.4\n'; const offsets = [0]; objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${object}\nendobj\n`; }); const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`; return Buffer.from(body);
}
async function docx(text: string) { const zip = new JSZip(); zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'); zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'); zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`); return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })); }

/** Packaged main-process smoke: synthetic local files only; no model, account, network, or UI. */
export async function runKnowledgeSmoke(workerPath: string): Promise<void> {
  if (!workerPath) throw new Error('knowledge import smoke requires the unpacked worker path');
  const csvJson = await parseKnowledgeImportIsolated({ files: [file('smoke.csv', Buffer.from('标题,问题,标准答案\n虚构退款规则,如何退款,请提供虚构订单号')), file('smoke.json', Buffer.from(JSON.stringify([{ title: '虚构报价', question: '价格多少', answer: '请人工确认报价' }])))] }, { workerPath });
  assert.equal(csvJson.rows[0]?.source, 'smoke.csv'); assert.equal(csvJson.rows[0]?.sourceLocator, 'CSV 第 2 行'); assert.match(csvJson.rows[0]?.content || '', /虚构订单号/); assert.equal(csvJson.rows[1]?.source, 'smoke.json'); assert.match(csvJson.rows[1]?.content || '', /人工确认/);
  const chat = await parseKnowledgeImportIsolated({ textKind: 'chat', sourceName: '虚构聊天.txt', text: '客户：虚构订单如何退款？\n客服：请提供虚构订单号。' }, { workerPath });
  assert.equal(chat.rows[0]?.source, '虚构聊天.txt'); assert.equal(chat.rows[0]?.question, '虚构订单如何退款？'); assert.match(chat.rows[0]?.content || '', /虚构订单号/);
  const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet('虚构FAQ'); sheet.addRow(['标题', '问题', '标准答案']); sheet.addRow(['虚构发票', '如何开票', '请提供虚构抬头']); const xlsx = Buffer.from(await book.xlsx.writeBuffer());
  const office = await parseKnowledgeImportIsolated({ files: [file('smoke.xlsx', xlsx), file('smoke.docx', await docx('虚构 Word 资料：请提供订单号。')), file('smoke.pdf', pdf('Synthetic PDF policy: contact support.'))] }, { workerPath });
  const excel = office.rows.find(row => row.source === 'smoke.xlsx'); const word = office.rows.find(row => row.source === 'smoke.docx'); const document = office.rows.find(row => row.source === 'smoke.pdf');
  assert.equal(excel?.sourceLocator, '工作表 虚构FAQ 第 2 行'); assert.match(excel?.content || '', /虚构抬头/); assert.match(word?.content || '', /虚构 Word/); assert.match(document?.content || '', /Synthetic PDF policy/); assert.match(document?.sourceLocator || '', /第 1 页/);
  console.log('FlowDesk knowledge import smoke passed.');
}
