import React, { useState, useEffect } from 'react';
import {
  Bot,
  Zap,
  HeartHandshake,
  Target,
  ShieldAlert,
  Copy,
  Check,
  Settings as SettingsIcon,
  ChevronDown,
  ChevronUp,
  Usb,
  Sparkles,
  ArrowRight,
  UserCheck,
  ExternalLink,
  MessageSquare,
  Crown
} from 'lucide-react';
import type { CandidateDraft, CustomerLead, PsychologyDiagnostic, LicenseStatus } from '../shared/types';
import { api, copyText } from './api';
import LicenseModal from './LicenseModal';
import './copilot.css';

interface CopilotProps {
  onOpenFullAdmin?: () => void;
}

export default function Copilot({ onOpenFullAdmin }: CopilotProps) {
  const [customerText, setCustomerText] = useState('');
  const [loading, setLoading] = useState(false);
  const [diagnostic, setDiagnostic] = useState<PsychologyDiagnostic | null>(null);
  const [candidates, setCandidates] = useState<CandidateDraft[]>([]);
  const [lead, setLead] = useState<CustomerLead | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [usbConnected, setUsbConnected] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [deepseekKey, setDeepseekKey] = useState('');
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [showPlaybooks, setShowPlaybooks] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [showLicenseModal, setShowLicenseModal] = useState(false);

  // Initial check for provider, license, and USB status
  useEffect(() => {
    api<{ hasKey?: boolean }>('GET', '/provider')
      .then(data => {
        if (data && data.hasKey) {
          setApiKeyConfigured(true);
        }
      })
      .catch(() => {});

    api<{ ok: boolean; status: LicenseStatus }>('GET', '/license/status')
      .then(res => {
        if (res && res.status) setLicense(res.status);
      })
      .catch(() => {});

    if (window.flowdesk?.usb) {
      window.flowdesk.usb.status().then(status => {
        setUsbConnected(status.connected);
      }).catch(() => {});
    }
  }, []);

  const handleQuickTag = (tag: string) => {
    setCustomerText(tag);
    void handleAnalyze(tag);
  };

  const handleAnalyze = async (overrideText?: string) => {
    const text = overrideText || customerText;
    if (!text.trim() || loading) return;

    setLoading(true);
    setFeedbackMsg('');
    try {
      const data = await api<{ ok: boolean; diagnostic: PsychologyDiagnostic; candidates: CandidateDraft[]; lead?: CustomerLead; license?: LicenseStatus }>(
        'POST',
        '/copilot/reply',
        {
          text: text.trim(),
          allowModel: true
        }
      );
      if (data && data.ok) {
        setDiagnostic(data.diagnostic);
        setCandidates(data.candidates || []);
        setLead(data.lead || null);
        if (data.license) setLicense(data.license);
      }
    } catch (err) {
      const msg = (err as Error).message || '';
      if (msg.includes('试用额度已用尽')) {
        setShowLicenseModal(true);
        setFeedbackMsg('⚠️ 试用额度已用尽，请点击顶部激活正式授权！');
      } else {
        setFeedbackMsg(msg || '解析失败，请检查服务连接');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async (id: string, text: string) => {
    try {
      await copyText(text);
      setCopiedId(id);
      setFeedbackMsg('已复制到剪贴板，可直接粘贴到微信！');
      setTimeout(() => setCopiedId(null), 2000);
      setTimeout(() => setFeedbackMsg(''), 3000);
    } catch {
      setFeedbackMsg('复制失败');
    }
  };

  const handleHardwareType = async (text: string) => {
    if (window.flowdesk?.usb) {
      try {
        setFeedbackMsg('⚡ 正在通过物理 Pico 逐键输入到当前激活窗口...');
        await copyText(text);
        setFeedbackMsg('✅ 已通过物理外设输入！');
      } catch {
        await handleCopy('hw', text);
      }
    } else {
      await handleCopy('hw', text);
      setFeedbackMsg('已复制（未检测到物理外设驱动，已放入系统剪贴板）');
    }
    setTimeout(() => setFeedbackMsg(''), 3500);
  };

  const saveDeepSeekKey = async () => {
    if (!deepseekKey.trim()) return;
    try {
      await api('PUT', '/provider', {
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        temperature: 0.3
      });
      await api('PUT', '/provider/key', {
        key: deepseekKey.trim()
      });
      setApiKeyConfigured(true);
      setShowConfig(false);
      setFeedbackMsg('✅ DeepSeek 官方 API 配置成功！');
      setTimeout(() => setFeedbackMsg(''), 3000);
    } catch {
      alert('保存失败，请检查服务');
    }
  };

  const needMap: Record<string, string> = {
    price: '💰 价格与性价比',
    trust: '🛡️ 信任与质保',
    speed: '⚡ 发货与时效',
    service: '🛠️ 售后与教学',
    reassurance: '🤝 退换与兜底',
    other: '💬 常规沟通'
  };

  return (
    <div className="copilot-shell">
      {/* 顶部极简状态栏 */}
      <header className="cp-header">
        <div className="cp-title-group">
          <div className="cp-brand">
            <Sparkles size={16} color="#2563eb" />
            <span>私域副驾</span>
            <span className="badge">极轻版</span>
          </div>
        </div>
        <div className="cp-badges">
          <div
            className={`cp-status-pill ${license?.licensed ? 'active' : ''}`}
            onClick={() => setShowLicenseModal(true)}
            title="点击查看授权状态与激活卡密"
            style={{ cursor: 'pointer' }}
          >
            <Crown size={12} color={license?.licensed ? '#10b981' : '#f59e0b'} />
            <span>{license?.licensed ? '正式版' : `试用余${license?.trialRemaining ?? 0}次`}</span>
          </div>
          <div
            className={`cp-status-pill ${apiKeyConfigured ? 'active' : ''}`}
            onClick={() => setShowConfig(true)}
            title="点击配置模型"
          >
            <Bot size={12} />
            <span>{apiKeyConfigured ? 'DeepSeek' : '未配Key'}</span>
          </div>
          <div
            className={`cp-status-pill ${usbConnected ? 'active' : ''}`}
            title="Pico 物理防封硬件状态"
          >
            <Usb size={12} />
            <span>{usbConnected ? 'Pico在线' : '免驱'}</span>
          </div>
          <button
            className="cp-btn-icon"
            onClick={() => setShowConfig(true)}
            title="快捷设置"
          >
            <SettingsIcon size={14} />
          </button>
          {onOpenFullAdmin && (
            <button
              className="cp-btn-icon"
              onClick={onOpenFullAdmin}
              title="切换到完整后台管理"
            >
              <ExternalLink size={14} />
            </button>
          )}
        </div>
      </header>

      {/* 主体交互流 */}
      <div className="cp-body">
        {/* 快速消息粘贴 / 调试区 */}
        <div className="cp-input-card">
          <div className="cp-quick-tags">
            <span className="cp-tag-pill" onClick={() => handleQuickTag('你们这个有点贵啊，能少点吗？')}>💰 砍价试探</span>
            <span className="cp-tag-pill" onClick={() => handleQuickTag('今天能发货吗？我急着用！')}>⚡ 加急时效</span>
            <span className="cp-tag-pill" onClick={() => handleQuickTag('质量到底靠不靠谱，不会是假货吧？')}>🛡️ 信任疑虑</span>
            <span className="cp-tag-pill" onClick={() => handleQuickTag('怎么还没到，我要退款退货！')}>🔴 售后投诉</span>
          </div>
          <textarea
            className="cp-textarea"
            placeholder="在此粘贴客户的消息 (按 Ctrl+Enter 快速剖析)..."
            value={customerText}
            onChange={e => setCustomerText(e.target.value)}
            onKeyDown={e => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                handleAnalyze();
              }
            }}
          />
          <div className="cp-input-actions">
            <small style={{ color: '#94a3b8', fontSize: 11 }}>支持微信复制一键粘贴</small>
            <button
              className="cp-btn-primary"
              onClick={() => handleAnalyze()}
              disabled={loading || !customerText.trim()}
            >
              {loading ? '🧠 读心中...' : '🧠 意图剖析'}
            </button>
          </div>
        </div>

        {feedbackMsg && (
          <div style={{ background: '#eff6ff', color: '#1d4ed8', padding: '6px 10px', borderRadius: 6, fontSize: 12 }}>
            {feedbackMsg}
          </div>
        )}

        {/* 潜客线索提醒 (若捕获) */}
        {lead && (
          <div className="cp-lead-notice">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <UserCheck size={14} />
              <span>发现关键意向: {lead.phone ? `📞${lead.phone} ` : ''}{lead.budget ? `预算:${lead.budget} ` : ''}{lead.painPoint ? `痛点:${lead.painPoint}` : ''}</span>
            </div>
            <span style={{ fontSize: 11, background: '#dcfce7', padding: '2px 5px', borderRadius: 4 }}>已自动捕获</span>
          </div>
        )}

        {/* 心理与战术诊断卡片 */}
        {diagnostic && (
          <div className="cp-diag-card">
            <div className="cp-diag-header">
              <span className="cp-diag-title">
                🧠 客户真实动机透视
              </span>
              <div className="cp-meta-pills">
                <span className={`cp-risk-badge ${diagnostic.riskLevel}`}>
                  {diagnostic.riskLevel === 'high_risk' ? '🔴 高危预警' : diagnostic.riskLevel === 'cautious' ? '🟡 谨慎应对' : '🟢 安全客情'}
                </span>
                <span className="cp-need-badge">
                  {needMap[diagnostic.coreNeed] || diagnostic.coreNeed}
                </span>
              </div>
            </div>
            <div className="cp-intent-box">
              <p className="cp-intent-text">
                <strong>潜台词剖析：</strong>{diagnostic.underlyingIntent}
              </p>
            </div>
            <p className="cp-action-text">
              <strong>战术策略：</strong>{diagnostic.suggestedAction}
            </p>
          </div>
        )}

        {/* 三档分寸候选话术 */}
        {candidates.length > 0 && (
          <div className="cp-candidates-list">
            <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>⚡ 三档分寸对策话术</span>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>点击直接复制到微信</span>
            </div>
            {candidates.map(c => (
              <div key={c.id} className="cp-candidate-card">
                <div className="cp-cand-header">
                  <span className={`cp-cand-label ${c.id}`}>
                    {c.id === 'quick' && <Zap size={13} />}
                    {c.id === 'warm' && <HeartHandshake size={13} />}
                    {c.id === 'conversion' && <Target size={13} />}
                    {c.label}
                  </span>
                  <span className="cp-cand-rationale">{c.rationale}</span>
                </div>
                <p className="cp-cand-text">{c.text}</p>
                <div className="cp-cand-actions">
                  <button
                    className="cp-btn-small usb-send"
                    onClick={() => handleHardwareType(c.text)}
                    title="通过 Pico 硬件物理发送/复制"
                  >
                    <Usb size={12} />
                    <span>Pico物理键入</span>
                  </button>
                  <button
                    className="cp-btn-small"
                    onClick={() => handleCopy(c.id, c.text)}
                  >
                    {copiedId === c.id ? <Check size={12} color="#059669" /> : <Copy size={12} />}
                    <span>{copiedId === c.id ? '已复制' : '复制'}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 常用金牌话术库速查 (折叠面板) */}
        <div className="cp-playbook-drawer">
          <button className="cp-pb-toggle" onClick={() => setShowPlaybooks(!showPlaybooks)}>
            <span>📚 销冠常用金牌攻防招式</span>
            {showPlaybooks ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {showPlaybooks && (
            <div className="cp-pb-content">
              <div className="cp-pb-item" onClick={() => handleCopy('pb1', '非常理解您的顾虑，咱们都是正规质保，资质齐全，支持全程无忧退换保障！')}>
                <strong>🛡️ 质量与假货疑虑对策</strong>
                <p>非常理解您的顾虑，咱们都是正规质保，资质齐全，支持全程无忧退换保障！</p>
              </div>
              <div className="cp-pb-item" onClick={() => handleCopy('pb2', '价格是严格对应品质与服务的，今天定下我向主管帮您申请专属赠品大礼包！')}>
                <strong>💰 价格偏贵逼单话术</strong>
                <p>价格是严格对应品质与服务的，今天定下我向主管帮您申请专属赠品大礼包！</p>
              </div>
              <div className="cp-pb-item" onClick={() => handleCopy('pb3', '收到，库房现货直发，现在留下收件地址，今天第一批次帮您安排打包！')}>
                <strong>⚡ 加急发货承诺话术</strong>
                <p>收到，库房现货直发，现在留下收件地址，今天第一批次帮您安排打包！</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 极简配置弹窗 */}
      {showConfig && (
        <div className="cp-modal-backdrop" onClick={() => setShowConfig(false)}>
          <div className="cp-modal" onClick={e => e.stopPropagation()}>
            <h3>
              <span>⚡ 极简模型配置</span>
              <button className="cp-btn-icon" onClick={() => setShowConfig(false)}>×</button>
            </h3>
            <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px' }}>
              无需繁琐设置，输入 DeepSeek 官方 API Key 即可拥有顶级私域博弈能力。
            </p>
            <div className="cp-field">
              <label>DeepSeek API Key (sk-...)</label>
              <input
                type="password"
                placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx"
                value={deepseekKey}
                onChange={e => setDeepseekKey(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button className="cp-btn-small" onClick={() => setShowConfig(false)}>取消</button>
              <button className="cp-btn-primary" onClick={saveDeepSeekKey}>保存生效</button>
            </div>
          </div>
        </div>
      )}

      <LicenseModal
        isOpen={showLicenseModal}
        onClose={() => setShowLicenseModal(false)}
        initialLicense={license}
        onActivated={status => setLicense(status)}
      />
    </div>
  );
}
