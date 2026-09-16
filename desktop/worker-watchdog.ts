export interface WatchdogAlert {
  timestamp: string;
  reason: string;
  actionTaken: string;
}

export type WatchdogTimeoutAction = 'abort' | 'retry' | 'alert_only';

export interface WatchdogOptions {
  timeoutMs?: number;
  onTimeout: (reason: string) => Promise<void> | void;
}

/**
 * WorkerWatchdog provides resilience for headless / autonomous operation.
 * Prevents the AI worker from freezing indefinitely if a network request hangs
 * or an application becomes unresponsive.
 */
export class WorkerWatchdog {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private timeoutMs: number;
  private isArmed = false;
  private alerts: WatchdogAlert[] = [];
  private lastHeartbeat = Date.now();

  constructor(private options: WatchdogOptions) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  /**
   * Arms the watchdog timer for an operation.
   */
  public arm(customTimeoutMs?: number): void {
    this.disarm();
    this.isArmed = true;
    this.lastHeartbeat = Date.now();
    const ms = customTimeoutMs ?? this.timeoutMs;

    this.timer = setTimeout(() => {
      if (this.isArmed) {
        const reason = `Watchdog timeout: Worker step exceeded deadline (${ms}ms) without heartbeat.`;
        this.recordAlert(reason, 'Invoked timeout handler to abort / recover.');
        void this.options.onTimeout(reason);
      }
    }, ms);
  }

  /**
   * Disarms the watchdog when operation completes.
   */
  public disarm(): void {
    this.isArmed = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Progress heartbeat: resets the timeout counter.
   */
  public heartbeat(): void {
    if (this.isArmed) {
      this.arm();
    }
  }

  public getAlerts(): readonly WatchdogAlert[] {
    return this.alerts;
  }

  public isRunning(): boolean {
    return this.isArmed;
  }

  private recordAlert(reason: string, actionTaken: string): void {
    this.alerts.push({
      timestamp: new Date().toISOString(),
      reason,
      actionTaken,
    });
    if (this.alerts.length > 50) {
      this.alerts.shift();
    }
  }
}
