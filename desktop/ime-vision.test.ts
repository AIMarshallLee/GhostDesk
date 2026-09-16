import assert from 'node:assert/strict';
import test from 'node:test';
import { parseImeScene } from './ime-vision';

const valid = JSON.stringify({ focused: true, field: { x: .1, y: .7, width: .5, height: .1 }, text: '已提交正文', composition: 'nihao', candidates: [{ key: '1', text: '你好' }, { key: '2', text: '拟好' }], confidence: .98, blocked: false });

test('IME 视觉结果只接受带数字键的完整候选页', () => {
  const scene = parseImeScene(valid);
  assert.equal(scene.composition, 'nihao');
  assert.deepEqual(scene.candidates[0], { key: '1', text: '你好' });
});

test('候选窗被裁切时只接受明确阻断的转录结果', () => {
  const clipped = { ...JSON.parse(valid), candidates: [], blocked: true };
  assert.equal(parseImeScene(JSON.stringify(clipped)).blocked, true);
  assert.throws(() => parseImeScene(JSON.stringify({ ...clipped, blocked: false })), /候选页不完整/);
});

test('IME 视觉结果拒绝越界输入框、重复候选键与不可信数值', () => {
  assert.throws(() => parseImeScene(valid.replace('"width":0.5', '"width":1')),
    /输入框位置无效/);
  assert.throws(() => parseImeScene(valid.replace('"key":"2"', '"key":"1"')),
    /输入法候选词无效/);
  assert.throws(() => parseImeScene(valid.replace('"confidence":0.98', '"confidence":1.1')),
    /无法可靠识别/);
  assert.throws(() => parseImeScene(JSON.stringify({ focused: true, field: { x: 0, y: 0, width: 1, height: 1 }, text: '', composition: 'x'.repeat(257), candidates: [], confidence: .5, blocked: true })), /无法可靠识别/);
  assert.throws(() => parseImeScene(JSON.stringify({ focused: true, field: { x: 0, y: 0, width: 1, height: 1 }, text: '', composition: 'nihao', candidates: [], confidence: .9, blocked: false })), /候选页不完整/);
});
