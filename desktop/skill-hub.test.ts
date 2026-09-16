import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SkillHubManager } from './skill-hub';

test('SkillHubManager parses markdown skill with frontmatter and steps', () => {
  const hub = new SkillHubManager();
  const md = `---
id: skill_test_export
name: 自动批量导出报表
description: 批量导出 ERP 报表并另存至本地
version: 1.2.0
processes:
  - erp.exe
  - chrome.exe
---

### Step 1: 打开查询界面
- Target: erp.exe
- Channel: ghost
- Action: 点击菜单栏【统计分析】->【日报表导出】
- Expect: 导出配置弹窗已就绪

### Step 2: 确认导出路径
- Target: chrome.exe
- Channel: fast
- Action: 快捷键 Ctrl+S 保存至临时目录
- Expect: 文件下载完成
`;

  const skill = hub.parseSkillMarkdown(md);
  assert.equal(skill.id, 'skill_test_export');
  assert.equal(skill.name, '自动批量导出报表');
  assert.equal(skill.description, '批量导出 ERP 报表并另存至本地');
  assert.equal(skill.version, '1.2.0');
  assert.deepEqual(skill.requiredProcesses, ['erp.exe', 'chrome.exe']);
  assert.equal(skill.steps.length, 2);

  assert.equal(skill.steps[0].name, '打开查询界面');
  assert.equal(skill.steps[0].targetProcess, 'erp.exe');
  assert.equal(skill.steps[0].channelPreference, 'ghost');
  assert.equal(skill.steps[0].instruction, '点击菜单栏【统计分析】->【日报表导出】');
  assert.equal(skill.steps[0].expectedOutcome, '导出配置弹窗已就绪');

  assert.equal(skill.steps[1].channelPreference, 'fast');
});

test('SkillHubManager parses inline bracket processes and fallback id', () => {
  const hub = new SkillHubManager();
  const md = `---
name: WeChat Message Sender
processes: [wechat.exe]
---

### Step 1: Send greeting
- Action: Send Hello World
`;

  const skill = hub.parseSkillMarkdown(md);
  assert.equal(skill.id, 'skill_wechat_message_sender');
  assert.equal(skill.name, 'WeChat Message Sender');
  assert.deepEqual(skill.requiredProcesses, ['wechat.exe']);
  assert.equal(skill.steps.length, 1);
  assert.equal(skill.steps[0].instruction, 'Send Hello World');
});

test('SkillHubManager rejects invalid markdown missing name or steps', () => {
  const hub = new SkillHubManager();

  // Missing name
  assert.throws(() => {
    hub.parseSkillMarkdown(`---
description: No name
---
### Step 1
- Action: click
`);
  }, /Missing name in frontmatter/);

  // Missing steps
  assert.throws(() => {
    hub.parseSkillMarkdown(`---
name: No steps
---
Just some text without steps.
`);
  }, /Must contain at least one step/);
});

test('SkillHubManager loads markdown skill files from directory', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostdesk-skills-'));
  try {
    const file1 = path.join(tempDir, 'skill1.md');
    fs.writeFileSync(
      file1,
      `---
id: skill_one
name: Skill One
processes: [notepad.exe]
---
### Step 1: Write text
- Action: Type text
`
    );

    const file2 = path.join(tempDir, 'skill2.md');
    fs.writeFileSync(
      file2,
      `---
id: skill_two
name: Skill Two
processes: [calc.exe]
---
### Step 1: Calculate
- Action: Press 1 + 1 =
`
    );

    const hub = new SkillHubManager(tempDir);
    const skills = hub.list();
    assert.equal(skills.length, 2);
    assert.ok(hub.get('skill_one'));
    assert.ok(hub.get('skill_two'));
    assert.equal(hub.get('skill_one')?.name, 'Skill One');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('SkillHubManager successfully loads actual skills/ directory', () => {
  const actualSkillsDir = path.resolve(process.cwd(), 'skills');
  if (fs.existsSync(actualSkillsDir)) {
    const hub = new SkillHubManager(actualSkillsDir);
    const skills = hub.list();
    assert.ok(skills.length >= 3, `Expected at least 3 skills, got ${skills.length}`);
    assert.ok(hub.get('skill_feishu_leave_approval'));
    assert.ok(hub.get('skill_tax_invoice_export'));
    assert.ok(hub.get('skill_xiaohongshu_lead_capture'));
  }
});

