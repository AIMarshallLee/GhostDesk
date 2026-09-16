# FlowDesk 架构

FlowDesk 是单用户本地工作台和 Windows x64 测试客户端；当前自动回复只作用于三个虚构 sandbox 会话。

| 层 | 当前实现 |
| --- | --- |
| UI | React/Vite；公开落地页和本地工作台 |
| 本地服务 | Node HTTP 服务，仅监听 127.0.0.1；JSON 状态落盘 |
| Windows | Electron，context isolation、renderer sandbox、受限 IPC |
| 模型 | OpenAI Chat Completions 兼容接口；返回纯文本草稿 |

浏览器 API 先通过本地 HttpOnly 会话；Electron renderer 只能调用 preload 暴露的白名单。嵌入式模拟器是 opaque iframe，经带 token 的 parent relay 访问限定 sandbox 接口，不能直接访问服务或宿主 DOM。

自动回复队列仅写本地 sandbox JSON；规则模式使用固定资料，live 模式只发送虚构会话文本给已配置 provider。没有系统定时任务，因此没有 cron.md。

Windows 内嵌页使用受限的 flowdesk 静态协议，网页使用带 SHA-256 CSP 的 srcDoc；两者都保持 opaque iframe。2026-09-14 打包与最终 ZIP 解压启动检查通过；USB UI 已隐藏但归档后端代码仍在，未测试真实账号或另一台电脑。

相关文档：[流程](flows.md) · [权限](permissions.md) · [变量](variables.md) · [自动化](automation.md) · [SEO](seo.md) · [测试](tests.md) · [现有验收记录](../docs/验收记录.md)
