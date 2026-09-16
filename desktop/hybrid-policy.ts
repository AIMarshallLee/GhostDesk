export type ExecutionChannel = 'ghost' | 'fast';
export type ChannelPolicy = 'auto' | 'ghost' | 'fast';

/**
 * List of high-risk process names that enforce the Ghost Channel
 * (physical Pico USB HID + IME visual OCR typing) to prevent account bans.
 */
export const HIGH_RISK_PROCESSES = new Set([
  'wechat.exe',
  'weixin.exe',
  'wxwork.exe',
  'dingtalk.exe',
  'feishu.exe',
  'lark.exe',
  'aliworkbench.exe',
  'alipim.exe',
  'pinduoduo.exe',
  'douyin.exe',
  'douyinhuodong.exe',
  'xiaohongshu.exe',
  'alipay.exe',
  'jdworkbench.exe',
  'pop.exe',
  // macOS application processes
  'wechat',
  'weixin',
  'wxwork',
  'dingtalk',
  'feishu',
  'lark',
  'aliworkbench',
  'pinduoduo',
  'douyin',
  'xiaohongshu',
  'alipay',
  'tiktok',
]);

/**
 * List of safe, high-throughput office and productivity processes
 * that are eligible for the Fast Channel (instant native typing & automation).
 */
export const SAFE_OFFICE_PROCESSES = new Set([
  'excel.exe',
  'winword.exe',
  'powerpnt.exe',
  'wps.exe',
  'et.exe',
  'wpp.exe',
  'chrome.exe',
  'msedge.exe',
  'firefox.exe',
  'notepad.exe',
  'notepad++.exe',
  'explorer.exe',
  'code.exe',
  'calc.exe',
  'cmd.exe',
  'powershell.exe',
  'windowsterminal.exe',
  // macOS application processes
  'excel',
  'microsoft excel',
  'word',
  'microsoft word',
  'powerpoint',
  'microsoft powerpoint',
  'wps',
  'wps office',
  'chrome',
  'google chrome',
  'safari',
  'firefox',
  'notes',
  'textedit',
  'finder',
  'terminal',
  'iterm',
  'iterm2',
  'calculator',
]);

export interface PolicyDecision {
  channel: ExecutionChannel;
  reason: string;
  isHighRisk: boolean;
}

/**
 * Resolves whether an operation should execute via the Ghost Channel (Pico Hardware HID)
 * or the Fast Channel (direct high-speed injection). Supports both Windows (.exe) and macOS apps.
 *
 * @param processName The executable name of the target application (e.g. "wechat.exe" or "WeChat" on macOS)
 * @param userPolicy Optional user override policy ('auto' | 'ghost' | 'fast')
 */
export function resolveExecutionChannel(
  processName: string | undefined,
  userPolicy: ChannelPolicy = 'auto',
): PolicyDecision {
  const raw = (processName ?? '').trim().toLowerCase();
  const stripped = raw.replace(/\.exe$/i, '').replace(/\.app$/i, '');
  const isHighRisk = HIGH_RISK_PROCESSES.has(raw) || HIGH_RISK_PROCESSES.has(stripped);
  const normalized = raw;

  // User explicit override
  if (userPolicy === 'ghost') {
    return {
      channel: 'ghost',
      reason: 'User policy explicitly set to Ghost Channel (Physical Hardware HID).',
      isHighRisk,
    };
  }

  if (userPolicy === 'fast') {
    if (isHighRisk) {
      // Safety guard: even if user requested fast, warn or enforce ghost for dangerous targets
      // unless explicitly designated. In GhostDesk safety philosophy, high-risk targets default to ghost.
      return {
        channel: 'ghost',
        reason: `Target "${normalized}" is in high-risk list. Overriding to Ghost Channel for anti-ban safety.`,
        isHighRisk: true,
      };
    }
    return {
      channel: 'fast',
      reason: 'User policy set to Fast Channel (High-Speed Injection).',
      isHighRisk: false,
    };
  }

  // Automatic routing
  if (isHighRisk) {
    return {
      channel: 'ghost',
      reason: `Target "${normalized}" identified as high anti-bot risk. Routed to Ghost Channel (Physical Pico USB).`,
      isHighRisk: true,
    };
  }

  const isSafe = SAFE_OFFICE_PROCESSES.has(raw) || SAFE_OFFICE_PROCESSES.has(stripped);
  if (isSafe) {
    return {
      channel: 'fast',
      reason: `Target "${normalized}" identified as safe office/browser application. Routed to Fast Channel.`,
      isHighRisk: false,
    };
  }

  // Default unknown applications: default to Ghost Channel for maximum safety
  return {
    channel: 'ghost',
    reason: `Target "${normalized || 'unknown'}" is unclassified. Defaulting to Ghost Channel for fail-closed security.`,
    isHighRisk: false,
  };
}
