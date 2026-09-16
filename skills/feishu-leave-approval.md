---
id: skill_feishu_leave_approval
name: 飞书请假审批自动流转
description: 自动读取飞书工作台待办审批，比对考勤系统并执行自动化核准
version: 1.0.0
processes:
  - feishu.exe
  - chrome.exe
---

### Step 1: 打开飞书待办审批列表
- Target: feishu.exe
- Channel: ghost
- Action: 点击飞书左侧工作台【审批】图标，进入【待我审批】标签页
- Expect: 审批列表已呈现，包含至少一条待办项

### Step 2: 提取审批单关键信息
- Target: feishu.exe
- Channel: ghost
- Action: 点击首条审批详情，定位【申请人】、【请假类别】、【开始时间】与【请假天数】
- Expect: 详情抽屉展开，申请内容可被视觉定位与解析

### Step 3: 切换考勤核对系统
- Target: chrome.exe
- Channel: fast
- Action: 激活内部 HR SaaS 标签页，输入工号查询当月剩余调休/年假额度
- Expect: 人事系统页面返回可用额度数值，确认额度充足

### Step 4: 飞书审批执行通过
- Target: feishu.exe
- Channel: ghost
- Action: 返回飞书审批窗口，点击【同意】按钮并在理由框输入「系统已自动核验年假余额，核准通过」，回车确认
- Expect: 弹窗提示审批成功，该单移出待办列表
