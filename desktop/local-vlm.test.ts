import test from 'node:test';
import assert from 'node:assert/strict';
import { QwenVlmAdapter } from './local-vlm';

test('qwen adapter builds valid openai-compatible payload for ollama', () => {
  const payload = QwenVlmAdapter.buildPayload('点击发送按钮', 'base64_img_data', 'qwen2.5-vl:7b');
  assert.equal(payload.model, 'qwen2.5-vl:7b');
  const messages = payload.messages as Array<Record<string, unknown>>;
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[1].role, 'user');
});

test('qwen adapter parses click with 0-1000 coordinates to normalized float', () => {
  const output = 'Thought: The submit button is at the bottom right.\nAction: click(point=[850, 920])';
  const parsed = QwenVlmAdapter.parseAction(output);

  assert.equal(parsed.thought, 'The submit button is at the bottom right.');
  assert.equal(parsed.action.kind, 'click');
  if (parsed.action.kind === 'click') {
    assert.equal(parsed.action.x, 0.92); // rawX 920 / 1000
    assert.equal(parsed.action.y, 0.85); // rawY 850 / 1000
    assert.equal(parsed.action.button, 'left');
  }
});

test('qwen adapter parses type action', () => {
  const output = 'Action: type(content="张三，13800000000")';
  const parsed = QwenVlmAdapter.parseAction(output);

  assert.equal(parsed.action.kind, 'type');
  if (parsed.action.kind === 'type') {
    assert.equal(parsed.action.text, '张三，13800000000');
  }
});

test('qwen adapter parses hotkey and scroll actions', () => {
  const keyOutput = 'Action: hotkey(key="enter")';
  const parsedKey = QwenVlmAdapter.parseAction(keyOutput);
  assert.equal(parsedKey.action.kind, 'key');
  if (parsedKey.action.kind === 'key') {
    assert.equal(parsedKey.action.key, 'enter');
  }

  const scrollOutput = 'Action: scroll(direction="down", amount=5)';
  const parsedScroll = QwenVlmAdapter.parseAction(scrollOutput);
  assert.equal(parsedScroll.action.kind, 'scroll');
  if (parsedScroll.action.kind === 'scroll') {
    assert.equal(parsedScroll.action.direction, 'down');
    assert.equal(parsedScroll.action.amount, 5);
  }
});

test('qwen adapter handles markdown fences and alternate click formats', () => {
  const fencedOutput = '```\nThought: Click the search box\nAction: click(x=350, y=120)\n```';
  const parsedFenced = QwenVlmAdapter.parseAction(fencedOutput);
  assert.equal(parsedFenced.thought, 'Click the search box');
  assert.equal(parsedFenced.action.kind, 'click');
  if (parsedFenced.action.kind === 'click') {
    assert.equal(parsedFenced.action.x, 0.35);
    assert.equal(parsedFenced.action.y, 0.12);
  }
});
