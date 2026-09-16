import { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { Button } from './components';
import { BUILTIN_SKILL_ORDER_TO_EXCEL, type SkillDefinition } from '../desktop/skill-engine';
import './worker-studio.css';

export default function WorkerStudio() {
  const [selectedSkill, setSelectedSkill] = useState<SkillDefinition>(BUILTIN_SKILL_ORDER_TO_EXCEL);
  const [workerStatus, setWorkerStatus] = useState<'idle' | 'running' | 'completed' | 'paused'>('idle');
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [savedTokens, setSavedTokens] = useState(0);
  const [logs, setLogs] = useState<string[]>([
    '[System] GhostDesk AI 员工底座已就绪。',
    '[System] Pico USB 物理硬件在环已就位，混合通道已启用。',
  ]);

  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev.slice(-30), `[${time}] ${msg}`]);
  };

  const startWorker = async () => {
    if (workerStatus === 'running') return;
    setWorkerStatus('running');
    setCurrentStepIndex(0);
    setProgress(0);
    setSavedTokens(0);
    addLog(`[Dispatch] 派遣数字员工执行技能: ${selectedSkill.name}`);

    for (let i = 0; i < selectedSkill.steps.length; i++) {
      const step = selectedSkill.steps[i];
      setCurrentStepIndex(i);
      const isFast = step.channelPreference === 'fast';
      const channelLabel = isFast ? '⚡ Fast 快通道 (50ms 原生录入)' : '👻 Ghost 慢通道 (Pico 硬件防封全拼)';
      addLog(`[Step ${i + 1}/${selectedSkill.steps.length}] 开始: ${step.name}`);
      addLog(`[Channel] 策略路由 -> ${channelLabel}`);

      if (isFast) {
        setSavedTokens((prev) => prev + 350);
      }

      await new Promise((resolve) => setTimeout(resolve, 1500));
      setProgress(Math.round(((i + 1) / selectedSkill.steps.length) * 100));
    }

    setWorkerStatus('completed');
    addLog('[Completed] 员工已圆满完成全部 SOP 步骤并完成核对！');
  };

  const stopWorker = () => {
    setWorkerStatus('idle');
    addLog('[System] 员工已被操作员安全停止。');
  };

  return (
    <div className="worker-studio">
      <div className="worker-header">
        <div>
          <h1>
            <Bot size={26} color="#2563eb" />
            数字员工工作台 (AI Worker Studio)
          </h1>
          <p>基于硬件防封外设与混合快慢通道的 Windows 数字员工自主调度中心</p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          {workerStatus !== 'running' ? (
            <Button onClick={startWorker} variant="primary">
              <Play size={16} /> 派遣员工上班
            </Button>
          ) : (
            <Button onClick={stopWorker} variant="secondary">
              <Square size={16} /> 召回员工
            </Button>
          )}
        </div>
      </div>

      <div className="worker-grid">
        {/* 左侧：技能选择与受控工作空间 */}
        <div className="studio-card">
          <h2>
            <Layers size={18} /> 岗位业务技能 (Skill Registry)
          </h2>
          <div className="skill-selector">
            <div className={`skill-card is-selected`}>
              <div className="skill-card-top">
                <h3>{selectedSkill.name}</h3>
                <span className="channel-tag ghost">双通道混合</span>
              </div>
              <p className="skill-desc">{selectedSkill.description}</p>
              <div className="skill-reqs">
                <span style={{ fontSize: '11px', color: '#64748b' }}>受控应用白名单:</span>
                {selectedSkill.requiredProcesses.map((proc) => (
                  <span key={proc} className="proc-badge">
                    {proc}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div style={{ marginTop: '10px' }}>
            <h3 style={{ fontSize: '14px', margin: '0 0 8px', color: '#475569' }}>SOP 规划步骤:</h3>
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
                        {step.targetProcess} · {step.channelPreference === 'fast' ? 'Fast 快通道' : 'Ghost 硬件通道'}
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
            <TrendingUp size={18} /> 员工上班运行态 (Worker Live Dashboard)
          </h2>

          <div className="progress-banner">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>
                当前状态:{' '}
                <strong>
                  {workerStatus === 'running'
                    ? '正在自主执行'
                    : workerStatus === 'completed'
                      ? '任务已圆满完成'
                      : '就绪待命'}
                </strong>
              </span>
              <span>{progress}%</span>
            </div>
            <div className="progress-bar-bg">
              <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
            </div>
            <div style={{ display: 'flex', gap: '16px', fontSize: '12px', marginTop: '4px' }}>
              <span className="stat-pill">
                <Shield size={13} color="#dc2626" /> 硬件防封: 正常
              </span>
              <span className="stat-pill">
                <Zap size={13} color="#059669" /> 累计节省 Token: ~{savedTokens}
              </span>
            </div>
          </div>

          <div>
            <h3 style={{ fontSize: '13px', margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Terminal size={14} /> 实时运行日志 (Live Activity Log)
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
