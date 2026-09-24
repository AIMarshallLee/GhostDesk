import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createService } from './service.ts';
import { PRESET_PLAYBOOKS, extractPlaybookFromChat, qualifyLeadFromText } from './playbook-presets.ts';

test('PRESET_PLAYBOOKS contains 3 battle-tested industry packs', () => {
  assert.equal(PRESET_PLAYBOOKS.length, 3);
  assert.ok(PRESET_PLAYBOOKS.some(p => p.id === 'playbook_social_sales'));
  assert.ok(PRESET_PLAYBOOKS.some(p => p.id === 'playbook_ecommerce_support'));
  assert.ok(PRESET_PLAYBOOKS.some(p => p.id === 'playbook_high_ticket_consulting'));
});

test('extractPlaybookFromChat extracts Q&A pairs, objections, and strategies from chat transcript', () => {
  const chat = `
客户：你们这个软件多少钱啊？感觉有点贵。
顾问：特别理解您的顾虑！其实很多老客户一开始也有类似想法，但上线后一个人能管 10 个窗口，当月就省掉一个客服的人工成本。
客户：那支持退换货或者试用吗？
顾问：支持的！我们提供专属保价和 7 天不满意退款保障，您可以放心。
`;

  const result = extractPlaybookFromChat(chat);
  assert.ok(result.suggestedQa.length >= 1);
  assert.ok(result.suggestedQa.some(qa => qa.question.includes('多少钱') || qa.question.includes('贵')));
  assert.ok(result.workflowGuidelines.length >= 2);
});

test('qualifyLeadFromText accurately qualifies customer intent and extracts phone, budget, and pain points', () => {
  const highIntentChat = '我看了你们的方案很认可，预算大概 3万，我手机号是 13812345678，微信号是 wx_vip999，今天怎么付款签合同？';
  const lead = qualifyLeadFromText('高意向客户-张总', highIntentChat);

  assert.equal(lead.intent, 'high');
  assert.equal(lead.phone, '13812345678');
  assert.equal(lead.wechatId, 'wx_vip999');
  assert.equal(lead.budget, '3万');
  assert.match(lead.nextStep!, /促成定金|收款码/);

  const complaintChat = '你们发的东西坏了，到底怎么处理？再不退款我直接投诉！';
  const complaintLead = qualifyLeadFromText('售后客户-李女士', complaintChat);
  assert.equal(complaintLead.intent, 'complaint');
});

test('Service endpoints for playbooks and leads install, extract, and record seamlessly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowdesk-playbook-test-'));
  const service = await createService({ dataDir: root });

  try {
    // 1. Get presets
    const presetsRes = await service.request({ method: 'GET', path: '/playbooks/presets' });
    assert.equal(presetsRes.ok, true);
    assert.equal(presetsRes.playbooks.length, 3);

    // 2. Install preset
    const installRes = await service.request({
      method: 'POST',
      path: '/playbooks/install',
      body: { packId: 'playbook_social_sales' },
    });
    assert.equal(installRes.ok, true);
    assert.ok(installRes.installedCount >= 4);

    const state = await service.request({ method: 'GET', path: '/state' });
    assert.ok(state.knowledge.some((k: any) => k.title.includes('破冰')));
    assert.ok(state.workflows.some((w: any) => w.name.includes('高情商')));

    // 3. Extract and auto-save
    const extractRes = await service.request({
      method: 'POST',
      path: '/playbooks/extract',
      body: {
        transcript: '客户：你们顺丰包邮吗？\n客服：是的亲，全场顺丰包邮极速发货！',
        autoSave: true,
      },
    });
    assert.equal(extractRes.ok, true);
    assert.ok(extractRes.result.suggestedQa.length >= 1);

    // 4. Qualify and record lead
    const qualifyRes = await service.request({
      method: 'POST',
      path: '/leads/qualify',
      body: {
        conversationName: '意向咨询-王经理',
        text: '咨询一下产品价格，预算 5000元，电话 13900001111，尽快联系。',
      },
    });
    assert.equal(qualifyRes.ok, true);
    assert.equal(qualifyRes.lead.phone, '13900001111');
    assert.equal(qualifyRes.lead.budget, '5000元');

    const leadsList = await service.request({ method: 'GET', path: '/leads' });
    assert.equal(leadsList.ok, true);
    assert.equal(leadsList.leads.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
