import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkerTriggerManager, type IntervalTriggerConfig } from './worker-triggers';

test('worker trigger manager registers and lists interval triggers', () => {
  const firedEvents: string[] = [];
  const manager = new WorkerTriggerManager(async (config, details) => {
    firedEvents.push(`${config.id}: ${details}`);
  });

  const intervalConfig: IntervalTriggerConfig = {
    id: 'trig_wechat_poll',
    name: '定时微信巡检',
    skillId: 'skill_order_to_excel',
    enabled: false,
    type: 'interval',
    intervalSeconds: 60,
  };

  manager.register(intervalConfig);
  assert.equal(manager.list().length, 1);
  assert.equal(manager.get('trig_wechat_poll')?.name, '定时微信巡检');
  manager.stopAll();
});

test('firing trigger invokes handler and records execution history', async () => {
  const firedEvents: string[] = [];
  const manager = new WorkerTriggerManager(async (config, details) => {
    firedEvents.push(details);
  });

  const intervalConfig: IntervalTriggerConfig = {
    id: 'trig_1',
    name: '测试触发',
    skillId: 'skill_order_to_excel',
    enabled: false,
    type: 'interval',
    intervalSeconds: 10,
  };

  manager.register(intervalConfig);
  const ok = await manager.fire(intervalConfig, '手动测试触发');
  assert.equal(ok, true);
  assert.equal(firedEvents.length, 1);
  assert.equal(firedEvents[0], '手动测试触发');

  const history = manager.getHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].triggerId, 'trig_1');
  assert.equal(history[0].skillId, 'skill_order_to_excel');
});

test('concurrency overlap protection skips concurrent firing while processing', async () => {
  let inProgress = false;
  let executionCount = 0;

  const manager = new WorkerTriggerManager(async () => {
    executionCount++;
    inProgress = true;
    await new Promise((resolve) => setTimeout(resolve, 30));
    inProgress = false;
  });

  const config: IntervalTriggerConfig = {
    id: 'trig_overlap',
    name: '防重叠测试',
    skillId: 'skill_order_to_excel',
    enabled: false,
    type: 'interval',
    intervalSeconds: 10,
  };

  manager.register(config);

  // Fire first: starts async work
  const p1 = manager.fire(config, 'First fire');
  // Fire second immediately while first is in progress
  const p2 = manager.fire(config, 'Second concurrent fire');

  const [res1, res2] = await Promise.all([p1, p2]);
  assert.equal(res1, true, 'First fire succeeded');
  assert.equal(res2, false, 'Second fire skipped due to concurrency lock');
  assert.equal(executionCount, 1);
});
