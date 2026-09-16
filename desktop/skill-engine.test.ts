import test from 'node:test';
import assert from 'node:assert/strict';
import { SkillRegistry, BUILTIN_SKILL_ORDER_TO_EXCEL, type SkillDefinition } from './skill-engine';

test('skill registry initializes with builtin order_to_excel skill', () => {
  const registry = new SkillRegistry();
  const list = registry.list();
  assert.ok(list.length >= 1);

  const orderSkill = registry.get('skill_order_to_excel');
  assert.ok(orderSkill);
  assert.equal(orderSkill.name, '微信订单自动归档至 Excel');
  assert.deepEqual(orderSkill.requiredProcesses, ['wechat.exe', 'excel.exe']);
  assert.equal(orderSkill.steps.length, 4);
});

test('skill registry validates workspace application support', () => {
  const registry = new SkillRegistry();

  // Case 1: All required processes open
  const checkPass = registry.validateWorkspaceSupport('skill_order_to_excel', ['wechat.exe', 'excel.exe', 'chrome.exe']);
  assert.equal(checkPass.supported, true);
  assert.equal(checkPass.missing.length, 0);

  // Case 2: Missing excel.exe
  const checkFail = registry.validateWorkspaceSupport('skill_order_to_excel', ['wechat.exe']);
  assert.equal(checkFail.supported, false);
  assert.deepEqual(checkFail.missing, ['excel.exe']);
});

test('skill registry registers custom skills and rejects invalid ones', () => {
  const registry = new SkillRegistry();

  const customSkill: SkillDefinition = {
    id: 'custom_feishu_doc',
    name: '飞书文档同步',
    description: '自动同步文档',
    version: '1.0.0',
    requiredProcesses: ['feishu.exe'],
    steps: [
      {
        id: 's1',
        name: '读取文章',
        targetProcess: 'feishu.exe',
        instruction: '复制全部文字',
        expectedOutcome: '完成复制',
      },
    ],
  };

  registry.register(customSkill);
  assert.equal(registry.get('custom_feishu_doc')?.name, '飞书文档同步');

  // Invalid: missing steps
  assert.throws(
    () =>
      registry.register({
        id: 'bad_skill',
        name: 'Bad',
        description: 'None',
        version: '1.0.0',
        requiredProcesses: ['app.exe'],
        steps: [],
      }),
    /must declare at least one step/,
  );
});
