# FlowDesk 自动化边界

| 自动化 | 触发 | 可读输入 | 可调用能力 | 结果与停止条件 |
| --- | --- | --- | --- | --- |
| rules sandbox | 虚构客户消息入队 | 三个固定会话和固定测试规则 | 本地队列、模拟消息记录 | pause/stop/人工接管/会话禁用 |
| live sandbox | 显式允许且 provider 已配置 | 仅虚构客户文本 | OpenAI-compatible chat completion | 纯文本回复；不会读取 tasks/knowledge |
| 任务草稿 live | 操作者确认 | 当前任务、启用知识、可选截图 | OpenAI-compatible chat completion | 返回待审核草稿；不等于外部发送 |

硬保护不依赖模型提示：API/IPC 白名单、iframe relay token、消息长度限制、delivery key 去重、持久化失败暂停、人工接管和窗口身份复核。

自动回复的发送只写本地模拟器 assistant 消息。没有 webhook、后台 worker、计划任务或真实平台账号工具。Gemini CU 与 Antigravity CLI 未接入。
