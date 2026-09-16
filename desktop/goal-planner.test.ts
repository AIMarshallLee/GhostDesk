import test from 'node:test';
import assert from 'node:assert/strict';
import { GoalPlanner } from './goal-planner';
import { BUILTIN_SKILL_ORDER_TO_EXCEL } from './skill-engine';

test('goal planner loads subgoals from skill definition', () => {
  const planner = new GoalPlanner(BUILTIN_SKILL_ORDER_TO_EXCEL);
  const active = planner.getActiveSubgoal();
  assert.ok(active);
  assert.equal(active.id, 'step_read_wechat');
  assert.equal(active.targetProcess, 'wechat.exe');
  assert.equal(active.status, 'active');

  const progress = planner.getPlanProgress();
  assert.equal(progress.total, 4);
  assert.equal(progress.completed, 0);
  assert.equal(progress.percentage, 0);
});

test('goal planner advances through subgoals to completion', () => {
  const planner = new GoalPlanner(BUILTIN_SKILL_ORDER_TO_EXCEL);

  // Advance step 1 -> step 2
  const next1 = planner.advance();
  assert.equal(next1?.id, 'step_switch_to_excel');
  assert.equal(planner.getPlanProgress().completed, 1);

  // Advance step 2 -> step 3
  const next2 = planner.advance();
  assert.equal(next2?.id, 'step_fast_input_row');

  // Advance step 3 -> step 4
  const next3 = planner.advance();
  assert.equal(next3?.id, 'step_reply_confirmation');

  // Finish all
  const next4 = planner.advance();
  assert.equal(next4, undefined);
  assert.equal(planner.isAllCompleted(), true);
  assert.equal(planner.getPlanProgress().percentage, 100);
});

test('goal planner visual reflection detects progress when screen changes', () => {
  const planner = new GoalPlanner(BUILTIN_SKILL_ORDER_TO_EXCEL);

  const reflection = planner.reflectOnAction(
    true,
    'hash_before_typing_123',
    'hash_after_typing_456',
    { kind: 'type', text: '订单内容' },
  );

  assert.equal(reflection.progressMade, true);
  assert.equal(reflection.isStuck, false);
  assert.equal(reflection.stuckCount, 0);
});

test('goal planner detects stuck state and triggers self-healing ESC recovery action', () => {
  const planner = new GoalPlanner(BUILTIN_SKILL_ORDER_TO_EXCEL);

  // First unchanged screen after click (maybe lag) -> stuckCount 1
  const ref1 = planner.reflectOnAction(
    true,
    'screen_hash_static',
    'screen_hash_static',
    { kind: 'click', x: 0.5, y: 0.5, button: 'left', count: 1 },
  );
  assert.equal(ref1.progressMade, false);
  assert.equal(ref1.isStuck, false);
  assert.equal(ref1.stuckCount, 1);

  // Second unchanged screen after click (stuck!) -> stuckCount 2, triggers ESC recovery
  const ref2 = planner.reflectOnAction(
    true,
    'screen_hash_static',
    'screen_hash_static',
    { kind: 'click', x: 0.5, y: 0.5, button: 'left', count: 1 },
  );
  assert.equal(ref2.progressMade, false);
  assert.equal(ref2.isStuck, true);
  assert.equal(ref2.stuckCount, 2);
  assert.deepEqual(ref2.recommendedRecoveryAction, { kind: 'key', key: 'esc' });
});
