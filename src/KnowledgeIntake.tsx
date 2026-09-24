import { useState } from 'react';
import { FileUp, Send, TriangleAlert } from 'lucide-react';
import type { KnowledgeImportPreview, KnowledgeImportRow } from '../shared/knowledge';
import type { PageProps } from './App';
import { Button, Field } from './components';

const ACCEPT = '.xlsx,.docx,.pdf,.csv,.json,.txt,.md';
const split = (value: string) => [...new Set(value.split(/[|,，\n]/).map(x => x.trim()).filter(Boolean))];
const readFile = (file: File) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error(`无法读取 ${file.name}`)); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.readAsDataURL(file); });

export default function KnowledgeIntake({ perform, busy, notify, onPreview }: PageProps & { onPreview: (preview: KnowledgeImportPreview) => void }) {
  const [files, setFiles] = useState<File[]>([]); const [text, setText] = useState(''); const [textKind, setTextKind] = useState<'document' | 'chat'>('document');
  const choose = (list: FileList | null) => { const next = Array.from(list || []); if (next.length > 5) return notify('一次最多导入 5 个文件。', true); if (next.some(file => file.size > 8 * 1024 * 1024)) return notify('单个文件不能超过 8MB。', true); setFiles(next); };
  const preview = async () => {
    if (!files.length && !text.trim()) return notify('请选择文件，或粘贴文档/聊天文本。', true);
    try {
      const encoded = await Promise.all(files.map(async file => ({ name: file.name, size: file.size, base64: await readFile(file) })));
      if (encoded.reduce((sum, file) => sum + file.base64.length, 0) > 12 * 1024 * 1024) return notify('文件编码后的总大小不能超过 12MB。', true);
      const result = await perform<KnowledgeImportPreview>('POST', '/knowledge/import/preview', { files: encoded.length ? encoded : undefined, text: text.trim() || undefined, textKind, sourceName: '本地粘贴文本' });
      if (result) onPreview(result);
    } catch (error) { notify((error as Error).message, true); }
  };
  return <section className="panel knowledge-intake"><div className="panel-head"><div><h2><FileUp size={17} />导入本地资料</h2><p>文件和聊天文本只提交给本地 FlowDesk 服务，先生成待审核候选。</p></div></div><div className="intake-body"><Field label="资料文件" hint="xlsx、docx、pdf、csv、json、txt、md；最多 5 个，单个 8MB，编码后合计 12MB。"><input type="file" accept={ACCEPT} multiple onChange={e => choose(e.target.files)} /></Field>{files.length > 0 && <p className="selected-files">已选择：{files.map(file => file.name).join('、')}</p>}<div className="intake-or">或粘贴文本</div><div className="segmented"><button type="button" className={textKind === 'document' ? 'selected' : ''} onClick={() => setTextKind('document')}>文档文本</button><button type="button" className={textKind === 'chat' ? 'selected' : ''} onClick={() => setTextKind('chat')}>聊天记录</button></div><textarea rows={6} value={text} onChange={e => setText(e.target.value)} placeholder={textKind === 'chat' ? '客户：…\n客服：…' : '粘贴产品说明、FAQ 或业务规则…'} /><div className="notice"><TriangleAlert size={16} />导入只生成候选；重复项默认不提交，含错误的行不能提交。</div><Button busy={busy} onClick={() => void preview()}><Send size={16} />生成导入预览</Button></div></section>;
}

export function ImportPreview({ preview, perform, busy, notify, onDone }: PageProps & { preview: KnowledgeImportPreview; onDone: () => void }) {
  const [rows, setRows] = useState(preview.rows.map(row => ({ ...row, selected: !row.duplicateOf && !row.errors.length })));
  const validate = (row: KnowledgeImportRow) => ({ ...row, errors: [!row.title.trim() ? '标题不能为空' : '', !row.content.trim() ? '内容不能为空' : '', row.title.length > 200 ? '标题不能超过 200 字' : '', row.content.length > 20000 ? '内容不能超过 20,000 字' : ''].filter(Boolean) });
  const update = (index: number, patch: Partial<KnowledgeImportRow>) => setRows(current => current.map((row, i) => i === index ? { ...validate({ ...row, ...patch }), selected: 'selected' in patch ? Boolean((patch as { selected?: boolean }).selected) : row.selected } : row));
  const commit = async () => { const valid = rows.filter(row => row.selected && !row.errors.length); if (!valid.length) return notify('请至少选择一条无错误的候选。', true); const result = await perform<{ created: unknown[]; skipped: number }>('POST', '/knowledge/import/commit', { previewId: preview.previewId, rows: valid.map(({ rowId, title, content, question, aliases, tags, scenario }) => ({ rowId, title, content, question, aliases, tags, scenario })), confirm: true }, '知识候选已保存，等待人工审核'); if (result) onDone(); };
  return <section className="panel import-preview"><div className="panel-head"><div><h2>导入预览 <span className="count-badge">{rows.length}</span></h2><p>可修改候选内容。来源在提交后只读，所有新知识默认停用、待审核。</p></div><Button busy={busy} onClick={() => void commit()}>确认提交所选</Button></div>{preview.warnings.map(warning => <div className="notice warning" key={warning}><TriangleAlert size={16} />{warning}</div>)}<div className="preview-list">{rows.map((row, index) => <article className={`preview-row ${row.errors.length ? 'has-errors' : ''}`} key={row.rowId}><label className="preview-select"><input type="checkbox" checked={row.selected} disabled={!!row.errors.length} onChange={e => update(index, { selected: e.target.checked } as never)} />选择</label><div className="preview-content"><div className="preview-meta">{row.source || '本地资料'} {row.sourceLocator || ''} {row.duplicateOf && <span className="subtle-badge amber">疑似重复，默认不选</span>} {row.errors.map(error => <span className="error-text" key={error}>{error}</span>)}</div><input value={row.title} onChange={e => update(index, { title: e.target.value })} aria-label="知识标题" /><textarea rows={3} value={row.content} onChange={e => update(index, { content: e.target.value })} aria-label="知识内容" /><div className="preview-fields"><input value={row.question || ''} placeholder="可检索问题" onChange={e => update(index, { question: e.target.value })} /><input value={(row.aliases || []).join('，')} placeholder="相似问法（| 或逗号分隔）" onChange={e => update(index, { aliases: split(e.target.value) })} /><input value={row.tags.join('，')} placeholder="标签（| 或逗号分隔）" onChange={e => update(index, { tags: split(e.target.value) })} /></div></div></article>)}</div></section>;
}
