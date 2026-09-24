import React, { useState, useEffect } from 'react';
import { KeyRound, ShieldCheck, Copy, Check, X, Crown, AlertCircle } from 'lucide-react';
import type { LicenseStatus } from '../shared/types';
import { api, copyText } from './api';

interface LicenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onActivated?: (status: LicenseStatus) => void;
  initialLicense?: LicenseStatus | null;
}

export default function LicenseModal({
  isOpen,
  onClose,
  onActivated,
  initialLicense
}: LicenseModalProps) {
  const [license, setLicense] = useState<LicenseStatus | null>(initialLicense || null);
  const [keyInput, setKeyInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    if (isOpen) {
      setErrorMsg('');
      setSuccessMsg('');
      api<{ ok: boolean; status: LicenseStatus }>('GET', '/license/status')
        .then(res => {
          if (res && res.status) setLicense(res.status);
        })
        .catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCopyMachineId = async () => {
    if (!license?.machineId) return;
    try {
      await copyText(license.machineId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  const handleActivate = async () => {
    const cleanKey = keyInput.trim();
    if (!cleanKey) {
      setErrorMsg('请输入卡密');
      return;
    }
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await api<{ ok: boolean; status: LicenseStatus; message?: string }>(
        'POST',
        '/license/activate',
        { licenseKey: cleanKey }
      );
      if (res && res.status) {
        setLicense(res.status);
        setSuccessMsg(res.message || '🎉 激活成功！');
        setKeyInput('');
        onActivated?.(res.status);
      }
    } catch (err) {
      setErrorMsg((err as Error).message || '激活失败，卡密无效或已过期');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(15, 23, 42, 0.65)',
      backdropFilter: 'blur(4px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 99999,
      padding: 16
    }}>
      <div style={{
        background: '#ffffff',
        borderRadius: 16,
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        width: '100%',
        maxWidth: 440,
        overflow: 'hidden',
        border: '1px solid #e2e8f0',
        fontFamily: 'system-ui, -apple-system, sans-serif'
      }}>
        {/* Header */}
        <div style={{
          background: 'linear-gradient(135deg, #1e293b, #0f172a)',
          color: '#ffffff',
          padding: '18px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: 'linear-gradient(135deg, #f59e0b, #d97706)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Crown size={18} color="#fff" />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>软件授权与商业卡密</h3>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: '#94a3b8' }}>一机一码离线硬核加密 · 免注册账号</p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: 4,
              borderRadius: 6,
              display: 'flex'
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: 20 }}>
          {/* Current Status Badge */}
          <div style={{
            background: license?.licensed ? '#ecfdf5' : '#fef3c7',
            border: `1px solid ${license?.licensed ? '#a7f3d0' : '#fde68a'}`,
            borderRadius: 10,
            padding: '12px 14px',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {license?.licensed ? (
                <ShieldCheck size={20} color="#059669" />
              ) : (
                <AlertCircle size={20} color="#d97706" />
              )}
              <div>
                <div style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: license?.licensed ? '#065f46' : '#92400e'
                }}>
                  {license?.licensed ? '👑 正式商业授权版' : '🎁 免费体验试用版'}
                </div>
                <div style={{ fontSize: 11, color: license?.licensed ? '#047857' : '#b45309' }}>
                  {license?.licensed
                    ? `授权类型：${license.plan?.toUpperCase()} · 有效期至 ${license.expiry ? new Date(license.expiry).toLocaleDateString() : '永久'}`
                    : `试用额度：剩余 ${license?.trialRemaining ?? 0} 次（已用 ${license?.trialUsed ?? 0}/${license?.trialLimit ?? 20} 次）`}
                </div>
              </div>
            </div>
            {license?.licensed && (
              <span style={{
                background: '#10b981',
                color: '#fff',
                fontSize: 10,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 99
              }}>
                已激活
              </span>
            )}
          </div>

          {/* Machine ID Display */}
          <div style={{ marginBottom: 16 }}>
            <label style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 600,
              color: '#475569',
              marginBottom: 6
            }}>
              🖥️ 本机唯一机器码 (请发给客服换取卡密)
            </label>
            <div style={{
              display: 'flex',
              gap: 8,
              background: '#f8fafc',
              border: '1px solid #cbd5e1',
              borderRadius: 8,
              padding: '6px 10px',
              alignItems: 'center'
            }}>
              <code style={{
                flex: 1,
                fontSize: 13,
                fontWeight: 700,
                color: '#0f172a',
                letterSpacing: 0.5,
                fontFamily: 'Consolas, monospace'
              }}>
                {license?.machineId || '正在获取机器码...'}
              </code>
              <button
                onClick={handleCopyMachineId}
                disabled={!license?.machineId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  background: copied ? '#10b981' : '#2563eb',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '5px 10px',
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'background 0.2s'
                }}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? '已复制' : '复制机器码'}
              </button>
            </div>
          </div>

          {/* License Key Input */}
          <div style={{ marginBottom: 16 }}>
            <label style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 600,
              color: '#475569',
              marginBottom: 6
            }}>
              🔑 粘贴卡密 (以 FD1_ 开头)
            </label>
            <textarea
              rows={3}
              value={keyInput}
              onChange={e => setKeyInput(e.target.value)}
              placeholder="在此粘贴购买的授权卡密：FD1_..."
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid #cbd5e1',
                fontSize: 12,
                fontFamily: 'Consolas, monospace',
                resize: 'none',
                boxSizing: 'border-box'
              }}
            />
          </div>

          {errorMsg && (
            <div style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#b91c1c',
              fontSize: 12,
              padding: '8px 12px',
              borderRadius: 8,
              marginBottom: 14,
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}>
              <AlertCircle size={14} />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div style={{
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              color: '#15803d',
              fontSize: 12,
              padding: '8px 12px',
              borderRadius: 8,
              marginBottom: 14,
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}>
              <Check size={14} />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Activate Button */}
          <button
            onClick={handleActivate}
            disabled={loading || !keyInput.trim()}
            style={{
              width: '100%',
              background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '10px 0',
              fontSize: 14,
              fontWeight: 600,
              cursor: loading || !keyInput.trim() ? 'not-allowed' : 'pointer',
              opacity: loading || !keyInput.trim() ? 0.6 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              boxShadow: '0 4px 6px -1px rgba(37, 99, 235, 0.25)'
            }}
          >
            <KeyRound size={16} />
            <span>{loading ? '正在验证数字签名...' : '立即激活授权'}</span>
          </button>

          {/* Purchase Tip */}
          <div style={{
            marginTop: 16,
            paddingTop: 12,
            borderTop: '1px dashed #e2e8f0',
            textAlign: 'center',
            fontSize: 11,
            color: '#64748b',
            lineHeight: 1.5
          }}>
            💬 未购买卡密？点击上方复制机器码发给客服，支持月度/年度/永久买断授权。<br />
            硬件防封 · 纯本地隔离 · 商业售后保障
          </div>
        </div>
      </div>
    </div>
  );
}
