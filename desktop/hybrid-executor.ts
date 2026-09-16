import { resolveExecutionChannel, type ChannelPolicy, type ExecutionChannel } from './hybrid-policy';
import type { WindowIdentity } from './workspace-manager';
import type { ComputerUseAction } from '../shared/computer-use';

export interface ExecutionResult {
  ok: boolean;
  channel: ExecutionChannel;
  action: ComputerUseAction;
  targetHwnd: string;
  durationMs: number;
  tokensSavedEstimate?: number;
  error?: string;
}

export interface GhostDriver {
  execute(action: ComputerUseAction, target: WindowIdentity): Promise<void>;
}

export interface FastDriver {
  execute(action: ComputerUseAction, target: WindowIdentity): Promise<void>;
}

/**
 * HybridExecutor dynamically routes actions between:
 * 1. Ghost Channel: Pico USB hardware HID + vision IME candidate verification (physical anti-ban).
 * 2. Fast Channel: Native high-speed input (50ms execution, zero vision token waste for safe office tools).
 */
export class HybridExecutor {
  constructor(
    private ghostDriver: GhostDriver,
    private fastDriver: FastDriver,
    private defaultPolicy: ChannelPolicy = 'auto',
  ) {}

  public async execute(
    target: WindowIdentity,
    action: ComputerUseAction,
    options?: { policy?: ChannelPolicy },
  ): Promise<ExecutionResult> {
    const policy = options?.policy ?? this.defaultPolicy;
    const decision = resolveExecutionChannel(target.process, policy);
    const start = performance.now();

    try {
      if (decision.channel === 'ghost') {
        await this.ghostDriver.execute(action, target);
        const durationMs = Math.round(performance.now() - start);
        return {
          ok: true,
          channel: 'ghost',
          action,
          targetHwnd: target.hwnd,
          durationMs,
        };
      } else {
        await this.fastDriver.execute(action, target);
        const durationMs = Math.round(performance.now() - start);
        // Estimate token savings for typing: VLM candidate recognition usually takes ~250-400 vision tokens per segment
        const tokensSaved = action.kind === 'type' ? Math.max(200, Math.round(action.text.length * 15)) : 0;
        return {
          ok: true,
          channel: 'fast',
          action,
          targetHwnd: target.hwnd,
          durationMs,
          tokensSavedEstimate: tokensSaved,
        };
      }
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      return {
        ok: false,
        channel: decision.channel,
        action,
        targetHwnd: target.hwnd,
        durationMs,
        error: (err as Error).message,
      };
    }
  }
}
