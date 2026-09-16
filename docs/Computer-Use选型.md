# Computer Use 选型核验

后续完整候选比较与 SDK 接入建议见 [2026-09-14 Computer Use 复用评估](Computer-Use复用评估.md)。本文保留此前实现与审查快照。

核验日期：2026-09-13。本次只读检查，不安装第三方 Skill，不调用其输入功能。以下内容保留为当日审查快照。

## huashu-mac-use

用户提供的仓库是 [alchaincyf/huashu-mac-use](https://github.com/alchaincyf/huashu-mac-use)。主分支为 macOS Swift/AppKit 实现，不能直接在 Windows 上运行。它提供桌面操作工具，任务推理由调用它的 Agent 完成。

[Windows PR #1](https://github.com/alchaincyf/huashu-mac-use/pull/1) 在本次 GitHub API 核验时仍为 open、非 draft、merged=false。头提交是 `d92425c3e339acdbc0ff59c49647b96e3deb9e62`，来自 `Tyleraltight:feat/windows-support`；14 个文件，2 次提交。仅见 GitGuardian 成功，没有 Windows/.NET 构建或行为回归通过的证据。作者在 Windows 11、微信等应用上的测试描述属于作者自报。

| 源码能力 | 与 FlowDesk 的关系 |
| --- | --- |
| [PrintWindow / BitBlt 截图](https://github.com/Tyleraltight/huashu-mac-use/blob/d92425c3e339acdbc0ff59c49647b96e3deb9e62/scripts/win/CaptureEngine.cs#L46) | 可参考后台窗口捕获与空图检测；它本身没有视觉模型 |
| [UI Automation](https://github.com/Tyleraltight/huashu-mac-use/blob/d92425c3e339acdbc0ff59c49647b96e3deb9e62/scripts/win/UIAutomationEngine.cs#L122) | 可作为未来控件识别与读回适配器；需要逐应用验证 |
| [SendInput / PostMessage](https://github.com/Tyleraltight/huashu-mac-use/blob/d92425c3e339acdbc0ff59c49647b96e3deb9e62/scripts/win/InputSimulator.cs#L51) | 属于软件输入，不能代替 Pico 的 USB HID 固件；部分调用未检查返回值 |
| [安全闸与 force](https://github.com/Tyleraltight/huashu-mac-use/blob/d92425c3e339acdbc0ff59c49647b96e3deb9e62/scripts/win/Program.cs#L39) | 需要保留我们自己的审核、精确窗口身份和物理激活约束，不能直接透传 force |

该 Windows 分支使用 .NET 9、WindowsForms/WPF，项目文件没有额外 PackageReference；仓库标注 MIT。若未来实际采用源码，需要保留版权和许可文本并完成独立编译、非敏感窗口测试。

## 2026-09-13 审查快照：本版实际实现

FlowDesk 0.1 的完整操作流程是：单次选择窗口/导入图片 → 裁剪 → 配置模型和知识 → 起草回复 → 修改与审核 → 复制或软件/硬件填入原窗口。

本版没有自动寻找聊天对象、连续规划点击、无人值守发送的通用 Computer Use Agent。OpenAI 兼容视觉接口只提供截图理解和草稿生成；接入该接口不等于已经接入 Gemini 的专用 Computer Use 协议。

若扩展连续操作，仍需实现独立的任务状态、动作模式校验、执行前目标校验、执行后观察、失败恢复与人工接管。截图发生变化或底层 API 返回成功，不能单独证明业务操作正确。

本次决定：保持现有三端的可交付路径，将该 PR 作为后续 Windows 适配器候选，不作为当前发行包的运行依赖。

## 当前决定（2026-09-14）

当前发行方向为 Windows 纯软件优先与官网工作台。硬件 USB HID 仅保留为 `firmware/` 下的独立实验源码，不是 Windows 包的必要组件，也不随新 Windows 包分发。

回复模式实验室只在本地虚构聊天模拟器中提供自动回复或人工复制回复。规则模式不调用 AI；真实模型模式只向已配置的 OpenAI 兼容接口发送虚构测试文本，不读取业务知识或真实任务。

仍未实现或验证任意 Windows 应用的持续 Computer Use、真实微信自动发送，或规避平台风控/防封能力。没有此类能力的实机或第三方平台证据。
