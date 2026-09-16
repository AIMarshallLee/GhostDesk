# Computer Use 可复用组件评估

后续实施：已选定 UI-TARS SDK 并接入 Windows 测试版，Mac 后续复用任务引擎、替换原生窗口层。当前实现与验收边界见 [Windows Computer Use 实现](Windows-Computer-Use实现.md)。下文保留选型时的调研快照，不代表最新包仍未安装 SDK。

核验日期：2026-09-14。依据官方文档、GitHub API 与固定提交源码。本轮完成选型核验和源码归档，没有安装或运行候选、调用模型、接触真实账号，也没有更新已交付的 ZIP。

## 结论

有完整 Agent 循环和 Windows 执行器可以复用，不必从头开发。FlowDesk 的 Electron/TypeScript 工程优先验证 `@ui-tars/sdk`；若优先支持国内通用工具调用模型，则评估 Windows-Use 的 Python sidecar。选型建议不代表其中任何一个已集成或在微信实测。

| 方案 | 可复用部分 | 模型和集成限制 | 定位 |
| --- | --- | --- | --- |
| [UI-TARS SDK](https://github.com/bytedance/UI-TARS-desktop/blob/main/docs/sdk.md) | `GUIAgent.run()` 完整截图/预测/解析/执行循环；可注入 `Operator` | Node/TS 易接现有 Electron；实验性 SDK；要求 UI-TARS 动作格式，普通兼容聊天接口不够 | 工程集成首选 |
| [Windows-Use](https://github.com/Jeomon/Windows-Use) | 完整模型/工具/观察循环，多供应商 provider | OpenAI provider 有 `base_url`，需模型支持 tools，视觉还需图片；Python sidecar，默认全桌面与较多工具 | 通用模型路线 |
| [Windows-MCP](https://github.com/CursorTouch/Windows-MCP) | Windows UIA、点击、输入、滚动、窗口工具，stdio MCP | 是工具服务，本身不负责完整模型循环；当前 Python >=3.14；默认工具需收窄 | 控件操作备选 |
| [Microsoft UFO](https://github.com/microsoft/UFO) | Windows 多 Agent、UIA/Win32/应用自动化 | Python 和原生依赖较多，完整工程比轻量 SDK 更重 | 深度 Windows 自动化备选 |
| [Agent S3](https://github.com/simular-ai/Agent-S) | `AgentS3`、`OSWorldACI`、视觉规划 | Python；另需 grounding 模型；默认动作代码与全屏观察应替换为受限接口 | 研究备选 |
| [Gemini Computer Use](https://ai.google.dev/gemini-api/docs/computer-use) | 模型规划与官方调用示例 | 当前 Gemini 3.x 已有 desktop 环境；客户端仍须执行动作并回传截图；普通 Chat Completions 不能替代专用协议 | 可选模型路线 |

原 `huashu-mac-use` 主线仍为 macOS；[Windows PR #1](https://github.com/alchaincyf/huashu-mac-use/pull/1) 本次 GitHub API 核验为 open、merged=false，不作为 Windows 首选。

## 具体复用接口

UI-TARS 的 `@ui-tars/sdk` 在审查提交中的版本为 1.2.3，提供 `GUIAgent`、`AbortSignal`、`onData/onError` 和循环上限。`@ui-tars/operator-nut-js` 提供现成键鼠执行器，也允许实现 `Operator.screenshot()` 与 `Operator.execute()`。FlowDesk 可以复用 SDK 循环，把已有截图与窗口身份校验接到自定义 WindowOperator。模型需为 UI-TARS/Doubao UI-TARS 或已经验证动作协议兼容的服务；[官方模型设置](https://github.com/bytedance/UI-TARS-desktop/blob/main/docs/quick-start.md) 明确区分解析类型。

Windows-Use 的 `windows_use/providers/openai/llm.py` 接受 `api_key` 和 `base_url`，`Agent.loop()` 已串起观察、工具调用和下一步。兼容服务必须真实支持 tool calling，不能只测一次聊天连接就标为可用。Windows-MCP 与 Windows-Use 都默认初始化遥测；如采用，sidecar 必须显式关闭遥测，并限制工具和窗口范围。

Gemini 官方参考仓库的当前 `BrowserAgent` 和 Playwright/Browserbase 执行器仍是浏览器实现；官网已支持 desktop，并不代表参考仓库已经附带可直接打包的 Windows 原生执行器。模型响应、执行器和完整 Agent 循环是三个不同的可复用层。

## 接入 FlowDesk 还需完成的工作

1. 增加 Computer Use 模型配置与能力验证，保留已有回复生成模型和客户自配 Key。
2. 将现有 `CaptureResult`、窗口身份校验连接到 SDK 的 observation/operator；每步校验目标，处理缩放和坐标。
3. 接入当前知识库与回复任务，保留人工复制和可选自动回复，增加运行/停止/人工接管状态。
4. 在自建页面上验证真实“截图→模型动作→点击/输入→新截图”循环、重复消息与异常恢复，再验证打包后的程序。真实模型验收和真实账号验收分别记录。

“仅粘贴不发送”是旧版实现现状，不是新需求的限制；用户已要求可选自动回复。测试授权仍只限自建页面和虚构消息。第三方默认全桌面权限不等于 FlowDesk 必须暴露全桌面操作。

## 固定源码快照与许可

| 项目 | 提交 | 上游许可 |
| --- | --- | --- |
| UI-TARS Desktop / SDK | `c2ad42e3eb9b27830db41a3e6f51ca7179d9b168` | Apache-2.0 |
| Windows-Use（Jeomon） | `0c24f9931feb42e293f49c7cc9c4c920d7e2cc37` | MIT |
| Windows-MCP | `787385ec5f9688b0e24f9759b3d505d7084ba80b` | MIT |
| Microsoft UFO | `be75a7ded2ad98d97819e15ff1b39d4202ac3ac5` | MIT |
| Agent-S | `3aa272d23d2994c7bbde1acbbe0ef8e8d06b8693` | Apache-2.0 |
| Gemini 官方示例 | `77c9797e943aad63bbc963b7fd092a9e51c07863` | Apache-2.0 |

采用时保留上游许可证与声明，并单独核对最终依赖及模型服务条款；这些许可不是具体模型或第三方账号使用授权。源码静态审查材料位于 `artifacts/computer-use-research/`，不会进入软件分发包。
