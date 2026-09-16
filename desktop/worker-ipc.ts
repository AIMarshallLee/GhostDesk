import { SkillRegistry, type SkillDefinition } from './skill-engine';
import { MultiWindowWorkspace, type WindowIdentity } from './workspace-manager';
import { GoalPlanner, type SubGoal } from './goal-planner';
import { HybridExecutor, type GhostDriver, type FastDriver } from './hybrid-executor';
import { WorkerTriggerManager, type TriggerConfig, type TriggerExecutionRecord } from './worker-triggers';
import { WorkerWatchdog } from './worker-watchdog';

export interface ActiveWorkerState {
  status: 'idle' | 'running' | 'completed' | 'failed' | 'paused';
  skillId?: string;
  skillName?: string;
  activeSubgoal?: SubGoal;
  progressPercentage: number;
  tokensSavedTotal: number;
  recentLogs: string[];
  lastError?: string;
}

export class WorkerController {
  private skillRegistry: SkillRegistry;
  private triggerManager: WorkerTriggerManager;
  private executor: HybridExecutor;
  private currentState: ActiveWorkerState = {
    status: 'idle',
    progressPercentage: 0,
    tokensSavedTotal: 0,
    recentLogs: [],
  };
  private activePlanner: GoalPlanner | undefined;
  private activeWorkspace: MultiWindowWorkspace | undefined;
  private watchdog: WorkerWatchdog;
  private isAbortRequested = false;

  constructor(
    ghostDriver: GhostDriver,
    fastDriver: FastDriver,
    private onProgressUpdate?: (state: ActiveWorkerState) => void,
  ) {
    this.skillRegistry = new SkillRegistry();
    this.executor = new HybridExecutor(ghostDriver, fastDriver);

    this.watchdog = new WorkerWatchdog({
      timeoutMs: 45_000,
      onTimeout: (reason) => {
        this.log(`[Watchdog] ${reason}`);
        this.stopWorker('Watchdog timeout');
      },
    });

    this.triggerManager = new WorkerTriggerManager(async (trigger, details) => {
      this.log(`[Trigger] Fired trigger "${trigger.name}": ${details}`);
      // In production, target windows can be auto-discovered or pre-configured
      const defaultWindows: WindowIdentity[] = [
        { hwnd: '1001', pid: 101, process: 'wechat.exe', title: '微信' },
        { hwnd: '1002', pid: 102, process: 'excel.exe', title: '订单流水.xlsx' },
      ];
      await this.dispatchWorker(trigger.skillId, defaultWindows);
    });
  }

  public listSkills(): SkillDefinition[] {
    return this.skillRegistry.list();
  }

  public getSkill(id: string): SkillDefinition | undefined {
    return this.skillRegistry.get(id);
  }

  public listTriggers(): TriggerConfig[] {
    return this.triggerManager.list();
  }

  public saveTrigger(config: TriggerConfig): void {
    this.triggerManager.register(config);
  }

  public deleteTrigger(id: string): void {
    this.triggerManager.unregister(id);
  }

  public toggleTrigger(id: string, enabled: boolean): void {
    this.triggerManager.setEnabled(id, enabled);
  }

  public getTriggerHistory(): readonly TriggerExecutionRecord[] {
    return this.triggerManager.getHistory();
  }

  public getState(): ActiveWorkerState {
    return structuredClone(this.currentState);
  }

  public async dispatchWorker(skillId: string, targetWindows: WindowIdentity[]): Promise<ActiveWorkerState> {
    if (this.currentState.status === 'running') {
      throw new Error('An AI worker is already running. Please wait or stop the current worker.');
    }

    const skill = this.skillRegistry.get(skillId);
    if (!skill) throw new Error(`Skill ${skillId} not found in registry`);

    this.isAbortRequested = false;
    this.activeWorkspace = new MultiWindowWorkspace(targetWindows);
    this.activePlanner = new GoalPlanner(skill);

    this.currentState = {
      status: 'running',
      skillId,
      skillName: skill.name,
      activeSubgoal: this.activePlanner.getActiveSubgoal(),
      progressPercentage: 0,
      tokensSavedTotal: 0,
      recentLogs: [`[System] Dispatched worker for skill "${skill.name}" across ${targetWindows.length} windows.`],
    };
    this.emitUpdate();

    try {
      this.watchdog.arm();

      while (!this.isAbortRequested && !this.activePlanner.isAllCompleted()) {
        const subgoal = this.activePlanner.getActiveSubgoal();
        if (!subgoal) break;

        this.watchdog.heartbeat();
        this.log(`[Step] Starting: ${subgoal.name} (${subgoal.targetProcess})`);

        // 1. Locate target window in workspace
        const targetWin = targetWindows.find((w) => w.process.toLowerCase() === subgoal.targetProcess.toLowerCase());
        if (targetWin) {
          try {
            this.activeWorkspace.switchFocus(targetWin.hwnd);
            this.log(`[Workspace] Focused window "${targetWin.title}" (HWND ${targetWin.hwnd})`);
          } catch (e) {
            this.log(`[Workspace Warning] ${(e as Error).message}`);
          }
        }

        // 2. Execute simulated action through Hybrid Executor
        const actionResult = await this.executor.execute(
          targetWin ?? { hwnd: '0', pid: 0, process: subgoal.targetProcess, title: subgoal.name },
          { kind: 'type', text: subgoal.instruction },
        );

        if (actionResult.tokensSavedEstimate) {
          this.currentState.tokensSavedTotal += actionResult.tokensSavedEstimate;
        }

        // 3. Visual self-reflection
        const reflection = this.activePlanner.reflectOnAction(
          actionResult.ok,
          'before_hash',
          actionResult.ok ? 'after_hash_changed' : 'before_hash',
          { kind: 'type', text: subgoal.instruction },
        );

        if (reflection.isStuck && reflection.recommendedRecoveryAction) {
          this.log(`[Self-Healing] Detected blocked UI, applying recovery: ${reflection.recommendedRecoveryAction.kind}`);
          await this.executor.execute(
            targetWin ?? { hwnd: '0', pid: 0, process: subgoal.targetProcess, title: 'Recovery' },
            reflection.recommendedRecoveryAction,
          );
        }

        // Advance to next step
        this.activePlanner.advance();
        const progress = this.activePlanner.getPlanProgress();
        this.currentState.progressPercentage = progress.percentage;
        this.currentState.activeSubgoal = this.activePlanner.getActiveSubgoal();
        this.emitUpdate();

        // Brief delay between steps
        await new Promise((r) => setTimeout(r, 20));
      }

      this.watchdog.disarm();

      if (this.isAbortRequested) {
        this.currentState.status = 'paused';
        this.log('[System] Worker execution aborted by user.');
      } else {
        this.currentState.status = 'completed';
        this.currentState.progressPercentage = 100;
        this.log('[System] AI worker completed all subgoals successfully!');
      }
    } catch (error) {
      this.watchdog.disarm();
      this.currentState.status = 'failed';
      this.currentState.lastError = (error as Error).message;
      this.log(`[Error] Worker failure: ${(error as Error).message}`);
    }

    this.emitUpdate();
    return this.getState();
  }

  public stopWorker(reason = 'User stopped'): void {
    this.isAbortRequested = true;
    this.watchdog.disarm();
    this.log(`[System] Stop signal received: ${reason}`);
    this.currentState.status = 'idle';
    this.emitUpdate();
  }

  private log(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    this.currentState.recentLogs.push(`[${timestamp}] ${message}`);
    if (this.currentState.recentLogs.length > 50) {
      this.currentState.recentLogs.shift();
    }
    this.emitUpdate();
  }

  private emitUpdate(): void {
    if (this.onProgressUpdate) {
      this.onProgressUpdate(this.getState());
    }
  }
}
