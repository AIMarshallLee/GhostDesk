import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveExecutionChannel,
  HIGH_RISK_PROCESSES,
  SAFE_OFFICE_PROCESSES,
} from './hybrid-policy';

test('hybrid policy routes high-risk processes to ghost channel automatically', () => {
  for (const proc of ['wechat.exe', 'wxwork.exe', 'dingtalk.exe', 'pinduoduo.exe', 'feishu.exe']) {
    const decision = resolveExecutionChannel(proc, 'auto');
    assert.equal(decision.channel, 'ghost');
    assert.equal(decision.isHighRisk, true);
  }
});

test('hybrid policy routes safe productivity processes to fast channel automatically', () => {
  for (const proc of ['excel.exe', 'chrome.exe', 'notepad.exe', 'msedge.exe']) {
    const decision = resolveExecutionChannel(proc, 'auto');
    assert.equal(decision.channel, 'fast');
    assert.equal(decision.isHighRisk, false);
  }
});

test('hybrid policy defaults unknown processes to ghost channel for fail-closed security', () => {
  const decision = resolveExecutionChannel('some_custom_internal_tool.exe', 'auto');
  assert.equal(decision.channel, 'ghost');
  assert.equal(decision.isHighRisk, false);
});

test('user policy ghost overrides safe processes to ghost channel', () => {
  const decision = resolveExecutionChannel('excel.exe', 'ghost');
  assert.equal(decision.channel, 'ghost');
});

test('user policy fast on high-risk processes is rejected and overridden to ghost for anti-ban safety', () => {
  const decision = resolveExecutionChannel('wechat.exe', 'fast');
  assert.equal(decision.channel, 'ghost');
  assert.equal(decision.isHighRisk, true);
  assert.match(decision.reason, /Overriding to Ghost Channel/);
});

test('user policy fast on safe process succeeds', () => {
  const decision = resolveExecutionChannel('chrome.exe', 'fast');
  assert.equal(decision.channel, 'fast');
});
