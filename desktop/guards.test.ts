import test from 'node:test';
import assert from 'node:assert/strict';
import { isSandboxRequest } from '../shared/autopilot.ts';
import { hasUsbArmState, isAllowedRendererUrl, isAllowedRequest, isUsbBridgeReply, sameProcessIdentity, sameWindowIdentity, validCrop, windowHandleFromSource } from './guards.ts';

test('only known local API routes are accepted', () => {
  assert.equal(isAllowedRequest({ method: 'GET', path: '/state' }), true);
  assert.equal(isAllowedRequest({ method: 'POST', path: '/shell' }), false);
  assert.equal(isAllowedRequest({ method: 'POST', path: '/tasks/task_1/complete' }), true);
  assert.equal(isAllowedRequest({ method: 'GET', path: 'https://example.com' }), false);
});
test('simulator bridge cannot reach workspace, secrets, native input or remote destinations', () => {
  for (const path of ['/knowledge/import/preview', '/knowledge/import/commit', '/knowledge/review', '/knowledge/search', '/knowledge/evaluate']) {
    assert.equal(isAllowedRequest({ method: 'POST', path }), true);
    assert.equal(isSandboxRequest({ method: 'POST', path }), false);
  }
  assert.equal(isSandboxRequest({ method: 'GET', path: '/sandbox/state' }), true);
  assert.equal(isAllowedRequest({ method: 'POST', path: '/sandbox/messages' }), true);
  assert.equal(isSandboxRequest({ method: 'POST', path: '/sandbox/conversations/lin' }), true);
  for (const path of ['/settings', '/export', '/sandbox/../settings', '/sandbox/conversations/real-account', '/sandbox/native-input', 'https://example.com']) {
    assert.equal(isSandboxRequest({ method: 'POST', path }), false, path);
  }
  assert.equal(isSandboxRequest({ method: 'DELETE', path: '/sandbox/state' }), false);
});
test('crop remains bounded within a captured image', () => {
  assert.equal(validCrop({ x: 0, y: 0, width: 100, height: 100 }, 100, 100), true);
  assert.equal(validCrop({ x: 99, y: 0, width: 2, height: 1 }, 100, 100), false);
});
test('window identity requires the exact captured handle and title', () => {
  const captured = { sourceId: 'window:12:0', name: 'Chat', hwnd: '12', process: 'chat', pid: 22, startedAt: '2026-01-01T00:00:00.000Z' };
  assert.equal(sameWindowIdentity(captured, { hwnd: '12', title: 'Chat', process: 'chat' }), true);
  assert.equal(sameProcessIdentity(captured, { pid: 22, startedAt: '2026-01-01T00:00:00.000Z' }), true);
  assert.equal(sameProcessIdentity(captured, { pid: 23, startedAt: '2026-01-01T00:00:00.000Z' }), false);
  assert.equal(sameWindowIdentity(captured, { hwnd: '12', title: 'Changed', process: 'chat' }), false);
  assert.equal(windowHandleFromSource('window:12:0'), '12');
});
test('only the exact local renderer file may navigate', () => {
  const renderer = 'file:///C:/FlowDesk/dist/index.html';
  assert.equal(isAllowedRendererUrl(`${renderer}#tasks`, renderer), true);
  assert.equal(isAllowedRendererUrl('file:///C:/FlowDesk/secrets.txt', renderer), false);
  assert.equal(isAllowedRendererUrl('https://example.com', renderer), false);
});

test('packaged renderer navigation rejects other hosts, paths and protocols', () => {
  const renderer = 'flowdesk://app/index.html';
  assert.equal(isAllowedRendererUrl(`${renderer}#autopilot`, renderer), true);
  for (const url of ['flowdesk://other/index.html', 'flowdesk://app/assets/page.html', `${renderer}?redirect=1`, 'flowdesk://user@app/index.html', 'https://app/index.html', 'file:///index.html']) {
    assert.equal(isAllowedRendererUrl(url, renderer), false, url);
  }
});
test('USB protocol replies require the expected device and physical arm state', () => {
  assert.equal(isUsbBridgeReply({ ok: true, protocol: 1, device: 'FlowDesk USB Bridge', armed: true }), true);
  assert.equal(isUsbBridgeReply({ ok: true, protocol: 2, device: 'FlowDesk USB Bridge', armed: true }), false);
  assert.equal(isUsbBridgeReply({ ok: true, protocol: 1, device: 'Other device', armed: true }), false);
  assert.equal(hasUsbArmState({ ok: true, protocol: 1, device: 'FlowDesk USB Bridge', armed: false }, false), true);
  assert.equal(hasUsbArmState({ ok: true, protocol: 1, device: 'FlowDesk USB Bridge', armed: true }, false), false);
});
