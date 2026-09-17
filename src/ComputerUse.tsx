import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, ExternalLink, KeyRound, Monitor, Play, ShieldCheck, Square, Target, Upload, WandSparkles } from 'lucide-react';
import type { ComputerUseMode, ComputerUseSettings, ComputerUseState, ComputerUseTarget } from '../shared/computer-use';
import type { UsbStatus } from '../shared/types';
import type { PageProps } from './App';
import { Button, Empty, Field, Modal, PageHead } from './components';
import { navigate } from './api';
import './computer-use.css';

const blankSettings: ComputerUseSettings = { baseUrl: '', model: '', modelFamily: 'ui-tars', hasKey: false };
const geminiRootBaseUrl = 'https://generativelanguage.googleapis.com';
const geminiRecommendedModel = 'gemini-3.8-flash';

export default function ComputerUsePage({ state, notify }: PageProps) {
  const desktop = window.flowdesk?.computerUse;
  const [settings, setSettings] = useState<ComputerUseSettings>(blankSettings);
  const [savedSettings, setSavedSettings] = useState<ComputerUseSettings>(blankSettings);
  const [key, setKey] = useState('');
  const [cuState, setCuState] = useState<ComputerUseState>();
  const [targets, setTargets] = useState<ComputerUseTarget[]>([]);
  const [selectedTarget, setSelectedTarget] = useState('');
  const [instruction, setInstruction] = useState('');
  const [mode, setMode] = useState<ComputerUseMode>('manual');
  const inputBackend = 'usb' as const;
  const [usbStatus, setUsbStatus] = useState<UsbStatus>();
  const [maxSteps, setMaxSteps] = useState(12);
  const [knowledgeIds, setKnowledgeIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmStart, setConfirmStart] = useState(false);

  const refresh = useCallback(async () => {
    if (!desktop) return;
    try { setCuState(await desktop.state()); } catch (error) { notify((error as Error).message, true); }
  }, [desktop, notify]);
  useEffect(() => { if (!desktop) return; void Promise.all([desktop.settings().then(value => { setSettings(value); setSavedSettings(value); }), refresh()]).catch(error => notify((error as Error).message, true)); }, [desktop, notify, refresh]);
  useEffect(() => {
    if (!desktop || !['running', 'awaiting_confirmation'].includes(cuState?.status ?? '')) return;
    const timer = window.setInterval(() => void refresh(), 1000);
    return () => window.clearInterval(timer);
  }, [desktop, cuState?.status, refresh]);
  useEffect(() => { if (!window.flowdesk?.usb) return; const read = () => void window.flowdesk!.usb.status().then(setUsbStatus).catch(() => setUsbStatus(undefined)); read(); const timer = window.setInterval(read, 2000); return () => window.clearInterval(timer); }, []);

  const selected = useMemo(() => targets.find(target => target.id === selectedTarget), [targets, selectedTarget]);
  const activeKnowledge = state.knowledge.filter(item => item.enabled);
  const running = cuState?.status === 'running';
  const awaitingConfirmation = cuState?.status === 'awaiting_confirmation';
  const locked = running || awaitingConfirmation;
  const gemini = settings.modelFamily === 'gemini';
  const settingsDirty = key.length > 0 || settings.baseUrl !== savedSettings.baseUrl || settings.model !== savedSettings.model || settings.modelFamily !== savedSettings.modelFamily;
  const statusName: Record<ComputerUseState['status'], string> = { idle: '未开始', running: '执行中', awaiting_confirmation: '等待确认', completed: '已完成', stopped: '已停止', failed: '失败', needs_help: '需要协助' };
  if (!desktop) return <>
    <PageHead title="电脑操作" description="该功能需要桌面客户端（支持 Windows / macOS）的受控本机桥接。浏览器版不会读取窗口、截图或执行输入。" />
    <section className="cu-browser panel"><Empty title="请在桌面客户端中打开（支持 Windows / macOS）" detail="网页版本可继续使用虚构聊天环境，验证自动回复与人工复制流程。" action={<Button onClick={() => navigate('autopilot')}>打开回复模式实验室<ExternalLink size={16} /></Button>} /></section>
  </>;


  const saveSettings = async () => {
    setBusy(true);
    try { const value = await desktop.saveSettings({ ...settings, ...(key ? { apiKey: key } : {}) }); setSettings(value); setSavedSettings(value); setKey(''); notify('电脑操作模型设置已保存'); }
    catch (error) { notify((error as Error).message, true); } finally { setBusy(false); }
  };
  const listTargets = async () => {
    setBusy(true);
    try { const result = await desktop.targets(); setTargets(result); if (!selectedTarget && result[0]) setSelectedTarget(result[0].id); notify(result.length ? '已列出可选窗口' : '没有可选窗口'); }
    catch (error) { notify((error as Error).message, true); } finally { setBusy(false); }
  };
  const openFixture = async () => {
    setBusy(true);
    try { const target = await desktop.openTestTarget(); setTargets(current => [target, ...current.filter(item => item.id !== target.id)]); setSelectedTarget(target.id); notify('内置测试窗口已准备好'); }
    catch (error) { notify((error as Error).message, true); } finally { setBusy(false); }
  };
  const start = async () => {
    if (!selected || !instruction.trim() || settingsDirty) return;
    setBusy(true);
    try { setCuState(await desktop.start({ targetId: selected.id, instruction: instruction.trim(), mode, maxSteps, allowModel: true, knowledgeIds, inputBackend })); setConfirmStart(false); notify(mode === 'auto' ? '电脑操作已开始' : '已开始生成操作草稿'); }
    catch (error) { notify((error as Error).message, true); } finally { setBusy(false); }
  };
  const confirm = async (approved: boolean) => {
    const pending = cuState?.pendingConfirmation;
    if (!pending) return;
    setBusy(true);
    try { setCuState(await desktop.confirm({ id: pending.id, approved })); notify(approved ? '已确认继续执行' : '已拒绝该操作'); }
    catch (error) { notify((error as Error).message, true); } finally { setBusy(false); }
  };

  return <>
    <PageHead eyebrow="CROSS-PLATFORM COMPUTER USE" title="电脑操作" description="选择一个目标应用窗口，再由模型根据窗口画面逐步操作。自动模式可输入并发送；人工模式只生成操作草稿。" />
    <div className="cu-layout">
      <div className="cu-main">
        <section className="panel cu-panel"><div className="cu-section-head"><span><KeyRound size={18} /></span><div><h2>{gemini ? 'Gemini 原生 Computer Use' : '视觉动作模型'}</h2><p>{gemini ? '使用 Gemini 原生 Computer Use 接口（默认推荐最新 gemini-3.8-flash）。如需使用 Claude 5.1 / 5.2 / 3.7，推荐通过 npm run mcp 启动标准 MCP 服务作为工具外挂。' : '需要支持 UI-TARS 或 Qwen2.5-VL 动作协议的视觉模型，不是普通聊天模型。'}</p></div></div>
          <div className="form-row"><Field label="模型协议"><select aria-label="电脑操作模型协议" disabled={locked} value={settings.modelFamily} onChange={e => { const modelFamily = e.target.value as ComputerUseSettings['modelFamily']; setSettings(modelFamily === 'gemini' ? { ...settings, modelFamily, baseUrl: geminiRootBaseUrl, model: geminiRecommendedModel } : { ...settings, modelFamily }); }}><option value="gemini">Gemini 原生 Computer Use (推荐 gemini-3.8-flash)</option><option value="ui-tars">UI-TARS / Qwen2.5-VL</option><option value="doubao">豆包 Computer Use</option></select></Field>{gemini ? <Field label="原生接口地址"><input aria-label="Gemini 原生接口地址" value={geminiRootBaseUrl} disabled /></Field> : <Field label="接口地址"><input aria-label="电脑操作接口地址" disabled={locked} value={settings.baseUrl} placeholder="https://…/v1" onChange={e => setSettings({ ...settings, baseUrl: e.target.value })} /></Field>}</div>
          <div className="form-row"><Field label="模型名称"><input aria-label="电脑操作模型名称" disabled={locked} value={settings.model} placeholder={gemini ? geminiRecommendedModel : 'UI-TARS 模型名'} onChange={e => setSettings({ ...settings, model: e.target.value })} /></Field><Field label={settings.hasKey ? '更新 API Key（已保存）' : 'API Key'}><input aria-label="电脑操作 API Key" disabled={locked} type="password" autoComplete="off" value={key} placeholder={settings.hasKey ? '留空则保持现有密钥' : '仅保存到本机安全存储'} onChange={e => setKey(e.target.value)} /></Field></div>
          <div className="settings-actions"><Button busy={busy} disabled={locked} onClick={() => void saveSettings()}>保存设置</Button>{settings.hasKey && <Button variant="secondary" disabled={busy || locked} onClick={() => void desktop.clearKey().then(value => { setSettings(value); setSavedSettings(value); notify('API Key 已移除'); }).catch(error => notify((error as Error).message, true))}>移除 Key</Button>}</div>
        </section>
        <section className="panel cu-panel"><div className="cu-section-head"><span><Monitor size={18} /></span><div><h2>明确选择目标窗口</h2><p>不会自动枚举或截图。请主动打开内置测试窗口，或手动列出本机应用窗口。</p></div></div>
          <div className="cu-actions"><Button variant="secondary" busy={busy} disabled={locked} onClick={() => void openFixture()}>打开内置测试窗口</Button><Button variant="secondary" busy={busy} disabled={locked} onClick={() => void listTargets()}>列出应用窗口</Button></div>
          {targets.length > 0 && <div className="cu-targets" role="radiogroup" aria-label="电脑操作目标窗口">{targets.map(target => <label key={target.id} className={selectedTarget === target.id ? 'selected' : ''}><input disabled={locked} type="radio" name="computer-target" checked={selectedTarget === target.id} onChange={() => setSelectedTarget(target.id)} /><Target size={15} /><span>{target.name}</span><small>{target.kind === 'test' ? '内置测试' : '应用窗口'}</small></label>)}</div>}
        </section>
        <section className="panel cu-panel"><div className="cu-section-head"><span><WandSparkles size={18} /></span><div><h2>本次操作</h2><p>知识条目默认为不选择。模型只会收到你勾选的内容与所选窗口截图。</p></div></div>
          <Field label="操作指令"><textarea aria-label="电脑操作指令" disabled={locked} rows={4} maxLength={2000} value={instruction} placeholder="例如：在测试窗口中填写虚构客户信息并保存草稿" onChange={e => setInstruction(e.target.value)} /></Field>
          <div className="form-row"><Field label="执行方式"><select aria-label="电脑操作执行方式" disabled={locked} value={mode} onChange={e => setMode(e.target.value as ComputerUseMode)}><option value="manual">人工复制回复</option><option value="auto">自动回复</option></select></Field><Field label="必需硬件"><input aria-label="电脑操作必需硬件" value="Pico / CoreS3 USB HID（已固定）" disabled /></Field><Field label="最大步骤"><input aria-label="最大操作步骤" disabled={locked} type="number" min="1" max="25" value={maxSteps} onChange={e => setMaxSteps(Math.max(1, Math.min(25, Number(e.target.value) || 1)))} /></Field></div><div className="notice">电脑操作的自动与人工草稿模式都必须先连接匹配固件的 Pico 1 或 M5Stack CoreS3；USB 断开或异常会停止任务，绝不回退到无保护纯软件输入。{gemini ? '逐键输入使用 Gemini 原生 Computer Use 的模型 Key 作候选识别，不另设普通视觉模型。' : '逐键输入使用“设置”中的普通视觉模型识别候选词。'}请最大化目标窗口，让候选词完整可见，并从空白输入框开始；输入中断后先人工清理未提交拼音和草稿。{usbStatus?.connected ? (usbStatus.armed ? ' 软件任务会话活动中。' : ' 已连接，等待软件开始。') : ' 当前未连接。'}</div>
          {activeKnowledge.length > 0 && <fieldset className="cu-knowledge" disabled={locked}><legend>可选业务知识</legend>{activeKnowledge.map(item => <label key={item.id}><input type="checkbox" checked={knowledgeIds.includes(item.id)} onChange={() => setKnowledgeIds(current => current.includes(item.id) ? current.filter(id => id !== item.id) : [...current, item.id])} />{item.title}</label>)}</fieldset>}
          <div className="cu-start"><div><ShieldCheck size={17} /><p>{awaitingConfirmation ? '模型提出了下一步操作，等待你确认或拒绝；当前仍可停止任务。' : settingsDirty ? '模型设置有未保存修改，请先保存后再开始。' : !savedSettings.hasKey ? `请先保存 ${gemini ? 'Gemini 原生接口的' : '支持 UI-TARS 动作协议的模型'} API Key。` : !usbStatus?.connected ? '请先连接匹配固件的 Pico / CoreS3 USB HID；离线时只能查看管理与烧录说明。' : mode === 'auto' ? '自动模式会向模型发送所选窗口截图与知识，并可能在目标窗口输入、点击或发送。' : '人工模式也需要防封 USB HID 已连接；只生成草稿，不会自动发送。'}</p></div><Button disabled={!selected || !instruction.trim() || busy || locked || settingsDirty || !savedSettings.hasKey || !usbStatus?.connected} onClick={() => setConfirmStart(true)}><Play size={16} />开始前确认</Button></div>
        </section>
      </div>
      <aside className="cu-run panel"><div className="panel-head"><div><h2>执行状态</h2><p>{cuState?.message || '尚未开始电脑操作。'}</p></div><span className={`cu-status ${cuState?.status || 'idle'}`}>{statusName[cuState?.status || 'idle']}</span></div>
        {cuState?.target && <div className="cu-current-target"><Monitor size={16} /><span>{cuState.target.name}</span></div>}
        {awaitingConfirmation && cuState.pendingConfirmation && <div className="cu-pending-confirmation"><strong>需要人工确认</strong><p>{cuState.pendingConfirmation.reason}</p><ul>{cuState.pendingConfirmation.actions.map(action => <li key={action}>{action}</li>)}</ul><div><Button variant="secondary" disabled={busy} onClick={() => void confirm(false)}>拒绝</Button><Button disabled={busy} onClick={() => void confirm(true)}>确认继续</Button></div></div>}
        <div className="cu-steps">{cuState?.steps?.length ? cuState.steps.map(step => <article key={`${step.index}-${step.at}`}><span>{step.index}</span><div><strong>{step.action}</strong><p>{step.detail}</p></div><small>{step.outcome === 'blocked' ? '已拦截' : step.outcome === 'draft' ? '草稿' : '已执行'}</small></article>) : <p className="muted">每个计划、已执行或被拦截的动作都会显示在这里。</p>}</div>
        {cuState?.draft && <div className="cu-draft"><strong>人工操作草稿</strong><p>{cuState.draft}</p><Button variant="secondary" onClick={() => void desktop.copyDraft().then(() => notify('操作草稿已复制')).catch(error => notify((error as Error).message, true))}><Copy size={15} />复制草稿</Button></div>}
        {(running || awaitingConfirmation) && <Button className="full-width" variant="danger" onClick={() => void desktop.stop().then(value => { setCuState(value); notify('已请求停止'); }).catch(error => notify((error as Error).message, true))}><Square size={15} />停止操作</Button>}
      </aside>
    </div>
    {confirmStart && selected && <Modal title="确认开始电脑操作" subtitle="这一步才会把模型请求发送到你配置的接口，并使用已连接的 Pico / CoreS3 USB HID。" onClose={() => setConfirmStart(false)}><div className="cu-confirm"><p><strong>目标窗口：</strong>{selected.name}</p><p><strong>已保存模型：</strong>{savedSettings.model || '未设置'} · {savedSettings.baseUrl || '未设置接口地址'}</p><p><strong>执行方式：</strong>{mode === 'auto' ? '自动回复：模型可在目标窗口输入、点击或发送。' : '人工复制回复：只生成草稿，不会自动发送。'}</p><p><strong>硬件：</strong>防封 USB HID 已连接；断开或异常会停止任务，不回退无保护软件执行器。</p><p><strong>发送给模型：</strong>所选窗口截图（含输入法候选词）、操作指令，以及 {knowledgeIds.length} 条所选业务知识。</p></div><div className="modal-actions"><Button variant="secondary" onClick={() => setConfirmStart(false)}>返回检查</Button><Button busy={busy} disabled={!usbStatus?.connected} onClick={() => void start()}><Upload size={16} />确认并开始</Button></div></Modal>}
  </>;
}
