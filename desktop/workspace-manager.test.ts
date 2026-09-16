import test from 'node:test';
import assert from 'node:assert/strict';
import { MultiWindowWorkspace, type WindowIdentity } from './workspace-manager';

const winA: WindowIdentity = {
  hwnd: '1001',
  pid: 1234,
  process: 'wechat.exe',
  title: '微信',
  width: 800,
  height: 600,
};

const winB: WindowIdentity = {
  hwnd: '1002',
  pid: 5678,
  process: 'excel.exe',
  title: '2026采购订单.xlsx - Excel',
  width: 1200,
  height: 800,
};

const winC: WindowIdentity = {
  hwnd: '1003',
  pid: 9999,
  process: 'chrome.exe',
  title: '企业管理后台 - Google Chrome',
  width: 1024,
  height: 768,
};

test('multi-window workspace manages scope and initial active window', () => {
  const ws = new MultiWindowWorkspace([winA, winB]);
  assert.equal(ws.listWindows().length, 2);
  assert.equal(ws.getActiveWindow()?.hwnd, '1001');
  assert.equal(ws.isInScope('1001'), true);
  assert.equal(ws.isInScope('1002'), true);
  assert.equal(ws.isInScope('9999'), false);
});

test('multi-window workspace allows switching between whitelisted windows', () => {
  const ws = new MultiWindowWorkspace([winA, winB, winC]);
  assert.equal(ws.getActiveWindow()?.hwnd, '1001');

  const switched = ws.switchFocus('1002');
  assert.equal(switched.hwnd, '1002');
  assert.equal(ws.getActiveWindow()?.hwnd, '1002');
  assert.equal(ws.getActiveWindow()?.process, 'excel.exe');

  ws.switchFocus('1003');
  assert.equal(ws.getActiveWindow()?.hwnd, '1003');
  assert.equal(ws.getActiveWindow()?.process, 'chrome.exe');
});

test('switching to an unauthorized window throws security violation', () => {
  const ws = new MultiWindowWorkspace([winA, winB]);
  assert.throws(
    () => ws.switchFocus('9999'),
    /Workspace Security Violation: HWND 9999 is not in the authorized workspace scope/,
  );
  // Active window remains unchanged
  assert.equal(ws.getActiveWindow()?.hwnd, '1001');
});

test('validateForeground accepts allowed window and rejects unauthorized window', () => {
  const ws = new MultiWindowWorkspace([winA, winB]);
  // In scope
  assert.doesNotThrow(() => ws.validateForeground('1001', '微信'));
  assert.doesNotThrow(() => ws.validateForeground('1002', 'Excel'));

  // Unknown window / popup outside scope
  assert.throws(
    () => ws.validateForeground('8888', '恶意外挂/未知弹窗'),
    /Workspace Fail-Closed: Foreground window \(8888\) is outside the AI employee workspace scope/,
  );
});

test('adding and removing windows updates scope dynamically', () => {
  const ws = new MultiWindowWorkspace([winA]);
  assert.equal(ws.listWindows().length, 1);

  ws.addWindow(winB);
  assert.equal(ws.listWindows().length, 2);
  assert.equal(ws.isInScope('1002'), true);

  ws.removeWindow('1001');
  assert.equal(ws.listWindows().length, 1);
  assert.equal(ws.isInScope('1001'), false);
  assert.equal(ws.getActiveWindow()?.hwnd, '1002');
});

test('multi-window workspace accepts macOS Quartz IDs and bundle strings', () => {
  const macWin1: WindowIdentity = {
    hwnd: 'mac_quartz_4512',
    pid: 101,
    process: 'WeChat',
    title: '微信 Mac版',
  };
  const macWin2: WindowIdentity = {
    hwnd: '0x004A',
    pid: 102,
    process: 'Google Chrome',
    title: 'Google Chrome',
  };

  const ws = new MultiWindowWorkspace([macWin1, macWin2]);
  assert.equal(ws.listWindows().length, 2);
  assert.equal(ws.getActiveWindow()?.hwnd, 'mac_quartz_4512');
  assert.equal(ws.switchFocus('0x004A').process, 'Google Chrome');
});

test('validateWindowIntegrity defends against PID reuse and process spoofing', () => {
  const ws = new MultiWindowWorkspace([winA]);

  // Valid verification passes
  assert.equal(ws.validateWindowIntegrity('1001', 1234, 'wechat.exe'), true);

  // PID mismatch (e.g. process died and HWND was recycled by another PID)
  assert.throws(
    () => ws.validateWindowIntegrity('1001', 9999, 'wechat.exe'),
    /PID mismatch for HWND 1001/,
  );

  // Process mismatch (e.g. malware spoofing HWND)
  assert.throws(
    () => ws.validateWindowIntegrity('1001', 1234, 'cmd.exe'),
    /Process mismatch for HWND 1001/,
  );

  // Unregistered HWND
  assert.throws(
    () => ws.validateWindowIntegrity('7777', 1234, 'wechat.exe'),
    /HWND 7777 is not registered/,
  );
});

test('handles whitespace and colon window IDs correctly', () => {
  const ws = new MultiWindowWorkspace();
  ws.addWindow({
    hwnd: ' win:4001 ',
    pid: 200,
    process: 'Code',
    title: 'VSCode',
  });

  assert.equal(ws.isInScope('win:4001'), true);
  assert.equal(ws.isInScope(' win:4001 '), true);
  assert.equal(ws.getActiveWindow()?.hwnd, 'win:4001');
});


