# FlowDesk 关键流程

| 流程 | 前提与边界 | 状态/副作用 |
| --- | --- | --- |
| 本地工作台请求 | 同源且持有本地 HttpOnly session；否则 HTTP 401 | 服务读写本地 JSON；无云账户 |
| 真实草稿生成 | 操作者确认 provider 与发送内容 | 服务向配置的 OpenAI-compatible endpoint 发请求；任务、启用知识和可选截图可能发送 |
| sandbox 自动回复 | 仅固定虚构会话、会话启用、队列运行 | rules 本地生成；live 只发送虚构文本；auto 仅记录模拟 assistant 消息 |
| 人工复制 | job 为 ready | 复制草稿并标记 copied，不执行外部发送 |
| opaque iframe | iframe token、父窗口来源和 sandbox 路径白名单均匹配 | parent relay 代发本地 sandbox 请求；clipboard 也由 parent 执行 |
| Windows 填入 | Electron main-frame IPC、目标 HWND/标题/PID/启动时间复核 | 复制/填入，不按目标应用发送键；本轮未做真实第三方验证 |

拒绝路径包括：无 session、未知 IPC/API 路径、iframe token 不符、live 未显式确认、会话已人工接管、窗口身份变化。自动队列遇到持久化失败会暂停而非继续投递。
