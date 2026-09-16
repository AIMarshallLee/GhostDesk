import test from 'node:test';
import assert from 'node:assert/strict';
import { HybridExecutor, type GhostDriver, type FastDriver } from './hybrid-executor';
import type { WindowIdentity } from './workspace-manager';
import type { ComputerUseAction } from '../shared/computer-use';

const wechatTarget: WindowIdentity = {
  hwnd: '2001',
  pid: 1111,
  process: 'wechat.exe',
  title: '微信客户群',
};

const excelTarget: WindowIdentity = {
  hwnd: '2002',
  pid: 2222,
  process: 'excel.exe',
  title: '2026年度销售明细.xlsx',
};

test('hybrid executor routes wechat to ghost driver automatically', async () => {
  let ghostCalls = 0;
  let fastCalls = 0;

  const ghostDriver: GhostDriver = {
    async execute(action) {
      ghostCalls++;
      assert.equal(action.kind, 'type');
    },
  };
  const fastDriver: FastDriver = {
    async execute() {
      fastCalls++;
    },
  };

  const executor = new HybridExecutor(ghostDriver, fastDriver);
  const action: ComputerUseAction = { kind: 'type', text: '您好，订单已为您核实完毕' };

  const result = await executor.execute(wechatTarget, action);
  assert.equal(result.ok, true);
  assert.equal(result.channel, 'ghost');
  assert.equal(ghostCalls, 1);
  assert.equal(fastCalls, 0);
});

test('hybrid executor routes excel to fast driver automatically and tracks token savings', async () => {
  let ghostCalls = 0;
  let fastCalls = 0;

  const ghostDriver: GhostDriver = {
    async execute() {
      ghostCalls++;
    },
  };
  const fastDriver: FastDriver = {
    async execute(action) {
      fastCalls++;
      assert.equal(action.kind, 'type');
    },
  };

  const executor = new HybridExecutor(ghostDriver, fastDriver);
  const action: ComputerUseAction = { kind: 'type', text: 'SKU-99281, 100件, 状态:已发货' };

  const result = await executor.execute(excelTarget, action);
  assert.equal(result.ok, true);
  assert.equal(result.channel, 'fast');
  assert.equal(fastCalls, 1);
  assert.equal(ghostCalls, 0);
  assert.ok((result.tokensSavedEstimate ?? 0) > 0, 'Estimated token savings is tracked');
});

test('hybrid executor captures execution errors without crashing', async () => {
  const ghostDriver: GhostDriver = {
    async execute() {
      throw new Error('Pico USB disconnected');
    },
  };
  const fastDriver: FastDriver = {
    async execute() {},
  };

  const executor = new HybridExecutor(ghostDriver, fastDriver);
  const result = await executor.execute(wechatTarget, { kind: 'click', x: 0.5, y: 0.5, button: 'left', count: 1 });

  assert.equal(result.ok, false);
  assert.equal(result.channel, 'ghost');
  assert.equal(result.error, 'Pico USB disconnected');
});
