import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Clipboard, Download, FileText, Monitor, Pause, Play, Plus, RefreshCw, Settings, Sparkles, Square, Target, Trash2, Users } from 'lucide-react';
import type { ComputerUseTarget } from '../shared/computer-use';
import type { CustomerLead, PlaybookPack, ChatExtractResult, UsbStatus } from '../shared/types';
import { defaultReplyLayout, type DesktopReplyBridge, type DesktopReplyConfig, type DesktopReplyJob, type DesktopReplyState, type NormalizedRect, type ReplyLayout } from '../shared/desktop-replies';
import type { PageProps } from './App';
import { Button, Empty, Field, Modal, PageHead } from './components';
import { api, navigate } from './api';
import './desktop-replies.css';

type Region = keyof ReplyLayout;
const regions: Array<[Region, string]> = [['conversations', '会话列表'], ['header', '会话标题'], ['messages', '消息区域'], ['composer', '输入框'], ['send', '发送按钮']];
const statusNames: Record<DesktopReplyJob['status'], string> = { queued: '排队中', generating: '生成中', ready: '待复制', copied: '已复制', sending: '发送中', visually_confirmed: '视觉确认', uncertain: '结果不明', handoff: '人工接管', failed: '失败' };
const makeConfig = (): DesktopReplyConfig => ({ conversations: [], layout: structuredClone(defaultReplyLayout), mode: 'manual', modelProtocol: 'gemini-native', pollSeconds: 20, maxRepliesPerHour: 20, knowledgeMode: 'selected', knowledgeIds: [], workflowId: '', inputBackend: 'usb', humanDelay: true, splitBubbles: false });
const cloneConfig = (value: DesktopReplyConfig) => structuredClone(value);
const asBridge = () => (window.flowdesk as (typeof window.flowdesk & { desktopReplies?: DesktopReplyBridge }) | undefined)?.desktopReplies;

function exportLeadsCsv(leads: CustomerLead[]) {
  const headers = ['会话名称', '意向等级', '手机号码', '微信号', '预算', '核心痛点', '建议跟进步骤', '更新时间'];
  const intentMap: Record<string, string> = { high: '🔥高意向', medium: '⚖️比价中', low: '❓咨询', complaint: '⚠️投诉预警' };
  const rows = leads.map(l => [
    `"${(l.conversationName || '').replace(/"/g, '""')}"`,
    `"${intentMap[l.intent] || l.intent}"`,
    `"${l.phone || ''}"`,
    `"${l.wechatId || ''}"`,
    `"${(l.budget || '').replace(/"/g, '""')}"`,
    `"${(l.painPoint || '').replace(/"/g, '""')}"`,
    `"${(l.nextStep || '').replace(/"/g, '""')}"`,
    `"${l.updatedAt || ''}"`,
  ]);
  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `FlowDesk-私域客资线索-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function DesktopRepliesPage({ state, notify }: PageProps) {
  const desktop = asBridge();
  const loaded = useRef(false);
  const [replyState, setReplyState] = useState<DesktopReplyState>();
  const [config, setConfig] = useState<DesktopReplyConfig>(makeConfig);
  const [savedConfig, setSavedConfig] = useState<DesktopReplyConfig>(makeConfig);
  const [targets, setTargets] = useState<ComputerUseTarget[]>([]);
  const [targetId, setTargetId] = useState('');
  const [preview, setPreview] = useState<{ image: string; width: number; height: number }>();
  const [region, setRegion] = useState<Region>('conversations');
  const [drag, setDrag] = useState<{ x: number; y: number }>();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmStart, setConfirmStart] = useState(false);
  const [provider, setProvider] = useState<{ configured: boolean; baseUrl: string; model: string }>();
  const [usbStatus, setUsbStatus] = useState<UsbStatus>();

  const [showPlaybookModal, setShowPlaybookModal] = useState(false);
  const [presetPacks, setPresetPacks] = useState<PlaybookPack[]>([]);
  const [showExtractModal, setShowExtractModal] = useState(false);
  const [extractTranscript, setExtractTranscript] = useState('');
  const [extractResult, setExtractResult] = useState<ChatExtractResult | null>(null);
  const [showLeadsModal, setShowLeadsModal] = useState(false);
  const [leadsList, setLeadsList] = useState<CustomerLead[]>([]);

  const openPlaybooks = async () => {
    setBusy(true);
    try {
      const res = await api<{ ok: boolean; playbooks: PlaybookPack[] }>('GET', '/playbooks/presets');
      if (res.ok) setPresetPacks(res.playbooks);
      setShowPlaybookModal(true);
    } catch (e) { notify((e as Error).message, true); }
    finally { setBusy(false); }
  };

  const installPack = async (packId: string) => {
    setBusy(true);
    try {
      const res = await api<{ ok: boolean; installedCount: number; packName: string }>('POST', '/playbooks/install', { packId });
      if (res.ok) {
        notify(`成功装载实战话术包【${res.packName}】，已为知识库新增 ${res.installedCount} 条业务问答！`);
        setShowPlaybookModal(false);
      }
    } catch (e) { notify((e as Error).message, true); }
    finally { setBusy(false); }
  };

  const runExtract = async (autoSave: boolean) => {
    if (!extractTranscript.trim()) { notify('请先粘贴真实的聊天记录文本。', true); return; }
    setBusy(true);
    try {
      const res = await api<{ ok: boolean; result: ChatExtractResult }>('POST', '/playbooks/extract', { transcript: extractTranscript, autoSave });
      if (res.ok) {
        setExtractResult(res.result);
        if (autoSave) {
          notify(`已整理 ${res.result.suggestedQa.length} 条聊天候选，等待人工审核后启用。`);
          setShowExtractModal(false);
        } else {
          notify(`已按聊天角色整理 ${res.result.suggestedQa.length} 组问答，请在下方核对。`);
        }
      }
    } catch (e) { notify((e as Error).message, true); }
    finally { setBusy(false); }
  };

  const openLeads = async () => {
    setBusy(true);
    try {
      const res = await api<{ ok: boolean; leads: CustomerLead[] }>('GET', '/leads');
      if (res.ok) setLeadsList(res.leads || []);
      setShowLeadsModal(true);
    } catch (e) { notify((e as Error).message, true); }
    finally { setBusy(false); }
  };

  const refresh = useCallback(async () => {
    if (!desktop) return;
    try {
      const value = await desktop.state(); setReplyState(value);
      if (!loaded.current) {
        loaded.current = true;
        const migrated = value.config.inputBackend === 'usb' ? value.config : { ...value.config, inputBackend: 'usb' as const };
        setConfig(cloneConfig(migrated)); setSavedConfig(cloneConfig(value.config)); setTargetId(value.target?.id || '');
        if (migrated !== value.config) notify('旧版 Windows 软件执行器配置已改为 Pico USB HID；请保存后才能启动。');
      }
    } catch (error) { notify((error as Error).message, true); }
  }, [desktop, notify]);
  useEffect(() => { if (!desktop) return; void refresh().catch(error => notify((error as Error).message, true)); }, [desktop, notify, refresh]);
  useEffect(() => { if (!desktop) return; let disposed = false; setProvider(undefined); void desktop.provider(config.modelProtocol ?? 'openai-vision').then(value => { if (!disposed) setProvider(value); }).catch(error => { if (!disposed) notify((error as Error).message, true); }); return () => { disposed = true; }; }, [desktop, config.modelProtocol, notify]);
  useEffect(() => { if (!desktop) return; const id = window.setInterval(() => void refresh(), 2000); return () => window.clearInterval(id); }, [desktop, refresh]);
  useEffect(() => { if (!window.flowdesk?.usb) return; const read = () => void window.flowdesk!.usb.status().then(setUsbStatus).catch(() => setUsbStatus(undefined)); read(); const timer = window.setInterval(read, 2000); return () => window.clearInterval(timer); }, []);

  const dirty = JSON.stringify(config) !== JSON.stringify(savedConfig);
  const selected = useMemo(() => targets.find(item => item.id === targetId) || (replyState?.target?.id === targetId ? replyState.target : undefined), [targets, targetId, replyState?.target]);
  const activeKnowledge = state.knowledge.filter(item => item.enabled && item.reviewStatus !== 'pending');
  const running = replyState?.status === 'running';
  const updateRect = (key: Region, value: NormalizedRect) => setConfig(current => ({ ...current, layout: { ...current.layout, [key]: value } }));
  const point = (event: React.PointerEvent<HTMLDivElement>) => { const box = event.currentTarget.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)) }; };
  const save = async () => {
    const names = config.conversations.map(item => item.name.trim());
    if (!desktop || names.length === 0 || names.some(value => !value) || new Set(names).size !== names.length) { notify('请至少添加一个非空且唯一的会话名。', true); return; }
    setBusy(true); try { const value = await desktop.saveConfig(config); setReplyState(value); setConfig(cloneConfig(value.config)); setSavedConfig(cloneConfig(value.config)); notify('持续回复配置已保存'); } catch (error) { notify((error as Error).message, true); } finally { setBusy(false); }
  };
  const listTargets = async () => { if (!window.flowdesk?.computerUse) return; setBusy(true); try { const value = await window.flowdesk.computerUse.targets(); setTargets(value); if (!targetId && value[0]) setTargetId(value[0].id); notify(value.length ? '已列出可选应用窗口' : '没有可选窗口'); } catch (error) { notify((error as Error).message, true); } finally { setBusy(false); } };
  const openTestTarget = async () => { if (!desktop) return; setBusy(true); try { const value = await desktop.openTestTarget(); setTargets(items => [value, ...items.filter(item => item.id !== value.id)]); setTargetId(value.id); setConfig(current => current.conversations.length ? current : { ...current, conversations: [{ id: 'fixture-lin', name: '林小雨', enabled: true }, { id: 'fixture-chen', name: '陈先生', enabled: true }, { id: 'fixture-zhou', name: '周女士', enabled: true }] }); notify('内置虚构多会话测试窗口已打开，并已填入三个测试会话名'); } catch (error) { notify((error as Error).message, true); } finally { setBusy(false); } };
  const getPreview = async () => { if (!desktop || !targetId) return; setBusy(true); try { setPreview(await desktop.preview(targetId)); notify('已取得目标窗口截图，用于校准区域'); } catch (error) { notify((error as Error).message, true); } finally { setBusy(false); } };
  const start = async () => { if (!desktop || !targetId) return; setBusy(true); try { setReplyState(await desktop.start({ targetId, allowModel: true })); setConfirmStart(false); notify(config.mode === 'auto' ? '持续自动回复已启动' : '持续草稿生成已启动'); } catch (error) { notify((error as Error).message, true); } finally { setBusy(false); } };
  const changeTakeover = async (conversationId: string, currentlyTakingOver: boolean) => { if (!desktop) return; setBusy(true); try { setReplyState(await desktop.takeover(conversationId, currentlyTakingOver)); } catch (error) { notify((error as Error).message, true); } finally { setBusy(false); } };
  if (!desktop) return <><PageHead title="持续回复" description="此功能需要桌面客户端（支持 Windows / macOS）。浏览器版不会读取窗口、截图或执行持续回复。" /><section className="dr-browser panel"><Empty title="请在桌面客户端中打开（支持 Windows / macOS）" detail="回复模式实验室用于虚构聊天模拟；电脑操作页用于单次受控操作。" action={<Button onClick={() => navigate('autopilot')}>打开回复模式实验室</Button>} /></section></>;

  return <>
    <PageHead eyebrow="CROSS-PLATFORM CONTINUOUS REPLIES" title="持续回复" description="面向一个明确选择的目标应用窗口持续处理多个会话。回复模式实验室是虚构模拟；电脑操作是单次操作。" actions={<Button variant="secondary" disabled={busy} onClick={() => void desktop.exportReport().then(path => notify(`报告已导出：${path}`)).catch(error => notify((error as Error).message, true))}><Download size={16} />导出报告</Button>} />
    <div className="panel dr-private-domain-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', marginBottom: '16px', borderRadius: '8px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontSize: '20px' }}>💼</span>
        <div>
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>桌面即时通讯私域管家</h3>
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--muted, #888)' }}>
            通用桌面聊天工作台 · 本地视觉读取 · 聊天内容整理与人工审核
          </p>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <Button variant="secondary" busy={busy} onClick={() => void openPlaybooks()}><Sparkles size={15} />载入实战话术包</Button>
        <Button variant="secondary" busy={busy} onClick={() => { setExtractResult(null); setShowExtractModal(true); }}><FileText size={15} />整理聊天记录</Button>
        <Button variant="secondary" busy={busy} onClick={() => void openLeads()}><Users size={15} />私域客资看板 (CRM)</Button>
      </div>
    </div>
    <div className="dr-layout"><div className="dr-main">
      <section className="panel dr-panel"><div className="dr-section-head"><span><Monitor size={18} /></span><div><h2>目标窗口与会话名单</h2><p>不会自动枚举或截图。选择后再主动取得校准截图。</p></div></div><div className="dr-actions"><Button variant="secondary" busy={busy} disabled={running} onClick={() => void openTestTarget()}>打开内置测试窗口</Button><Button variant="secondary" busy={busy} disabled={running} onClick={() => void listTargets()}>列出应用窗口</Button><Button variant="secondary" busy={busy} disabled={!targetId || running} onClick={() => void getPreview()}><RefreshCw size={15} />更新校准截图</Button></div>
        {targets.length > 0 && <div className="dr-targets" role="radiogroup" aria-label="持续回复目标窗口">{targets.map(item => <label key={item.id} className={targetId === item.id ? 'selected' : ''}><input type="radio" name="reply-target" checked={targetId === item.id} onChange={() => { setTargetId(item.id); setPreview(undefined); }} /><Target size={15} /><span>{item.name}</span><small>{item.kind === 'test' ? '内置测试' : '应用窗口'}</small></label>)}</div>}
        <div className="dr-conversations"><div className="dr-list-head"><strong>精确会话名名单</strong><span>同名会话会被拒绝</span></div>{config.conversations.map(item => <div className="dr-conversation" key={item.id}><input aria-label="会话名称" value={item.name} maxLength={100} onChange={e => setConfig(current => ({ ...current, conversations: current.conversations.map(row => row.id === item.id ? { ...row, name: e.target.value } : row) }))} /><label><input type="checkbox" checked={item.enabled} onChange={() => setConfig(current => ({ ...current, conversations: current.conversations.map(row => row.id === item.id ? { ...row, enabled: !row.enabled } : row) }))} />启用</label><Button variant="ghost" aria-label={`移除 ${item.name}`} onClick={() => setConfig(current => ({ ...current, conversations: current.conversations.filter(row => row.id !== item.id) }))}><Trash2 size={16} /></Button></div>)}<div className="dr-add"><input aria-label="新增唯一会话名称" placeholder="输入精确会话名" value={name} maxLength={100} onChange={e => setName(e.target.value)} /><Button variant="secondary" onClick={() => { const value = name.trim(); if (!value || config.conversations.some(item => item.name === value)) { notify('请输入未重复的会话名。', true); return; } setConfig(current => ({ ...current, conversations: [...current.conversations, { id: crypto.randomUUID(), name: value, enabled: true }] })); setName(''); }}><Plus size={16} />添加</Button></div></div>
      </section>
      <section className="panel dr-panel"><div className="dr-section-head"><span><Target size={18} /></span><div><h2>窗口区域校准</h2><p>在截图上选择一个区域后拖拽；坐标按目标窗口比例保存。</p></div></div><div className="dr-calibration"><div className="dr-region-tabs">{regions.map(([key, label]) => <button key={key} className={region === key ? 'active' : ''} onClick={() => setRegion(key)}>{label}</button>)}</div>{preview ? <div className="dr-preview" onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); setDrag(point(event)); }} onPointerMove={event => { if (drag) updateRect(region, { x: Math.min(drag.x, point(event).x), y: Math.min(drag.y, point(event).y), width: Math.abs(point(event).x - drag.x), height: Math.abs(point(event).y - drag.y) }); }} onPointerUp={event => { if (drag) { const end = point(event); updateRect(region, { x: Math.min(drag.x, end.x), y: Math.min(drag.y, end.y), width: Math.max(.005, Math.abs(end.x - drag.x)), height: Math.max(.005, Math.abs(end.y - drag.y)) }); } setDrag(undefined); }}><img src={preview.image} alt={`目标窗口校准截图，${preview.width} × ${preview.height}`} />{regions.map(([key, label]) => { const rect = config.layout[key]; return <div key={key} className={`dr-rect ${key === region ? 'active' : ''}`} style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }}><span>{label}</span></div>; })}</div> : <div className="dr-no-preview">先选择窗口，再点击“更新校准截图”。截图只用于本机校准和启动时的模型请求。</div>}<div className="dr-coordinates">{(['x', 'y', 'width', 'height'] as const).map(key => <label key={key}>{key}<input type="number" min="0" max="1" step="0.01" value={Number(config.layout[region][key].toFixed(3))} onChange={e => updateRect(region, { ...config.layout[region], [key]: Math.max(0, Math.min(1, Number(e.target.value) || 0)) })} /></label>)}<Button variant="ghost" onClick={() => setConfig(current => ({ ...current, layout: structuredClone(defaultReplyLayout) }))}>重置区域</Button></div></div>
      </section>
      <section className="panel dr-panel"><div className="dr-section-head"><span><Settings size={18} /></span><div><h2>回复方式与上下文</h2><p>自动与人工草稿模式都必须连接 Pico / CoreS3 USB HID；离线时仍可管理配置和查看烧录说明。</p></div></div><div className="form-row"><Field label="持续回复模型协议"><select aria-label="持续回复模型协议" disabled={running || busy} value={config.modelProtocol ?? 'openai-vision'} onChange={e => setConfig(current => ({ ...current, modelProtocol: e.target.value as DesktopReplyConfig['modelProtocol'] }))}><option value="gemini-native">Gemini 原生 Computer Use</option><option value="openai-vision">OpenAI 兼容普通视觉模型</option></select></Field><Field label="回复方式"><select aria-label="持续回复方式" value={config.mode} onChange={e => setConfig(current => ({ ...current, mode: e.target.value as DesktopReplyConfig['mode'] }))}><option value="manual">人工复制回复</option><option value="auto">自动回复</option></select></Field><Field label="必需硬件"><input aria-label="持续回复必需硬件" value="Pico / CoreS3 USB HID（已固定）" disabled /></Field><Field label="扫描间隔（秒）"><input aria-label="扫描间隔秒数" type="number" min="5" max="3600" value={config.pollSeconds} onChange={e => setConfig(current => ({ ...current, pollSeconds: Math.max(5, Math.min(3600, Number(e.target.value) || 5)) }))} /></Field><Field label="每小时回复上限"><input aria-label="每小时回复上限" type="number" min="1" max="500" value={config.maxRepliesPerHour} onChange={e => setConfig(current => ({ ...current, maxRepliesPerHour: Math.max(1, Math.min(500, Number(e.target.value) || 1)) }))} /></Field></div>
        <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', margin: '14px 0', padding: '12px 16px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
            <input type="checkbox" checked={config.humanDelay ?? true} onChange={e => setConfig(current => ({ ...current, humanDelay: e.target.checked }))} />
            <span>⏱️ <strong>拟人化思考延时</strong>（随机延迟 2~4 秒后发送，杜绝秒回封号）</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
            <input type="checkbox" checked={config.splitBubbles ?? false} onChange={e => setConfig(current => ({ ...current, splitBubbles: e.target.checked }))} />
            <span>💬 <strong>长文本短句分段发送</strong>（拆成 2~3 个短气泡分次发送，贴近真人节奏）</span>
          </label>
        </div>
        <p className="dr-warning">持续回复的自动与人工草稿模式都必须先连接匹配固件的 Pico 1 或 M5Stack CoreS3。USB 断开或异常会停止任务，绝不回退到无保护纯软件输入。自动模式逐键输入中文全拼、英文数字和常用标点，读取当前候选窗选词；适配目标含微软、微信、搜狗、百度输入法。请启用全拼并最大化目标窗口，让候选词完整可见；从空白输入框开始。{usbStatus?.connected ? (usbStatus.armed ? ' 软件任务会话活动中。' : ' 已连接，等待软件开始。') : ' 当前未连接。'}</p><div className="dr-context"><fieldset><legend>业务知识</legend><label><input type="radio" name="knowledge-mode" checked={(config.knowledgeMode ?? 'selected') === 'selected'} onChange={() => setConfig(current => ({ ...current, knowledgeMode: 'selected' }))} />仅使用手动选择的知识（最多 20 条）</label><label><input type="radio" name="knowledge-mode" checked={config.knowledgeMode === 'retrieve'} onChange={() => setConfig(current => ({ ...current, knowledgeMode: 'retrieve' }))} />按每条新消息检索已审核、已启用的本地知识</label>{config.knowledgeMode === 'retrieve' && <p className="dr-warning">这是明确授权：若下方不勾选范围，系统会从当前独立工作区全部已审核、已启用知识中本地检索；仅实际命中的完整条目才会发给模型。</p>}{activeKnowledge.length ? activeKnowledge.map(item => <label key={item.id}><input type="checkbox" checked={config.knowledgeIds.includes(item.id)} onChange={() => setConfig(current => ({ ...current, knowledgeIds: current.knowledgeIds.includes(item.id) ? current.knowledgeIds.filter(id => id !== item.id) : [...current.knowledgeIds, item.id] }))} />{item.title}</label>) : <p className="muted">没有已审核且已启用知识条目。</p>}</fieldset><Field label="工作流程"><select aria-label="持续回复工作流程" value={config.workflowId} onChange={e => setConfig(current => ({ ...current, workflowId: e.target.value }))}><option value="">不使用工作流程</option>{state.workflows.filter(item => item.enabled).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field></div><div className="dr-save"><div><strong>{provider?.configured ? '所选模型已配置' : '尚未配置所选模型'}</strong><p>{provider?.configured ? `${provider.model} · ${provider.baseUrl}` : (config.modelProtocol === 'gemini-native' ? '在电脑操作页保存 Gemini 原生协议、模型和 API Key；读取、生成、原生动作与输入法使用同一密钥。' : '在设置页配置 OpenAI 兼容视觉模型。旧配置保留此协议。')}</p></div><Button variant="secondary" onClick={() => navigate(config.modelProtocol === 'gemini-native' ? 'computer-use' : 'settings')}>配置所选模型</Button><Button busy={busy} disabled={running} onClick={() => void save()}><Check size={16} />保存配置</Button></div></section>
    </div><aside className="panel dr-status"><div className="panel-head"><div><h2>持续运行状态</h2><p>{replyState?.message || '尚未加载运行状态。'}</p></div><span className={`dr-status-pill ${replyState?.status || 'stopped'}`}>{replyState?.status === 'running' ? '运行中' : replyState?.status === 'paused' ? '已暂停' : replyState?.status === 'needs_attention' ? '需要处理' : '已停止'}</span></div><div className="dr-metrics"><span>扫描轮次<strong>{replyState?.cycle || 0}</strong></span><span>下一次<strong>{replyState?.nextScanAt ? new Date(replyState.nextScanAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '—'}</strong></span></div><div className="dr-run-actions">{running ? <Button variant="secondary" disabled={busy} onClick={() => void desktop.pause().then(setReplyState).catch(error => notify((error as Error).message, true))}><Pause size={15} />暂停</Button> : <Button disabled={busy || dirty || !selected || !provider?.configured || config.conversations.length === 0 || !usbStatus?.connected} onClick={() => setConfirmStart(true)}><Play size={15} />启动前确认</Button>}<Button variant="danger" disabled={!busy && replyState?.status === 'stopped'} onClick={() => void desktop.stop().then(value => { setReplyState(value); notify('持续回复已停止'); }).catch(error => notify((error as Error).message, true))}><Square size={15} />停止</Button></div>{dirty && <p className="dr-warning">配置有未保存修改；请保存后再启动。</p>}<div className="dr-jobs"><h3>回复任务</h3>{replyState?.jobs.length ? replyState.jobs.slice(0, 30).map(job => <article key={job.id}><div><strong>{job.conversationName}</strong><p>{job.input}</p>{job.reply && <p className="dr-reply">{job.reply}</p>}<small>{statusNames[job.status]} · {job.detail || '等待更新'}</small>{job.status === 'uncertain' && <p className="dr-warning">请先检查发送记录，并人工清理未提交拼音或残留草稿，再恢复会话；此任务不会自动重试。</p>}</div><div>{job.reply && job.status !== 'sending' && <Button variant="secondary" onClick={() => void desktop.copy(job.id).then(() => notify('回复已复制')).catch(error => notify((error as Error).message, true))}><Clipboard size={14} />复制</Button>}{job.status === 'uncertain' && <Button variant="secondary" onClick={() => void desktop.resolve(job.id).then(setReplyState).catch(error => notify((error as Error).message, true))}>标记已处理</Button>}</div></article>) : <p className="muted">启动后会在这里显示生成、待复制、视觉确认或结果不明的任务。</p>}</div><div className="dr-takeovers"><h3>会话人工接管</h3>{config.conversations.map(item => { const active = replyState?.config.conversations.find(row => row.id === item.id); const takingOver = active ? !active.enabled : !item.enabled; return <label key={item.id}><span>{item.name}</span><input type="checkbox" checked={takingOver} onChange={() => void changeTakeover(item.id, takingOver)} disabled={busy} />人工接管</label>; })}</div></aside></div>
    {confirmStart && selected && <Modal title="确认启动持续回复" subtitle="仅在此确认后，才会将截图发送到已配置的模型接口，并使用已连接的 Pico / CoreS3 USB HID。" onClose={() => setConfirmStart(false)}><div className="dr-confirm"><p><strong>目标窗口：</strong>{selected.name}</p><p><strong>已保存模型：</strong>{provider?.model} · {provider?.baseUrl}</p><p><strong>回复方式：</strong>{config.mode === 'auto' ? '自动回复会在视觉确认后发送。' : '人工复制回复只生成草稿，不会自动发送。'}</p><p><strong>必需硬件：</strong>防封 USB HID（Pico / CoreS3）；断开或异常会停止任务，不回退无保护软件执行器。</p><p><strong>发送给模型：</strong>目标窗口及窗口内输入法候选截图、所选工作流，以及{config.knowledgeMode === 'retrieve' ? (config.knowledgeIds.length ? `每条新消息从限定的 ${config.knowledgeIds.length} 条知识中本地检索出的实际命中条目。` : '每条新消息从当前独立工作区所有已审核、已启用知识中本地检索出的实际命中条目。') : `手动选择的 ${config.knowledgeIds.length} 条知识。`}</p></div><div className="modal-actions"><Button variant="secondary" onClick={() => setConfirmStart(false)}>返回检查</Button><Button busy={busy} disabled={!usbStatus?.connected} onClick={() => void start()}><Play size={16} />确认启动</Button></div></Modal>}

    {showPlaybookModal && <Modal title="⚡ 载入预置实战行业话术包" subtitle="由一线销冠与售后团队打磨的标准化沟通 SOP，1 秒注入本地知识库。" onClose={() => setShowPlaybookModal(false)}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', maxHeight: '60vh', overflowY: 'auto' }}>
        {presetPacks.map(pack => (
          <div key={pack.id} style={{ padding: '14px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <strong style={{ fontSize: '15px' }}>{pack.name}</strong>
                <span style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8' }}>{pack.category}</span>
              </div>
              <Button busy={busy} onClick={() => void installPack(pack.id)}><Sparkles size={14} />一键装载 ({pack.items.length}条)</Button>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--muted, #aaa)', margin: '4px 0 10px' }}>{pack.description}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {pack.items.map((it, idx) => (
                <span key={idx} style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.05)', color: '#ccc' }}>
                  📌 {it.title}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="modal-actions">
        <Button variant="secondary" onClick={() => setShowPlaybookModal(false)}>关闭</Button>
      </div>
    </Modal>}

    {showExtractModal && <Modal title="聊天记录整理" subtitle="粘贴本地聊天文本，按角色整理为待审核的问答候选；不会调用模型，也不代表实际效果。" onClose={() => setShowExtractModal(false)}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Field label="历史聊天记录文本" hint="支持格式如「客户：... 销售：...」或多段自然对话复制">
          <textarea
            rows={7}
            placeholder="例如：&#10;客户：你们这个系统一套多少钱啊？&#10;销售：特别理解您的顾虑！很多老客户一开始也觉得有投入，但上线后一人能管 10 个窗口，当月就省掉一个客服的人工。&#10;客户：那有售后质保吗？&#10;销售：我们提供 7 天不满意退款保障和专属 1 对 1 技术顾问远程保驾护航。"
            value={extractTranscript}
            onChange={e => setExtractTranscript(e.target.value)}
          />
        </Field>
        <div style={{ display: 'flex', gap: '10px' }}>
          <Button variant="secondary" busy={busy} onClick={() => void runExtract(false)}><Sparkles size={15} />整理预览</Button>
          <Button busy={busy} onClick={() => void runExtract(true)}><Check size={15} />保存为待审核候选</Button>
        </div>
        {extractResult && (
          <div style={{ marginTop: '10px', padding: '14px', borderRadius: '8px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <h4 style={{ margin: '0 0 8px', fontSize: '14px', color: '#38bdf8' }}>整理结果：{extractResult.title}</h4>
            <p style={{ margin: '4px 0', fontSize: '13px' }}><strong>核心异议点：</strong>{extractResult.objection}</p>
            <p style={{ margin: '4px 0', fontSize: '13px' }}><strong>化解策略：</strong>{extractResult.strategy}</p>
            <div style={{ margin: '10px 0 0' }}>
              <strong style={{ fontSize: '13px' }}>提炼出 {extractResult.suggestedQa.length} 组标准问答：</strong>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                {extractResult.suggestedQa.map((qa, i) => (
                  <div key={i} style={{ padding: '8px 12px', borderRadius: '6px', background: 'rgba(0,0,0,0.2)', fontSize: '12px' }}>
                    <p style={{ margin: '0 0 4px', color: '#fbbf24' }}><strong>问：</strong>{qa.question}</p>
                    <p style={{ margin: 0, color: '#e2e8f0' }}><strong>答：</strong>{qa.answer}</p>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ marginTop: '12px' }}>
              <Button busy={busy} onClick={() => void runExtract(true)}><Check size={15} />保存上述候选，等待审核</Button>
            </div>
          </div>
        )}
      </div>
      <div className="modal-actions">
        <Button variant="secondary" onClick={() => setShowExtractModal(false)}>取消</Button>
      </div>
    </Modal>}

    {showLeadsModal && <Modal title="📊 私域客资线索看板 (CRM Leads)" subtitle="由视觉监听与会话分析自动沉淀的客户意向、联系电话、预算与痛点资产表。" onClose={() => setShowLeadsModal(false)}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: '6px', background: 'rgba(255,255,255,0.03)' }}>
          <div style={{ display: 'flex', gap: '12px', fontSize: '13px' }}>
            <span>已沉淀线索：<strong>{leadsList.length}</strong> 条</span>
            <span style={{ color: '#ef4444' }}>🔥 高意向: <strong>{leadsList.filter(l => l.intent === 'high').length}</strong></span>
            <span style={{ color: '#f59e0b' }}>⚖️ 比价中: <strong>{leadsList.filter(l => l.intent === 'medium').length}</strong></span>
            <span style={{ color: '#3b82f6' }}>❓ 咨询: <strong>{leadsList.filter(l => l.intent === 'low').length}</strong></span>
            <span style={{ color: '#ec4899' }}>⚠️ 投诉预警: <strong>{leadsList.filter(l => l.intent === 'complaint').length}</strong></span>
          </div>
          <Button variant="secondary" disabled={leadsList.length === 0} onClick={() => exportLeadsCsv(leadsList)}>
            <Download size={14} />导出 CSV / Excel 报表
          </Button>
        </div>
        {leadsList.length === 0 ? (
          <p className="muted" style={{ textAlign: 'center', padding: '30px 0' }}>当前暂无线索。当持续回复监听会话接收到客户新消息时，系统将自动识别意向并沉淀在此。</p>
        ) : (
          <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', textAlign: 'left', color: 'var(--muted, #888)' }}>
                  <th style={{ padding: '8px' }}>会话名称</th>
                  <th style={{ padding: '8px' }}>意向级别</th>
                  <th style={{ padding: '8px' }}>联系方式</th>
                  <th style={{ padding: '8px' }}>预算</th>
                  <th style={{ padding: '8px' }}>核心诉求 / 痛点</th>
                  <th style={{ padding: '8px' }}>建议跟进步骤</th>
                </tr>
              </thead>
              <tbody>
                {leadsList.map(l => (
                  <tr key={l.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '8px', fontWeight: 600 }}>{l.conversationName}</td>
                    <td style={{ padding: '8px' }}>
                      <span style={{
                        padding: '2px 6px', borderRadius: '4px', fontSize: '11px',
                        background: l.intent === 'high' ? 'rgba(239,68,68,0.2)' : l.intent === 'medium' ? 'rgba(245,158,11,0.2)' : l.intent === 'complaint' ? 'rgba(236,72,153,0.2)' : 'rgba(59,130,246,0.2)',
                        color: l.intent === 'high' ? '#ef4444' : l.intent === 'medium' ? '#f59e0b' : l.intent === 'complaint' ? '#ec4899' : '#3b82f6',
                      }}>
                        {l.intent === 'high' ? '🔥 高意向' : l.intent === 'medium' ? '⚖️ 比价中' : l.intent === 'complaint' ? '⚠️ 投诉预警' : '❓ 仅咨询'}
                      </span>
                    </td>
                    <td style={{ padding: '8px' }}>
                      {l.phone && <div>📞 {l.phone}</div>}
                      {l.wechatId && <div>💬 {l.wechatId}</div>}
                      {!l.phone && !l.wechatId && <span className="muted">—</span>}
                    </td>
                    <td style={{ padding: '8px' }}>{l.budget || <span className="muted">—</span>}</td>
                    <td style={{ padding: '8px' }}>{l.painPoint || <span className="muted">—</span>}</td>
                    <td style={{ padding: '8px', color: '#38bdf8' }}>{l.nextStep || <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="modal-actions">
        <Button variant="secondary" onClick={() => setShowLeadsModal(false)}>关闭</Button>
      </div>
    </Modal>}
  </>;
}
