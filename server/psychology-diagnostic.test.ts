import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzePsychologyAndIntent, generateTripleCandidates } from './psychology-diagnostic.ts';

test('analyzePsychologyAndIntent accurately diagnoses price sensitivity and caution', () => {
  const diagnostic = analyzePsychologyAndIntent('这个价格太贵了，能不能便宜点或者打个折？');
  assert.equal(diagnostic.riskLevel, 'cautious');
  assert.equal(diagnostic.coreNeed, 'price');
  assert.match(diagnostic.underlyingIntent, /议价/);
  assert.match(diagnostic.suggestedAction, /预算/);
  assert.ok(diagnostic.confidence >= 90);
});

test('analyzePsychologyAndIntent identifies high risk complaints and urgency', () => {
  const diagnostic = analyzePsychologyAndIntent('你们怎么还不退款？再不解决我就报警打 12315 投诉你们欺诈！');
  assert.equal(diagnostic.riskLevel, 'high_risk');
  assert.match(diagnostic.underlyingIntent, /信任受损/);
  assert.match(diagnostic.suggestedAction, /主管/);
  assert.ok(diagnostic.confidence >= 95);
});

test('analyzePsychologyAndIntent identifies speed and delivery certainty', () => {
  const diagnostic = analyzePsychologyAndIntent('顺丰今天能发货吗？我急着用，几天能到？');
  assert.equal(diagnostic.riskLevel, 'safe');
  assert.equal(diagnostic.coreNeed, 'speed');
  assert.match(diagnostic.underlyingIntent, /履约时效/);
  assert.match(diagnostic.suggestedAction, /发货/);
});

test('generateTripleCandidates generates 3 postures: quick, warm, and conversion', () => {
  const diagnostic = analyzePsychologyAndIntent('这个价格有点贵，有没有优惠？');
  const baseReply = '我们采用企业级工业芯片和纯物理硬件架构，提供终身质保服务。';
  const candidates = generateTripleCandidates(baseReply, diagnostic, '这个价格有点贵');

  assert.equal(candidates.length, 3);
  assert.equal(candidates[0].id, 'quick');
  assert.equal(candidates[1].id, 'warm');
  assert.equal(candidates[2].id, 'conversion');

  // Quick candidate is short
  assert.ok(candidates[0].text.length <= 40);

  // Warm candidate starts with empathy
  assert.match(candidates[1].text, /预算/);

  // Conversion candidate has actionable CTA
  assert.match(candidates[2].text, /赠品|看如何/);
});
