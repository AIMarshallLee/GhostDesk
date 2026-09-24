import { useCallback, useEffect, useState } from 'react';
import { LayoutDashboard, ListTodo, ScanLine, BookOpen, Workflow as WorkflowIcon, History, Settings, Plus, Search, Menu, X, AlertCircle, CheckCircle2, ArrowUpRight, Monitor, PanelLeftClose, LoaderCircle, Bot, MessagesSquare, Usb, Sparkles } from 'lucide-react';
import type { ApiRequest, AppState, CaptureResult, Task } from '../shared/types';
import { api, getState, navigate } from './api';
import { Button, Logo, Modal, Field, scenarios } from './components';
import Landing from './Landing';
import { Dashboard, Tasks, TaskDetail } from './Tasks';
import { KnowledgePage, WorkflowPage, AuditPage, SettingsPage } from './Workspace';
import CapturePage from './Capture';
import AutopilotPage from './Autopilot';
import ComputerUsePage from './ComputerUse';
import DesktopRepliesPage from './DesktopReplies';
import HardwarePage from './Hardware';
import AttachmentsPage from './Attachments';
import WorkerStudio from './WorkerStudio';
import Copilot from './Copilot';

export interface PageProps {
  state: AppState;
  perform: <T>(method: ApiRequest['method'], path: string, body?: unknown, message?: string) => Promise<T | undefined>;
  busy: boolean;
  notify: (message: string, error?: boolean) => void;
  newTask: () => void;
}
const navItems = [
  ['copilot', '⚡ 超轻私域副驾', Sparkles],
  ['desktop-replies', '即时通讯私域管家', MessagesSquare],
  ['app', '工作概览', LayoutDashboard], ['workers', '数字员工', Bot], ['autopilot', '回复模式实验室', WorkflowIcon], ['tasks', '任务中心', ListTodo], ['capture', '窗口助手', ScanLine],
  ['computer-use', '电脑操作', Bot], ['attachments', '附件助手', ScanLine], ['hardware', 'USB 硬件', Usb], ['knowledge', '业务知识库', BookOpen], ['workflows', '工作流程', WorkflowIcon], ['audit', '活动记录', History],
] as const;
function getRoute() {
  const hash = window.location.hash.slice(1);
  if (hash === 'copilot' || hash === 'jev') return 'copilot';
  return ['top', 'capabilities', 'method', 'scenarios', 'faq'].includes(hash) ? 'home' : hash || (window.flowdesk ? 'app' : 'home');
}

export default function App() {
  const [route, setRoute] = useState(getRoute);
  const [state, setState] = useState<AppState>();
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; error: boolean }>();
  const [showNew, setShowNew] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [search, setSearch] = useState('');
  const [mobileMenu, setMobileMenu] = useState(false);
  const [capture, setCapture] = useState<CaptureResult>();
  const [captureTaskId, setCaptureTaskId] = useState<string>();
  const notify = useCallback((message: string, error = false) => setToast({ message, error }), []);
  const refresh = useCallback(async () => { try { const result = await getState(); setState(result); setLoadError(''); } catch (e) { setLoadError((e as Error).message); } }, []);
  useEffect(() => { const fn = () => { const next = getRoute(); setRoute(next); setMobileMenu(false); if (next !== 'home') window.scrollTo(0, 0); }; fn(); window.addEventListener('hashchange', fn); return () => window.removeEventListener('hashchange', fn); }, []);
  useEffect(() => { if (route !== 'home' && !state) void refresh(); }, [route, state, refresh]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(undefined), toast.error ? 9000 : 4500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { const fn = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'k' && route !== 'home') { e.preventDefault(); setShowSearch(true); } }; document.addEventListener('keydown', fn); return () => document.removeEventListener('keydown', fn); }, [route]);
  const perform: PageProps['perform'] = async (method, path, body, message) => {
    if (busy) return;
    setBusy(true);
    try { const result = await api(method, path, body); await refresh(); if (message) notify(message); return result as never; }
    catch (e) { notify((e as Error).message, true); return undefined; }
    finally { setBusy(false); }
  };
  const props: PageProps | undefined = state ? { state, perform, busy, notify, newTask: () => setShowNew(true) } : undefined;
  const currentPage = route.split('/')[0];
  const title = navItems.find(x => x[0] === currentPage)?.[1] || (currentPage === 'settings' ? '设置' : '任务详情');
  if (route === 'copilot') return <Copilot onOpenFullAdmin={() => navigate('desktop-replies')} />;
  if (route === 'home') return <Landing />;
  return <div className="workspace-shell">
    {mobileMenu && <div className="sidebar-scrim" onClick={() => setMobileMenu(false)} />}
    <aside className={`sidebar ${mobileMenu ? 'is-open' : ''}`}>
      <button className="brand-button" onClick={() => navigate('home')} aria-label="返回 FlowDesk 官网"><Logo small /></button>
      <div className="workspace-switch"><span className="workspace-avatar">F</span><div><strong>{state?.preferences.workspaceName || '我的工作空间'}</strong><small>个人空间 · 本地版</small></div><PanelLeftClose size={15} /></div>
      <Button variant="dark" className="sidebar-new" onClick={() => setShowNew(true)} disabled={!state}><Plus size={17} />新建任务<span>＋</span></Button>
      <div className="nav-label">工作空间</div><nav aria-label="工作台导航">{navItems.map(([key, label, Icon]) => <button key={key} className={`nav-item ${currentPage === key || key === 'tasks' && currentPage === 'task' ? 'active' : ''}`} onClick={() => navigate(key)}><Icon size={18} /><span>{label}</span>{key === 'tasks' && !!state?.tasks.filter(t => t.status === 'review').length && <b>{state.tasks.filter(t => t.status === 'review').length}</b>}{key === 'capture' && <span className="tiny-badge">视觉</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="local-card"><span className="signal-dot" /><strong>你的数据，留在本地</strong><p>自动回复或人工复制，由你选择。</p><button onClick={() => navigate('settings')}>管理模型与存储<ArrowUpRight size={14} /></button></div><button className={`nav-item ${currentPage === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}><Settings size={18} /><span>设置</span></button><div className="sidebar-user"><span>{(state?.preferences.operatorName || '我').slice(0, 1)}</span><div><strong>{state?.preferences.operatorName || '工作空间主人'}</strong><small>FlowDesk 0.8.0</small></div><span className="online-dot" /></div></div>
    </aside>
    <div className="workspace-main"><header className="app-topbar"><div className="breadcrumbs"><button className="icon-button mobile-toggle" onClick={() => setMobileMenu(true)} aria-label="打开导航"><Menu size={20} /></button><span>工作空间</span><span>/</span><strong>{title}</strong></div><div className="topbar-right"><button className="environment-tag" style={{ cursor: 'pointer', background: '#eff6ff', color: '#2563eb', fontWeight: 600, border: '1px solid #bfdbfe' }} onClick={() => navigate('copilot')} title="切换到 380px Jev 风格极轻侧边栏工作台"><Sparkles size={13} style={{ marginRight: 4 }} />⚡ 超轻私域副驾</button><button className="search-trigger" onClick={() => setShowSearch(true)}><Search size={16} /><span>搜索任务</span><kbd>Ctrl K</kbd></button><span className="environment-tag"><span />{window.flowdesk ? (/macintosh|mac os x/i.test(navigator.userAgent) ? 'macOS 桌面端' : 'Windows 桌面端') : '本地浏览器版'}</span><button className="icon-button" onClick={() => navigate('home')} aria-label="查看官网"><ArrowUpRight size={18} /></button></div></header>
      <main className="app-content">{!state ? <div className="loading-state">{loadError ? <><AlertCircle size={34} /><h2>无法连接本地工作空间</h2><p>{loadError}</p><Button onClick={() => void refresh()}>重新连接</Button><code>npm run dev</code></> : <><LoaderCircle className="spin" size={28} /><p>正在打开你的工作空间…</p></>}</div> : props && <>
        {currentPage === 'app' && <Dashboard {...props} />}
        {currentPage === 'workers' && <WorkerStudio />}
        {currentPage === 'autopilot' && <AutopilotPage />}
        {currentPage === 'tasks' && <Tasks {...props} />}
        {currentPage === 'task' && <TaskDetail {...props} taskId={route.split('/')[1]} capture={captureTaskId === route.split('/')[1] ? capture : undefined} />}
        {currentPage === 'capture' && <CapturePage {...props} capture={capture} onCapture={value => { setCapture(value); setCaptureTaskId(undefined); }} onCreate={id => { setCaptureTaskId(id); navigate(`task/${id}`); }} />}
        {currentPage === 'computer-use' && <ComputerUsePage {...props} />}
        {currentPage === 'desktop-replies' && <DesktopRepliesPage {...props} />}
        {currentPage === 'attachments' && <AttachmentsPage {...props} />}
        {currentPage === 'hardware' && <HardwarePage {...props} />}
        {currentPage === 'knowledge' && <KnowledgePage {...props} />}
        {currentPage === 'workflows' && <WorkflowPage {...props} />}
        {currentPage === 'audit' && <AuditPage {...props} />}
        {currentPage === 'settings' && <SettingsPage {...props} />}
        {!['app', 'workers', 'autopilot', 'tasks', 'task', 'capture', 'computer-use', 'desktop-replies', 'attachments', 'hardware', 'knowledge', 'workflows', 'audit', 'settings'].includes(currentPage) && <div className="empty"><h2>没有找到这个页面</h2><Button onClick={() => navigate()}>返回工作概览</Button></div>}
      </>}</main><footer className="app-footer"><span><Monitor size={13} />本地优先 · 由你掌控</span><span>FlowDesk / 让工作有序流动</span></footer>
    </div>
    {showNew && props && <NewTask {...props} onClose={() => setShowNew(false)} />}
    {showSearch && <Modal title="搜索任务" subtitle="按任务名称、输入内容或回复搜索" onClose={() => setShowSearch(false)}><div className="search-box"><Search size={18} /><input autoFocus aria-label="搜索任务内容" placeholder="输入关键词…" value={search} onChange={e => setSearch(e.target.value)} /></div><div className="search-results">{state?.tasks.filter(t => `${t.title} ${t.input} ${t.reply}`.toLowerCase().includes(search.toLowerCase())).slice(0, 20).map(t => <button key={t.id} onClick={() => { navigate(`task/${t.id}`); setShowSearch(false); }}><ListTodo size={18} /><span><strong>{t.title}</strong><small>{t.input.slice(0, 70)}</small></span><ArrowUpRight size={16} /></button>)}{state && state.tasks.filter(t => `${t.title} ${t.input} ${t.reply}`.toLowerCase().includes(search.toLowerCase())).length === 0 && <p className="muted">没有匹配的任务。</p>}</div></Modal>}
    {toast && <div role={toast.error ? 'alert' : 'status'} className={`toast ${toast.error ? 'toast-error' : ''}`}>{toast.error ? <AlertCircle size={19} /> : <CheckCircle2 size={19} />}<span>{toast.message}</span><button aria-label="关闭提示" onClick={() => setToast(undefined)}><X size={16} /></button></div>}
  </div>;
}

function NewTask({ state, perform, busy, onClose }: PageProps & { onClose: () => void }) {
  const [title, setTitle] = useState(''); const [scenario, setScenario] = useState<Task['scenario']>('service'); const [workflowId, setWorkflow] = useState(''); const [input, setInput] = useState('');
  return <Modal title="新建一个任务" subtitle="描述需要处理的对话，让助手帮你起草第一步。" onClose={onClose}><form onSubmit={async e => { e.preventDefault(); const task = await perform<Task>('POST', '/tasks', { title, scenario, workflowId, input, sourceName: '手动输入' }, '任务已创建'); if (task) { onClose(); navigate(`task/${task.id}`); } }}><Field label="任务名称"><input required maxLength={120} placeholder="例如：回复客户关于交付周期的咨询" value={title} onChange={e => setTitle(e.target.value)} /></Field><div className="form-row"><Field label="业务场景"><select value={scenario} onChange={e => { setScenario(e.target.value as Task['scenario']); setWorkflow(''); }}>{Object.entries(scenarios).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="工作流程"><select value={workflowId} onChange={e => setWorkflow(e.target.value)}><option value="">通用回复助手</option>{state.workflows.filter(w => w.enabled && w.scenario === scenario).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field></div><Field label="对话内容 / 任务说明" hint="可以粘贴需要回复的内容，也可以稍后在窗口助手中选择截图。"><textarea required rows={5} maxLength={20000} placeholder="客户说了什么？你希望怎样回应？" value={input} onChange={e => setInput(e.target.value)} /></Field><div className="notice"><span className="signal-dot" />新任务会先进入草稿状态，由你选择离线演示或真实模型。</div><div className="modal-actions"><Button type="button" variant="secondary" onClick={onClose}>取消</Button><Button type="submit" busy={busy}>创建任务<ArrowUpRight size={16} /></Button></div></form></Modal>;
}
