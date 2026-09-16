---
id: skill_xiaohongshu_lead_capture
name: 小红书私信高意向线索归档
description: 监听小红书创作者中心私信互动，提取意向客户联系方式并实时推送到微信销售群
version: 1.0.0
processes:
  - chrome.exe
  - wechat.exe
---

### Step 1: 巡检小红书私信中心
- Target: chrome.exe
- Channel: fast
- Action: 点击创作者后台顶部【消息中心】->【私信】标签，筛选【未读消息】与【意向咨询】
- Expect: 私信会话列表展示最新的咨询记录

### Step 2: 视觉语义识别联系方式
- Target: chrome.exe
- Channel: ghost
- Action: 遍历会话对话流，提取客户发送的 11 位手机号码或微信 ID，并截取咨询的商品意向
- Expect: 成功捕获意向客户名、联系方式及咨询诉求

### Step 3: 激活微信销售跟进窗口
- Target: wechat.exe
- Channel: fast
- Action: 快捷键 Ctrl+F 搜索「高意向线索跟进群」，回车进入会话
- Expect: 微信聊天焦点定位在销售群输入框

### Step 4: 格式化推送线索卡片
- Target: wechat.exe
- Channel: ghost
- Action: 粘贴格式化线索「【小红书新线索】客户：{user} 手机/微信：{contact} 意向：{inquiry} 请及时跟进！」，回车发送
- Expect: 销售群成功接收新线索通知气泡
