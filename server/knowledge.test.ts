import assert from 'node:assert/strict';
import test from 'node:test';
import type { Knowledge } from '../shared/types';
import { knowledgeAvailable, knowledgeFingerprint, retrieveKnowledge } from './knowledge';

const item = (overrides: Partial<Knowledge> = {}): Knowledge => ({
  id: 'k1', title: '退款规则', content: '请提供订单号后核对退款条件。', tags: ['售后'], enabled: true, reviewStatus: 'approved', question: '如何退款', aliases: ['退货怎么处理'], scenario: 'service', createdAt: '2026-09-19T00:00:00.000Z', updatedAt: '2026-09-19T00:00:00.000Z', ...overrides,
});

test('去重指纹保留小数、负数与范围，不能合并不同价格口径', () => {
  assert.notEqual(knowledgeFingerprint(item({ content: '费用 1.5 元' })), knowledgeFingerprint(item({ content: '费用 15 元' })));
  assert.notEqual(knowledgeFingerprint(item({ content: '温度 -5 度' })), knowledgeFingerprint(item({ content: '温度 5 度' })));
  assert.notEqual(knowledgeFingerprint(item({ content: '范围 20-50 元' })), knowledgeFingerprint(item({ content: '范围 2050 元' })));
});

test('待审核知识不可用，审核后的问题、相似问法与场景可检索', () => {
  const pending = item({ id: 'pending', enabled: false, reviewStatus: 'pending' });
  const sales = item({ id: 'sales', title: '报价说明', content: '报价由商务确认。', question: '怎么报价', aliases: ['费用多少'], tags: ['报价'], scenario: 'sales' });
  assert.equal(knowledgeAvailable(pending), false);
  assert.throws(() => retrieveKnowledge([pending], { query: '如何退款', includePending: true } as never), /有效场景/);
  assert.equal(retrieveKnowledge([pending, sales], { query: '退货怎么处理' }).status, 'no_match');
  const alias = retrieveKnowledge([pending, sales], { query: '费用多少', scenario: 'sales' });
  assert.equal(alias.hits[0]?.id, 'sales');
  assert.equal(alias.hits[0]?.matchedFields.includes('相似问法'), true);
  assert.equal(retrieveKnowledge([sales], { query: '费用多少', scenario: 'service' }).status, 'no_match');
  assert.equal(retrieveKnowledge([sales], { query: '不存在的海外部署政策' }).status, 'no_match');
});

test('all 场景可被特定场景查询，ids 范围限制生效', () => {
  const all = item({ id: 'all', title: '人工审核边界', question: '是否需要人工审核', aliases: ['会自动发消息吗'], scenario: 'all' });
  const service = item({ id: 'service', title: '售后审核', question: '售后是否审核', scenario: 'service' });
  const result = retrieveKnowledge([all, service], { query: '会自动发消息吗', scenario: 'community', ids: ['all'] });
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0].id, 'all');
});
