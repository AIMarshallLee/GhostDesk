import { useState } from 'react';
import {
  Bot,
  Play,
  Square,
  Shield,
  Zap,
  CheckCircle2,
  Clock,
  Terminal,
  Layers,
  ArrowRight,
  TrendingUp,
  Globe,
} from 'lucide-react';
import { Button } from './components';
import { BUILTIN_SKILL_ORDER_TO_EXCEL, type SkillDefinition } from '../desktop/skill-engine';
import './worker-studio.css';

export const ALL_STUDIO_SKILLS: SkillDefinition[] = [
  BUILTIN_SKILL_ORDER_TO_EXCEL,
  {
    id: 'skill_feishu_leave_approval',
    name: '飞书请假审批自动流转',
    description: '自动读取飞书工作台待办审批，比对考勤系统并执行自动化核准',
    version: '1.0.0',
    requiredProcesses: ['feishu.exe', 'chrome.exe'],
    steps: [
      {
        id: 'step_1',
        name: '打开飞书待办审批列表',
        targetProcess: 'feishu.exe',
        instruction: '点击飞书工作台【审批】进入待审批列表',
        expectedOutcome: '审批单列表加载完成',
        channelPreference: 'ghost',
      },
      {
        id: 'step_2',
        name: '提取审批单关键信息',
        targetProcess: 'feishu.exe',
        instruction: '提取申请人、事由与请假天数',
        expectedOutcome: '表单字段捕获完毕',
        channelPreference: 'ghost',
      },
      {
        id: 'step_3',
        name: '切换考勤系统核准额度',
        targetProcess: 'chrome.exe',
        instruction: '在 HR SaaS 中核验年假余额',
        expectedOutcome: '返回可用额度充足',
        channelPreference: 'fast',
      },
      {
        id: 'step_4',
        name: '飞书审批执行通过',
        targetProcess: 'feishu.exe',
        instruction: '点击【同意】并提交核准批语',
        expectedOutcome: '审批流转完成移出待办',
        channelPreference: 'ghost',
      },
    ],
  },
  {
    id: 'skill_tax_invoice_export',
    name: '增值税发票批量下载导出',
    description: '自动登录税务系统，批量下载发票版式并另存对账底表',
    version: '1.0.0',
    requiredProcesses: ['chrome.exe', 'excel.exe'],
    steps: [
      {
        id: 'step_1',
        name: '进入电子税务发票查询页',
        targetProcess: 'chrome.exe',
        instruction: '进入【发票查询及开具】表单',
        expectedOutcome: '查询表单已呈现',
        channelPreference: 'fast',
      },
      {
        id: 'step_2',
        name: '批量打包下载发票版式',
        targetProcess: 'chrome.exe',
        instruction: '全选当月开票并批量下载 PDF',
        expectedOutcome: '下载压缩包保存至本地',
        channelPreference: 'ghost',
      },
      {
        id: 'step_3',
        name: '导出对账清单并格式化 Excel',
        targetProcess: 'excel.exe',
        instruction: '在 Excel 中整理边框并按金额排序',
        expectedOutcome: '财务底稿完成并安全保存',
        channelPreference: 'fast',
      },
    ],
  },
  {
    id: 'skill_xiaohongshu_lead_capture',
    name: '小红书高意向线索归档',
    description: '巡检创作者后台私信，语义识别手机微信并推送销售群',
    version: '1.0.0',
    requiredProcesses: ['chrome.exe', 'wechat.exe'],
    steps: [
      {
        id: 'step_1',
        name: '巡检小红书未读私信',
        targetProcess: 'chrome.exe',
        instruction: '筛选创作者中心意向咨询',
        expectedOutcome: '最新会话列表已加载',
        channelPreference: 'fast',
      },
      {
        id: 'step_2',
        name: '语义捕获联系方式',
        targetProcess: 'chrome.exe',
        instruction: '提取 11 位手机号与微信 ID',
        expectedOutcome: '成功截获意向联系人',
        channelPreference: 'ghost',
      },
      {
        id: 'step_3',
        name: '微信销售群实时通报',
        targetProcess: 'wechat.exe',
        instruction: '通过硬件防封通道粘贴线索卡片并回车发送',
        expectedOutcome: '销售群成功接收新线索',
        channelPreference: 'ghost',
      },
    ],
  },
];

const TRANSLATIONS = {
  zh: {
    title: '数字员工工作台 (AI Worker Studio)',
    subtitle: '基于硬件防封外设与混合快慢通道的 Windows & macOS 数字员工自主调度中心',
    toggleBtn: '🇨🇳 中文 / 🇺🇸 EN',
    dispatch: '派遣员工上班',
    recall: '召回员工',
    registryTitle: '岗位业务技能工坊 (Skill Registry)',
    whitelist: '受控应用白名单:',
    stepsTitle: 'SOP 规划步骤:',
    fastChannel: '⚡ Fast 快通道 (50ms 原生录入)',
    ghostChannel: '👻 Ghost 慢通道 (Pico 硬件防封全拼)',
    dashboardTitle: '员工上班运行态 (Worker Live Dashboard)',
    statusLabel: '当前状态:',
    statusRunning: '正在自主执行',
    statusCompleted: '任务已圆满完成',
    statusIdle: '就绪待命',
    statAntiBan: '硬件防封: 正常',
    statSavedTokens: '累计节省 Token:',
    logTitle: '实时运行日志 (Live Activity Log)',
    stepsCount: '步骤',
    hybridTag: '双通道混合',
    systemReady: '[System] GhostDesk AI 员工底座已就绪。',
    hardwareReady: '[System] Pico USB 物理硬件在环已就位，混合通道已启用。',
    switchedSkill: '[System] 已切换岗位业务技能: ',
    dispatching: '[Dispatch] 派遣数字员工执行技能: ',
    stepStart: '开始: ',
    channelRouting: '[Channel] 策略路由 -> ',
    taskDone: '[Completed] 员工已圆满完成全部 SOP 步骤并完成核对！',
    stopped: '[System] 员工已被操作员安全停止。',
  },
  en: {
    title: 'AI Worker Studio',
    subtitle: 'Hardware-in-the-Loop & Hybrid Policy Autonomous AI Employee Substrate for Windows & macOS',
    toggleBtn: '🇺🇸 EN / 🇨🇳 中文',
    dispatch: 'Dispatch Worker',
    recall: 'Recall Worker',
    registryTitle: 'Skill Registry',
    whitelist: 'Allowed Apps Whitelist:',
    stepsTitle: 'SOP Planned Steps:',
    fastChannel: '⚡ Fast Channel (50ms Native Entry)',
    ghostChannel: '👻 Ghost Channel (Pico Hardware HID Pinyin)',
    dashboardTitle: 'Worker Live Dashboard',
    statusLabel: 'Status:',
    statusRunning: 'Autonomously Running',
    statusCompleted: 'Task Completed Successfully',
    statusIdle: 'Idle & Ready',
    statAntiBan: 'Hardware Anti-Ban: Active',
    statSavedTokens: 'Tokens Saved:',
    logTitle: 'Live Activity Log',
    stepsCount: 'steps',
    hybridTag: 'Hybrid Channel',
    systemReady: '[System] GhostDesk AI Employee Substrate ready.',
    hardwareReady: '[System] Pico USB HITL active, hybrid routing enabled.',
    switchedSkill: '[System] Switched to skill: ',
    dispatching: '[Dispatch] Dispatching digital worker for skill: ',
    stepStart: 'Starting: ',
    channelRouting: '[Channel] Policy routing -> ',
    taskDone: '[Completed] Worker has completed all SOP steps successfully!',
    stopped: '[System] Worker has been safely stopped by operator.',
  },
};

export default function WorkerStudio() {
  const [lang, setLang] = useState<'zh' | 'en'>('zh');
  const t = TRANSLATIONS[lang];
  const [selectedSkill, setSelectedSkill] = useState<SkillDefinition>(ALL_STUDIO_SKILLS[0]);
  const [workerStatus, setWorkerStatus] = useState<'idle' | 'running' | 'completed' | 'paused'>('idle');
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [savedTokens, setSavedTokens] = useState(0);
  const [logs, setLogs] = useState<string[]>([
    TRANSLATIONS.zh.systemReady,
    TRANSLATIONS.zh.hardwareReady,
  ]);

  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev.slice(-30), `[${time}] ${msg}`]);
  };

  const switchSkill = (skill: SkillDefinition) => {
    if (workerStatus === 'running') return;
    setSelectedSkill(skill);
    setWorkerStatus('idle');
    setCurrentStepIndex(0);
    setProgress(0);
    setSavedTokens(0);
    addLog(`${t.switchedSkill}${skill.name}`);
  };

  const startWorker = async () => {
    if (workerStatus === 'running') return;
    setWorkerStatus('running');
    setCurrentStepIndex(0);
    setProgress(0);
    setSavedTokens(0);
    addLog(`${t.dispatching}${selectedSkill.name}`);

    for (let i = 0; i < selectedSkill.steps.length; i++) {
      const step = selectedSkill.steps[i];
      setCurrentStepIndex(i);
      const isFast = step.channelPreference === 'fast';
      const channelLabel = isFast ? t.fastChannel : t.ghostChannel;
      addLog(`[Step ${i + 1}/${selectedSkill.steps.length}] ${t.stepStart}${step.name}`);
      addLog(`${t.channelRouting}${channelLabel}`);

      if (isFast) {
        setSavedTokens((prev) => prev + 350);
      }

      await new Promise((resolve) => setTimeout(resolve, 1500));
      setProgress(Math.round(((i + 1) / selectedSkill.steps.length) * 100));
    }

    setWorkerStatus('completed');
    addLog(t.taskDone);
  };

  const stopWorker = () => {
    setWorkerStatus('idle');
    addLog(t.stopped);
  };

  return (
    <div className="worker-studio">
      <div className="worker-header">
        <div>
          <h1>
            <Bot size={26} color="#2563eb" />
            {t.title}
          </h1>
          <p>{t.subtitle}</p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <Button
            onClick={() => setLang((prev) => (prev === 'zh' ? 'en' : 'zh'))}
            variant="secondary"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}
          >
            <Globe size={15} /> {t.toggleBtn}
          </Button>
          {workerStatus !== 'running' ? (
            <Button onClick={startWorker} variant="primary">
              <Play size={16} /> {t.dispatch}
            </Button>
          ) : (
            <Button onClick={stopWorker} variant="secondary">
              <Square size={16} /> {t.recall}
            </Button>
          )}
        </div>
      </div>

      <div className="worker-grid">
        {/* 左侧：技能选择与受控工作空间 */}
        <div className="studio-card">
          <h2>
            <Layers size={18} /> {t.registryTitle}
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
            {ALL_STUDIO_SKILLS.map((skill) => {
              const isCur = skill.id === selectedSkill.id;
              return (
                <div
                  key={skill.id}
                  onClick={() => switchSkill(skill)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: isCur ? '2px solid #2563eb' : '1px solid #e2e8f0',
                    background: isCur ? '#eff6ff' : '#f8fafc',
                    cursor: workerStatus === 'running' ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: '13px', color: isCur ? '#1d4ed8' : '#334155' }}>
                    {skill.name}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                    {skill.steps.length} {t.stepsCount} · {skill.requiredProcesses.join(', ')}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="skill-selector">
            <div className="skill-card is-selected">
              <div className="skill-card-top">
                <h3>{selectedSkill.name}</h3>
                <span className="channel-tag ghost">{t.hybridTag}</span>
              </div>
              <p className="skill-desc">{selectedSkill.description}</p>
              <div className="skill-reqs">
                <span style={{ fontSize: '11px', color: '#64748b' }}>{t.whitelist}</span>
                {selectedSkill.requiredProcesses.map((proc) => (
                  <span key={proc} className="proc-badge">
                    {proc}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div style={{ marginTop: '10px' }}>
            <h3 style={{ fontSize: '14px', margin: '0 0 8px', color: '#475569' }}>{t.stepsTitle}</h3>
            <div className="subgoal-list">
              {selectedSkill.steps.map((step, idx) => {
                const isActive = workerStatus === 'running' && currentStepIndex === idx;
                const isDone = workerStatus === 'completed' || (workerStatus === 'running' && currentStepIndex > idx);
                return (
                  <div
                    key={step.id}
                    className={`subgoal-item ${isActive ? 'active' : ''} ${isDone ? 'completed' : ''}`}
                  >
                    {isDone ? (
                      <CheckCircle2 size={16} color="#16a34a" />
                    ) : isActive ? (
                      <Clock size={16} color="#2563eb" />
                    ) : (
                      <ArrowRight size={16} color="#94a3b8" />
                    )}
                    <div style={{ flex: 1 }}>
                      <strong>{step.name}</strong>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>
                        {step.targetProcess} · {step.channelPreference === 'fast' ? t.fastChannel : t.ghostChannel}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* 右侧：实时监控与运行指标 */}
        <div className="studio-card">
          <h2>
            <TrendingUp size={18} /> {t.dashboardTitle}
          </h2>

          <div className="progress-banner">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>
                {t.statusLabel}{' '}
                <strong>
                  {workerStatus === 'running'
                    ? t.statusRunning
                    : workerStatus === 'completed'
                      ? t.statusCompleted
                      : t.statusIdle}
                </strong>
              </span>
              <span>{progress}%</span>
            </div>
            <div className="progress-bar-bg">
              <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
            </div>
            <div style={{ display: 'flex', gap: '16px', fontSize: '12px', marginTop: '4px' }}>
              <span className="stat-pill">
                <Shield size={13} color="#dc2626" /> {t.statAntiBan}
              </span>
              <span className="stat-pill">
                <Zap size={13} color="#059669" /> {t.statSavedTokens} ~{savedTokens}
              </span>
            </div>
          </div>

          <div>
            <h3 style={{ fontSize: '13px', margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Terminal size={14} /> {t.logTitle}
            </h3>
            <div className="log-terminal">
              {logs.map((line, idx) => (
                <div key={idx}>{line}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
