import type { ComputerUseAction } from '../shared/computer-use';
import type { SkillDefinition, SkillStep } from './skill-engine';

export type SubGoalStatus = 'pending' | 'active' | 'completed' | 'failed';

export interface SubGoal {
  id: string;
  name: string;
  targetProcess: string;
  instruction: string;
  expectedOutcome: string;
  status: SubGoalStatus;
  attempts: number;
  maxAttempts: number;
}

export interface ReflectionResult {
  progressMade: boolean;
  isStuck: boolean;
  stuckCount: number;
  recommendedRecoveryAction?: ComputerUseAction;
  reason: string;
}

/**
 * GoalPlanner manages task decomposition, step tracking, and visual self-reflection / healing.
 */
export class GoalPlanner {
  private subgoals: SubGoal[] = [];
  private activeIndex = -1;
  private consecutiveStuckCount = 0;
  private maxConsecutiveStuck = 2;

  constructor(skill?: SkillDefinition) {
    if (skill) {
      this.loadFromSkill(skill);
    }
  }

  /**
   * Initializes sub-goals from a SkillDefinition.
   */
  public loadFromSkill(skill: SkillDefinition): void {
    this.subgoals = skill.steps.map((step) => ({
      id: step.id,
      name: step.name,
      targetProcess: step.targetProcess,
      instruction: step.instruction,
      expectedOutcome: step.expectedOutcome,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
    }));
    this.activeIndex = this.subgoals.length > 0 ? 0 : -1;
    if (this.activeIndex >= 0) {
      this.subgoals[this.activeIndex].status = 'active';
    }
    this.consecutiveStuckCount = 0;
  }

  /**
   * Initializes custom sub-goals directly.
   */
  public loadSubgoals(subgoals: Omit<SubGoal, 'status' | 'attempts'>[]): void {
    this.subgoals = subgoals.map((sg) => ({
      ...sg,
      status: 'pending',
      attempts: 0,
    }));
    this.activeIndex = this.subgoals.length > 0 ? 0 : -1;
    if (this.activeIndex >= 0) {
      this.subgoals[this.activeIndex].status = 'active';
    }
    this.consecutiveStuckCount = 0;
  }

  public getActiveSubgoal(): SubGoal | undefined {
    if (this.activeIndex >= 0 && this.activeIndex < this.subgoals.length) {
      return this.subgoals[this.activeIndex];
    }
    return undefined;
  }

  public getAllSubgoals(): readonly SubGoal[] {
    return this.subgoals;
  }

  public isAllCompleted(): boolean {
    return this.subgoals.length > 0 && this.subgoals.every((sg) => sg.status === 'completed');
  }

  /**
   * Visual Self-Reflection:
   * Compares the visual observation / state before and after an action to determine
   * whether genuine progress was made or if the AI is blocked by an unexpected dialog/popup.
   */
  public reflectOnAction(
    actionSuccess: boolean,
    screenHashBefore: string,
    screenHashAfter: string,
    action: ComputerUseAction,
  ): ReflectionResult {
    const active = this.getActiveSubgoal();
    if (!active) {
      return {
        progressMade: false,
        isStuck: false,
        stuckCount: 0,
        reason: 'No active subgoal to reflect upon.',
      };
    }

    active.attempts++;

    // If action errored, or screen was completely unchanged after a state-mutating action (click / type)
    const isMutatingAction = action.kind === 'click' || action.kind === 'type' || action.kind === 'key';
    const screenUnchanged = screenHashBefore === screenHashAfter;

    if (!actionSuccess || (isMutatingAction && screenUnchanged)) {
      this.consecutiveStuckCount++;
      const isStuck = this.consecutiveStuckCount >= this.maxConsecutiveStuck;

      let recoveryAction: ComputerUseAction | undefined;
      if (isStuck) {
        // Self-healing: if stuck for 2 turns, first try pressing ESC to dismiss modal dialogs / dropdowns
        if (this.consecutiveStuckCount === 2) {
          recoveryAction = { kind: 'key', key: 'esc' };
        } else {
          // If still stuck after ESC, try clicking a neutral spot or re-focusing
          recoveryAction = { kind: 'key', key: 'tab' };
        }
      }

      return {
        progressMade: false,
        isStuck,
        stuckCount: this.consecutiveStuckCount,
        recommendedRecoveryAction: recoveryAction,
        reason: !actionSuccess
          ? `Action failed with execution error.`
          : `Screen state unchanged after ${action.kind} action. Possible popup blocking or unfocused input.`,
      };
    }

    // Success and visible progress
    this.consecutiveStuckCount = 0;
    return {
      progressMade: true,
      isStuck: false,
      stuckCount: 0,
      reason: `Action ${action.kind} executed successfully and UI state updated as expected.`,
    };
  }

  /**
   * Marks current active subgoal as completed and advances to the next.
   */
  public advance(): SubGoal | undefined {
    if (this.activeIndex >= 0 && this.activeIndex < this.subgoals.length) {
      this.subgoals[this.activeIndex].status = 'completed';
    }
    this.activeIndex++;
    this.consecutiveStuckCount = 0;

    if (this.activeIndex < this.subgoals.length) {
      this.subgoals[this.activeIndex].status = 'active';
      return this.subgoals[this.activeIndex];
    }
    return undefined;
  }

  /**
   * Fails the current subgoal if retries are exhausted.
   */
  public markFailed(reason: string): void {
    if (this.activeIndex >= 0 && this.activeIndex < this.subgoals.length) {
      this.subgoals[this.activeIndex].status = 'failed';
    }
  }

  public getPlanProgress(): { total: number; completed: number; percentage: number } {
    const total = this.subgoals.length;
    const completed = this.subgoals.filter((s) => s.status === 'completed').length;
    const percentage = total === 0 ? 100 : Math.round((completed / total) * 100);
    return { total, completed, percentage };
  }
}
