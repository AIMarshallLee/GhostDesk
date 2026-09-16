import fs from 'node:fs';
import path from 'node:path';

export type TriggerType = 'interval' | 'file_watcher';

export interface BaseTriggerConfig {
  id: string;
  name: string;
  skillId: string;
  enabled: boolean;
  type: TriggerType;
}

export interface IntervalTriggerConfig extends BaseTriggerConfig {
  type: 'interval';
  intervalSeconds: number;
}

export interface FileWatcherTriggerConfig extends BaseTriggerConfig {
  type: 'file_watcher';
  watchDirectory: string;
  filePattern?: string; // e.g. ".(xlsx|csv)$"
}

export type TriggerConfig = IntervalTriggerConfig | FileWatcherTriggerConfig;

export interface TriggerExecutionRecord {
  triggerId: string;
  skillId: string;
  triggeredAt: string;
  eventDetails: string;
}

export type TriggerHandler = (trigger: TriggerConfig, details: string) => Promise<void>;

/**
 * WorkerTriggerManager allows AI employees to run autonomously
 * based on periodic intervals (e.g. polling WeChat every 30s)
 * or file events (e.g. new invoice dropped into a folder).
 */
export class WorkerTriggerManager {
  private triggers = new Map<string, TriggerConfig>();
  private activeIntervalTimers = new Map<string, ReturnType<typeof setInterval>>();
  private activeWatchers = new Map<string, fs.FSWatcher>();
  private executionHistory: TriggerExecutionRecord[] = [];
  private isProcessing = false;

  constructor(private onTrigger: TriggerHandler) {}

  public register(config: TriggerConfig): void {
    this.triggers.set(config.id, structuredClone(config));
    if (config.enabled) {
      this.startTrigger(config.id);
    }
  }

  public unregister(id: string): void {
    this.stopTrigger(id);
    this.triggers.delete(id);
  }

  public get(id: string): TriggerConfig | undefined {
    return this.triggers.get(id);
  }

  public list(): TriggerConfig[] {
    return Array.from(this.triggers.values());
  }

  public setEnabled(id: string, enabled: boolean): void {
    const config = this.triggers.get(id);
    if (!config) throw new Error(`Trigger ${id} not found`);
    config.enabled = enabled;
    if (enabled) {
      this.startTrigger(id);
    } else {
      this.stopTrigger(id);
    }
  }

  public startTrigger(id: string): void {
    const config = this.triggers.get(id);
    if (!config) return;

    // Stop existing instance if any
    this.stopTrigger(id);

    if (config.type === 'interval') {
      const intervalMs = Math.max(2_000, config.intervalSeconds * 1000);
      const timer = setInterval(() => {
        void this.fire(config, `Periodic interval timer fired (${config.intervalSeconds}s).`);
      }, intervalMs);
      this.activeIntervalTimers.set(id, timer);
    } else if (config.type === 'file_watcher') {
      if (fs.existsSync(config.watchDirectory)) {
        try {
          const watcher = fs.watch(config.watchDirectory, (eventType, filename) => {
            if (filename && eventType === 'rename') {
              const fullPath = path.join(config.watchDirectory, filename);
              if (fs.existsSync(fullPath)) {
                if (!config.filePattern || new RegExp(config.filePattern, 'i').test(filename)) {
                  void this.fire(config, `Detected new file: ${filename}`);
                }
              }
            }
          });
          this.activeWatchers.set(id, watcher);
        } catch {
          // Failed to attach watcher
        }
      }
    }
  }

  public stopTrigger(id: string): void {
    const timer = this.activeIntervalTimers.get(id);
    if (timer) {
      clearInterval(timer);
      this.activeIntervalTimers.delete(id);
    }

    const watcher = this.activeWatchers.get(id);
    if (watcher) {
      try {
        watcher.close();
      } catch {}
      this.activeWatchers.delete(id);
    }
  }

  public stopAll(): void {
    for (const id of this.triggers.keys()) {
      this.stopTrigger(id);
    }
  }

  public getHistory(limit = 20): readonly TriggerExecutionRecord[] {
    return this.executionHistory.slice(-limit);
  }

  /**
   * Fires a trigger safely with concurrency overlap prevention.
   */
  public async fire(config: TriggerConfig, details: string): Promise<boolean> {
    if (this.isProcessing) {
      // Overlap prevention: skip this tick if employee is currently busy with previous task
      return false;
    }

    this.isProcessing = true;
    const record: TriggerExecutionRecord = {
      triggerId: config.id,
      skillId: config.skillId,
      triggeredAt: new Date().toISOString(),
      eventDetails: details,
    };
    this.executionHistory.push(record);
    if (this.executionHistory.length > 200) {
      this.executionHistory.shift();
    }

    try {
      await this.onTrigger(config, details);
      return true;
    } finally {
      this.isProcessing = false;
    }
  }
}
