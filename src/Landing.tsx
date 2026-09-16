import { useState } from 'react';
import { ArrowDownToLine, ArrowRight, Bot, Check, ChevronDown, Clipboard, Eye, FileText, Keyboard, LockKeyhole, MousePointer2, Play, Sparkles, WandSparkles, X } from 'lucide-react';
import { Logo, Modal } from './components';
import { navigate } from './api';
import './landing.css';

const scenarios = [
  { title: '电商客服', detail: '从商品信息与对话上下文，整理一条有分寸的回复。', tag: '客服' },
  { title: '社群运营', detail: '把散落的群聊重点，变成可直接发出的互动话术。', tag: '社群' },
  { title: '私域销售', detail: '识别客户意图，给出下一步跟进建议与可选表达。', tag: '销售' },
  { title: '招聘沟通', detail: '提取候选人关键信息，拟一封清晰、得体的邀约。', tag: '招聘' },
  { title: '内容运营', detail: '从画面与素材中读出业务线索，快速搭好内容骨架。', tag: '内容' },
];

const demoSteps = [
  { key: '看', label: '看见上下文', icon: Eye, text: '读取当前屏幕里与任务有关的信息。', chip: '识别 12 个信息块' },
  { key: '想', label: '想清楚意图', icon: WandSparkles, text: '结合你的业务知识，整理出合适的回应方向。', chip: '匹配「售后安抚」' },
  { key: '做', label: '做出下一步', icon: Clipboard, text: '生成草稿，交给你审核后复制到原窗口。', chip: '草稿已就绪' },
];

function ProductMockup({ onAction }: { onAction: () => void }) {
  return <div className="landing-mockup" aria-label="FlowDesk 工作流示意图">
    <div className="mockup-top"><span className="mockup-dots"><i /><i /><i /></span><span>FLOWDESK / 工作台</span><span className="mockup-live"><b /> 本地运行</span></div>
    <div className="mockup-demo-label"><span>流程示意</span> 虚构内容 · 仅用于展示</div>
    <div className="mockup-body">
      <div className="mockup-context"><div className="mockup-label">当前窗口 · 客服对话</div><div className="fake-message"><span className="fake-avatar">林</span><div><strong>林女士</strong><p>请问这款可以周末送到吗？</p><small>刚刚</small></div></div><div className="fake-message muted"><span className="fake-avatar pale">店</span><div><strong>店铺助手</strong><p>正在等待你的回复…</p></div></div></div>
      <div className="mockup-flow"><div className="flow-node"><span className="flow-icon lime"><Eye size={16} /></span><small>看</small><b>屏幕信息</b></div><span className="flow-line" /><div className="flow-node active"><span className="flow-icon dark"><Sparkles size={16} /></span><small>想</small><b>业务知识</b></div><span className="flow-line" /><div className="flow-node"><span className="flow-icon"><Clipboard size={16} /></span><small>做</small><b>回复草稿</b></div></div>
      <div className="mockup-draft"><div className="mockup-label">草稿 · 待你审核</div><p>可以的，我们支持周末配送。具体送达时间会根据收货地址显示，您下单时可以查看预计到达日期。</p><div className="draft-actions"><button onClick={onAction}>重新起草</button><button className="draft-copy" onClick={onAction}><Clipboard size={13} /> 复制草稿</button></div></div>
    </div>
  </div>;
}

export default function Landing() {
  const [demo, setDemo] = useState(0);
  const [faq, setFaq] = useState<number | null>(0);
  const [modal, setModal] = useState<'privacy' | 'download' | 'demo' | null>(null);
  const [downloadState, setDownloadState] = useState<'idle' | 'checking' | 'ready' | 'missing' | 'desktop'>('idle');

  const openDownload = async () => {
    setModal('download'); setDownloadState('checking');
    try { const r = await fetch('/downloads/windows', { method: 'HEAD' }); setDownloadState(r.ok ? 'ready' : 'missing'); }
    catch { setDownloadState('missing'); }
  };
  return <div className="landing">
    <div className="landing-grid" aria-hidden="true" />
    <header className="landing-nav"><a href="#top" className="landing-logo" aria-label="FlowDesk 首页"><Logo /></a><nav><a href="#capabilities">产品能力</a><a href="#method">工作方式</a><a href="#scenarios">应用场景</a><a href="#faq">常见问题</a><a href="#autopilot">回复模式</a></nav><div className="nav-actions"><button className="nav-text" onClick={() => navigate('app')}>进入工作台 <ArrowRight size={15} /></button><button className="nav-download" onClick={openDownload}><ArrowDownToLine size={15} /> 下载 Windows</button></div></header>
    <main id="top">
      <section className="landing-hero">
        <div className="hero-copy"><div className="beta-pill"><span /> 0.7 测试版 · 本地优先的工作助手</div><h1>把重复工作，<em>交给流动的智能。</em></h1><p className="hero-lede">FlowDesk 看懂你正在做什么，想清楚下一步怎么说，<br />把可以交给 AI 的部分，流畅地交还给你。</p><div className="hero-actions"><button className="hero-primary" onClick={() => navigate('app')}>进入工作台 <ArrowRight size={18} /></button><button className="hero-secondary" onClick={() => navigate('autopilot')}><Play size={15} /> 打开回复模式实验室</button></div><p className="hero-note"><LockKeyhole size={13} /> Windows 操作需连接匹配固件 Pico · 回复模式实验室仅用虚构数据</p></div><div className="hero-visual"><div className="visual-stamp">读屏<br /><span>→</span> 成稿</div><ProductMockup onAction={() => setModal('demo')} /><div className="visual-caption"><span>01</span> 从看见，到行动之间</div></div>
      </section>
      <section className="signal-strip"><span>为每天都在切换窗口的人设计</span><i /><span>客服 · 社群 · 销售 · 招聘 · 内容</span><i /><span>OpenAI 兼容与 Gemini 原生模型，可配置</span></section>
      <section className="section capabilities" id="capabilities"><div className="section-intro"><span className="kicker">/ 你不缺工具</span><h2>你缺的是<br /><strong>一条顺手的流。</strong></h2></div><div className="capability-list"><article><span className="cap-number">01</span><div><h3>看得见上下文</h3><p>从当前屏幕里抓住任务需要的信息，不用来回复制粘贴。</p></div><Eye /></article><article><span className="cap-number">02</span><div><h3>想得起业务知识</h3><p>把你的规则、产品资料和表达习惯，放进每一次起草。</p></div><Sparkles /></article><article><span className="cap-number">03</span><div><h3>做得出可用草稿</h3><p>给你一个可以修改、可以复制、可以负责的下一步。</p></div><Keyboard /></article></div></section>
      <section className="section method" id="method"><div className="method-head"><span className="kicker">/ 流程演示</span><div><h2>三步，少一次切换。</h2><p>下面是一个示意流程。内容为虚构，仅用于说明 FlowDesk 的工作方式。</p></div></div><div className="demo-wrap"><div className="demo-tabs">{demoSteps.map((item, i) => <button key={item.key} className={demo === i ? 'selected' : ''} onClick={() => setDemo(i)}><span>{item.key}</span>{item.label}<ArrowRight size={15} /></button>)}</div><div className="demo-panel"><div className="demo-panel-top"><span className="demo-eyebrow">FLOW / {String(demo + 1).padStart(2, '0')}</span><span className="demo-fake">示意内容</span></div><div className="demo-main"><div className="demo-icon"><span>{(() => { const Icon = demoSteps[demo].icon; return <Icon size={30} />; })()}</span></div><div><h3>{demoSteps[demo].label}</h3><p>{demoSteps[demo].text}</p><div className="demo-chip"><Check size={14} /> {demoSteps[demo].chip}</div></div></div><button className="demo-action" onClick={() => setModal('demo')}>打开流程演示 <ArrowRight size={16} /></button></div></div></section>
      <section className="autopilot-section" id="autopilot"><div className="autopilot-copy"><span className="kicker">/ 回复模式实验室</span><h2>同一套理解，<br /><em>两种交付方式。</em></h2><p>人工复制适合你想逐条把关的场景；自动回复目前可在本地聊天模拟器中体验，帮助你感受完整流程。</p><button className="autopilot-open" onClick={() => navigate('autopilot')}>打开本地模拟器 <ArrowRight size={16} /></button></div><div className="mode-cards"><article className="mode-card"><span className="mode-icon"><Clipboard size={18} /></span><div><b>人工复制</b><p>草稿生成后由你确认，再复制到目标窗口。</p></div><span className="mode-tag">可用</span></article><article className="mode-card mode-auto"><span className="mode-icon"><Bot size={18} /></span><div><b>自动回复</b><p>在本地聊天模拟器里体验自动处理与回复节奏。</p></div><span className="mode-tag">本地模拟</span></article></div></section>
      <section className="section scenarios" id="scenarios"><div className="scenario-heading"><span className="kicker">/ 应用场景</span><h2>在你熟悉的窗口里，<br /><i>把话说好。</i></h2><p>FlowDesk 不要求你迁移工作，只在需要的时候搭把手。</p></div><div className="scenario-grid">{scenarios.map((item, i) => <article key={item.title} className={`scenario-card card-${i + 1}`}><span className="scenario-tag">0{i + 1} · {item.tag}</span><h3>{item.title}</h3><p>{item.detail}</p><span className="scenario-arrow"><ArrowRight size={18} /></span></article>)}</div></section>
      <section className="download-section"><div><span className="kicker">/ 从一个小工具开始</span><h2>让下一次回复，<br /><em>更像你。</em></h2><p>Windows 11 x64 · 便携版 · 0.7 测试版<br />解压后可查看管理与烧录说明；启动 Windows 操作需连接匹配固件 Pico。</p><button className="download-cta" onClick={openDownload}><ArrowDownToLine size={17} /> 下载 Windows 便携版 <span>→</span></button></div><div className="download-aside"><div className="aside-orbit"><div className="orbit-center">FD</div><span className="orbit-node node-a">看</span><span className="orbit-node node-b">想</span><span className="orbit-node node-c">做</span></div><small>当前仅支持 Windows 11<br />x64 架构</small></div></section>
      <section className="section faq" id="faq"><div><span className="kicker">/ 常见问题</span><h2>先把边界<br />说清楚。</h2></div><div className="faq-list">{[['它会自动替我发送消息吗？','回复模式实验室的自动回复只在本地虚构聊天中体验。Windows 持续回复和单任务 Computer Use 提供自动与人工草稿模式，均需连接匹配固件 Pico，并保留确认与停止边界。'],['我的数据会被上传吗？','FlowDesk 不会持久化你的截图。截图只有在你明确确认时才会发送给你配置的模型服务；浏览器端 API 密钥只保存在内存中，桌面端凭据使用操作系统安全存储。'],['可以接入哪些模型？','回复生成支持 OpenAI 兼容接口；单任务 Computer Use、持续回复和附件分析支持 Gemini 原生接口。你可以按自己的账号与服务地址填写，API 密钥不会写入导出的工作区文件。'],['这是什么版本？','这是 FlowDesk 0.7 测试版，Windows x64 便携版。Gemini 原生 Computer Use 已接入；真实模型、实体 Pico 与目标窗口仍待验收。它是一款独立实现的本地工作助手，不代表任何第三方产品。']].map(([q, a], i) => <div className={`faq-item ${faq === i ? 'open' : ''}`} key={q}><button onClick={() => setFaq(faq === i ? null : i)} aria-expanded={faq === i}><span>{q}</span><ChevronDown size={18} /></button>{faq === i && <p>{a}</p>}</div>)}</div></section>
    </main>
    <footer className="landing-footer"><Logo small /><p>FlowDesk 是独立实现的本地工作助手。<br />让人保留判断，让工具负责流动。</p><div><button onClick={() => setModal('privacy')}>隐私说明</button><span>·</span><span>© 2026 FlowDesk</span></div></footer>
    {modal === 'privacy' && <Modal title="隐私说明" subtitle="FlowDesk 0.7 测试版 · 独立实现" onClose={() => setModal(null)}><div className="modal-copy"><p>网页上的对话与流程图均为虚构内容，用于展示产品工作方式。桌面版截图仅在你明确确认时发送给所选模型服务，且不会由 FlowDesk 持久化。</p><p>浏览器端 API 密钥只保存在内存中；桌面端凭据使用操作系统安全存储。模型请求的具体处理范围取决于你配置的 OpenAI 兼容服务或 Gemini 原生服务。回复模式实验室的自动通道只运行虚构聊天；Windows 持续回复和单任务 Computer Use 需要匹配 Pico 与相应确认。</p><p className="modal-muted">这是一份产品边界说明，不构成第三方服务的隐私承诺。请在配置模型前阅读对应服务商的政策。</p></div></Modal>}
    {modal === 'demo' && <Modal title="流程演示" subtitle="虚构内容 · 仅用于说明工作方式" onClose={() => setModal(null)} wide><div className="demo-modal"><div className="demo-modal-window"><div className="mini-bar"><span /><span /><span /></div><div className="mini-chat"><div className="mini-in">可以周末送到吗？</div><div className="mini-out">可以的，我们支持周末配送。下单时可查看预计到达日期。</div></div></div><div className="demo-modal-copy"><span className="kicker">看 → 想 → 做</span><h3>你始终在回路里。</h3><p>FlowDesk 帮你整理信息和表达，最后的判断、修改与发送由你完成。</p><button className="modal-go" onClick={() => { setModal(null); navigate('app'); }}>进入工作台 <ArrowRight size={16} /></button></div></div></Modal>}
    {modal === 'download' && <Modal title="下载 Windows 便携版" subtitle="Windows 11 · x64 · 0.7 测试版" onClose={() => setModal(null)}><div className="download-modal">{downloadState === 'checking' && <p>正在检查本地下载包…</p>}{downloadState === 'desktop' && <><p>你正在 Windows 客户端中运行 FlowDesk。</p><button className="modal-go" onClick={() => { setModal(null); navigate('app'); }}>打开工作台 <ArrowRight size={16} /></button></>}{downloadState === 'ready' && <><p>Windows 测试包包含回复模式实验室、Gemini 原生 Computer Use 与持续回复界面。解压后可查看管理和烧录说明；Windows 自动与人工草稿操作都需连接匹配固件 Pico。真实模型与实体硬件仍待验收。</p><a className="modal-go" href="/downloads/windows">开始下载 <ArrowDownToLine size={16} /></a></>}{downloadState === 'missing' && <><p>当前环境尚未提供下载包。你可以在项目目录运行：</p><code>npm run package:win</code><small>打包完成后，重新打开此页面即可检查并下载。</small></>}</div></Modal>}
  </div>;
}
