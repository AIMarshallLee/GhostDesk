import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkerController } from './worker-ipc';
import type { WindowIdentity } from './workspace-manager';

const mockWindows: WindowIdentity[] = [
  { hwnd: '5001', pid: 501, process: 'wechat.exe', title: '微信' },
  { hwnd: '5002', pid: 502, process: 'excel.exe', title: '采购单.xlsx' },
];

test('worker controller lists builtin skills', () => {
  const controller = new WorkerController(
    { async execute() {} },
    { async execute() {} },
  );

  const skills = controller.listSkills();
  assert.ok(skills.length >= 1);
  assert.equal(skills[0].id, 'skill_order_to_excel');
});

test('worker controller dispatches worker and runs through subgoals to completion', async () => {
  const executedChannels: string[] = [];

  const controller = new WorkerController(
    {
      async execute() {
        executedChannels.push('ghost');
      },
    },
    {
      async execute() {
        executedChannels.push('fast');
      },
    },
  );

  const state = await controller.dispatchWorker('skill_order_to_excel', mockWindows);

  assert.equal(state.status, 'completed');
  assert.equal(state.progressPercentage, 100);
  assert.equal(state.skillName, '微信订单自动归档至 Excel');
  assert.ok(state.tokensSavedTotal > 0, 'Tokens saved from Fast channel actions');
  assert.ok(executedChannels.includes('ghost'), 'Ghost channel used for WeChat');
  assert.ok(executedChannels.includes('fast'), 'Fast channel used for Excel');
  assert.ok(state.recentLogs.length > 3);
});

test('worker controller manages autonomous triggers', () => {
  const controller = new WorkerController(
    { async execute() {} },
    { async execute() {} },
  );

  controller.saveTrigger({
    id: 'trig_auto_sync',
    name: '定时订单同步',
    skillId: 'skill_order_to_excel',
    enabled: false,
    type: 'interval',
    intervalSeconds: 60,
  });

  assert.equal(controller.listTriggers().length, 1);
  assert.equal(controller.listTriggers()[0].name, '定时订单同步');

  controller.deleteTrigger('trig_auto_sync');
  assert.equal(controller.listTriggers().length, 0);
});
