import { useEffect, useRef, useState } from 'react';
import { Copy, FilePlus, Save, Square, Trash2 } from 'lucide-react';
import type { PageProps } from './App';
import { Button, Empty, Field, PageHead } from './components';
import { copyText, navigate } from './api';
import { MEDIA_EXTENSIONS, MEDIA_LIMITS, type MediaAnalysis, type MediaFile } from '../shared/media';
import './attachments.css';

export default function AttachmentsPage({ state, perform, notify }: PageProps) {
  const desktop = window.flowdesk?.media;
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [question, setQuestion] = useState('请提取附件中的关键信息，并根据相关业务知识起草一段回复。');
  const [knowledgeIds, setKnowledgeIds] = useState<string[]>([]);
  const [result, setResult] = useState<MediaAnalysis>();
  const [transcript, setTranscript] = useState('');
  const [reply, setReply] = useState('');
  const [title, setTitle] = useState('附件分析待审核回复');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const epoch = useRef(0);
  useEffect(() => () => { epoch.current++; void desktop?.stop().catch(() => {}); }, [desktop]);
  const invalidate = () => { epoch.current++; setResult(undefined); setTranscript(''); setReply(''); void desktop?.stop().catch(() => {}); };
  const choose = async (selection: FileList | null) => {
    invalidate(); setFiles([]);
    if (!selection?.length) return;
    const token = epoch.current;
    const picked = Array.from(selection);
    try {
      if (picked.length > MEDIA_LIMITS.files || picked.some(file => file.size < 1 || file.size > MEDIA_LIMITS.fileBytes)
        || picked.reduce((n, file) => n + Math.ceil(file.size / 3) * 4, 0) > MEDIA_LIMITS.base64Characters) throw new Error('最多 4 个附件；每个不超过 8 MB，编码后总量不超过 12 MB。');
      setBusy(true);
      const values: MediaFile[] = [];
      for (const file of picked) {
        const extension = file.name.split('.').at(-1)?.toLowerCase() as keyof typeof MEDIA_EXTENSIONS;
        const mimeType = MEDIA_EXTENSIONS[extension];
        if (!mimeType) throw new Error('不支持此格式，请选择 PNG/JPEG/WebP、MP3/WAV、PDF/CSV/TXT。');
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = ''; for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
        values.push({ name: file.name, mimeType, size: bytes.length, base64: btoa(binary) });
      }
      if (token === epoch.current) setFiles(values);
    } catch (error) { notify((error as Error).message, true); }
    finally { if (token === epoch.current) setBusy(false); }
  };
  const analyze = async () => {
    if (!desktop) return;
    invalidate(); const token = epoch.current; setBusy(true);
    try {
      const value = await desktop.analyze({ files, question, knowledgeIds, allowModel: true });
      if (token !== epoch.current) return;
      setResult(value); setTranscript(value.extracted); setReply(value.draft);
      notify('附件分析完成，请核对提取内容并编辑草稿。');
    } catch (error) { if (token === epoch.current) notify((error as Error).message, true); }
    finally { if (token === epoch.current) setBusy(false); }
  };
  const stop = async () => { epoch.current++; setResult(undefined); setTranscript(''); setReply(''); await desktop?.stop(); setBusy(false); notify('已取消，未完成的结果将被丢弃。'); };
  const save = async () => {
    if (!desktop || !result) return;
    setSaving(true);
    try { const task = await desktop.save({ resultId: result.resultId, title, transcript, reply }); await perform('GET', '/state'); notify('已保存为待审核任务，附件原文件未保存。'); navigate(`task/${task.id}`); }
    catch (error) { notify((error as Error).message, true); }
    finally { setSaving(false); }
  };
  if (!desktop) return <><PageHead title="附件助手" description="明确选择附件后识图、转录语音或摘要文件。" /><Empty title="请在 Windows 客户端中打开" detail="附件分析使用已保存的 Gemini 原生配置，并要求 Pico 硬件连接健康。" /></>;
  return <>
    <PageHead title="附件助手" description="明确选择附件，提取内容并起草回复。持续回复中的附件仍由人工接管。" />
    <div className="attachment-layout"><section className="panel attachment-panel">
      <h2><FilePlus size={20} />选择本次附件</h2>
      <Field label="本地附件（最多 4 个）"><input aria-label="选择本地附件" type="file" multiple accept=".png,.jpg,.jpeg,.webp,.mp3,.wav,.pdf,.csv,.txt" disabled={busy || saving} onChange={event => { void choose(event.target.files); event.target.value = ''; }} /></Field>
      <p className="muted">单文件不超过 8 MB，编码后合计不超过 12 MB。TXT/CSV 需 UTF-8。原文件只在本次会话内存中处理。</p>
      <ul className="attachment-files">{files.map((file, index) => <li key={`${index}-${file.name}`}><strong>{file.name}</strong><span>{file.mimeType} · {(file.size / 1024).toFixed(1)} KB</span></li>)}</ul>
      {files.length > 0 && <Button variant="ghost" disabled={busy || saving} onClick={() => { invalidate(); setFiles([]); }}><Trash2 size={15} />清空附件</Button>}
      <Field label="本次分析目的或问题"><textarea aria-label="附件分析问题" value={question} maxLength={4000} disabled={busy || saving} onChange={event => { invalidate(); setQuestion(event.target.value); }} /></Field>
      <fieldset className="attachment-knowledge"><legend>本次使用的业务知识</legend>{state.knowledge.filter(item => item.enabled).map(item => <label key={item.id}><input type="checkbox" disabled={busy || saving} checked={knowledgeIds.includes(item.id)} onChange={() => { invalidate(); setKnowledgeIds(ids => ids.includes(item.id) ? ids.filter(id => id !== item.id) : [...ids, item.id]); }} />{item.title}</label>)}</fieldset>
      <div className="notice">点击“确认并分析”后，所选附件内容、问题和知识会发送到“电脑操作”页保存的 Gemini 接口，可能产生模型费用。需要 Pico 健康连接；取消、超时或断线会丢弃未完成结果。分析不执行电脑操作。</div>
      <div className="attachment-actions"><Button variant="secondary" disabled={busy} onClick={() => navigate('computer-use')}>配置 Gemini</Button>{busy ? <Button variant="danger" onClick={() => void stop()}><Square size={15} />取消分析</Button> : <Button disabled={!files.length || !question.trim() || saving} onClick={() => void analyze()}>确认并分析</Button>}</div>
    </section><section className="panel attachment-panel">
      <h2>提取内容与回复草稿</h2>
      {result ? <>
        <Field label="提取内容（可编辑）"><textarea aria-label="编辑附件提取内容" className="attachment-transcript" maxLength={12000} value={transcript} disabled={saving} onChange={event => setTranscript(event.target.value)} /></Field>
        {result.uncertainties && <p className="notice">模型标注的限制与未知：{result.uncertainties}</p>}
        <Field label="待审核回复"><textarea aria-label="编辑附件回复草稿" maxLength={4096} value={reply} disabled={saving} onChange={event => setReply(event.target.value)} /></Field>
        <Field label="保存时的任务标题"><input aria-label="附件任务标题" maxLength={200} value={title} disabled={saving} onChange={event => setTitle(event.target.value)} /></Field>
        <p className="muted">请核对文字、语音转录和事实。复制只写入剪贴板；保存仅保留编辑后的文字和来源说明，不保存附件原文件，不自动发送。</p>
        <div className="attachment-actions"><Button variant="secondary" disabled={!reply.trim() || saving} onClick={() => void copyText(reply).then(() => notify('草稿已复制，未发送。')).catch(error => notify(error.message, true))}><Copy size={15} />复制草稿</Button><Button busy={saving} disabled={!reply.trim() || !transcript.trim() || !title.trim()} onClick={() => void save()}><Save size={15} />保存到任务中心审核</Button></div>
      </> : <p className="muted">确认分析后在这里查看结果；不会自动读取聊天窗口中的附件或发送回复。</p>}
    </section></div>
  </>;
}
