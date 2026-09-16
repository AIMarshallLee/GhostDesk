# Windows Computer Use 实现与选型

决定：FlowDesk 保留 `@ui-tars/sdk@1.2.3` 的单任务 UI-TARS/Doubao 路径，并在 0.6 新增 `@google/genai@2.22.0` 的 Gemini 原生 Interactions desktop Computer Use。两条路径共用 FlowDesk 的受限 Windows/Pico 驱动、窗口选择、知识范围、停止与人工确认边界；没有把 UI-TARS Desktop 或 Antigravity 独立应用塞进产品。

选择依据：现有工程为 Electron/TypeScript，SDK 可直接打包且不要求客户安装 Python；支持客户自配兼容模型端点。Windows-Use 的 Python Agent 可作为未来通用 tool-calling 模型路线，Windows-MCP 只是工具层。huashu-mac-use 暂作为未来 Mac 原生能力参考。详细候选与固定源码见 [复用评估](Computer-Use复用评估.md)，上游接口见 [官方 SDK 文档](https://github.com/bytedance/UI-TARS-desktop/blob/main/docs/sdk.md)。

## 0.5 当前输入边界

Pico USB HID 在协议 4 下支持中文逐键全拼：`pinyin-pro@3.29.4` 将待输入中文转为全拼，`Intl.Segmenter` 划分词段；逐键下发期间检查前台窗口和取消状态，词段完成后读取已选择、前台窗口自己的屏幕矩形，视觉模型转写当前 composition 与带数字的候选页，匹配精确候选后发送对应数字。此路径不使用剪贴板、粘贴或 Enter，也不会根据预期回复伪造候选。

使用条件是全拼、Shift 中英切换、数字选词与 PageDown 翻页；开始时输入框为空，且候选页必须完整位于最大化目标窗口内。emoji、多行、双拼和五笔不支持。失焦、候选页不完整、视觉置信不足、取消或未提交拼音时停止，草稿由人工清理后再恢复。微软、微信、搜狗、百度是首批适配目标；自建 fixture 的四种样式仅用于模拟，不构成品牌实机兼容结论。

## 接入范围

- `desktop/computer-use.ts`：GUIAgent + Operator，UI-TARS 1.5 / Doubao UI-TARS 1.5、知识注入、人工草稿/自动执行、最多 25 轮、取消、无执行重试。没有引入另一套自研视觉规划循环。
- `desktop/cu-windows.ts` / `cu-native.ps1`：选定 HWND/PID/进程启动时间/标题/尺寸，PrintWindow 只截目标窗口，前台与命中窗口校验。旧 Unicode 软件输入、受限按键和点击/滚动仅保留为内部兼容与测试实现，不是 0.6 面向用户的生产执行器；生产启动必须经 Pico USB HID。没有全桌面截图回退。
- `desktop/cu-settings.ts` / `cu-ipc.ts` / `src/ComputerUse.tsx`：独立模型配置、safeStorage 密钥、明确选择窗口和知识、开始前展示数据接收接口、运行/停止和草稿复制。配置改变未保存时不可开始，换端点清除旧 Key。
- `desktop/cu-fixture.ts` / `cu-smoke.ts`：应用自身虚构聊天窗口；Electron 窗口截图和局部输入，不调用全局 OS 输入。固定本机模型回复验证真正的 SDK 协议循环。
- 构建分发 SDK 和依赖的许可证；补齐 SDK 上游遗漏的 uuid 运行依赖。详见 [依赖审查](Computer-Use依赖.md)。

客户的普通 OpenAI 兼容接口仍用于原来的回复生成功能；既有 UI-TARS/Doubao 电脑操作路径仍要求指定动作格式。Gemini 路径使用 Gemini API Key 和原生 Interactions API，不接受 OpenAI 兼容 `/v1beta/openai` 地址，也不是 Antigravity OAuth。`gemini-3.8-flash` 是可编辑示例名，账户是否实际支持须由用户验证。官方资料见 [Gemini Interactions API](https://ai.google.dev/gemini-api/docs/interactions-overview)、[Computer Use](https://ai.google.dev/gemini-api/docs/computer-use) 与 [JavaScript SDK 入门](https://ai.google.dev/gemini-api/docs/get-started)。

## 0.6 Gemini 原生 Computer Use

- Gemini 请求仅在 Electron 主进程通过 `@google/genai@2.22.0` 的 `interactions.create` 发出，使用原生 `v1beta` Interactions 接口，设置 `store: false`；Key 仍由 Electron 安全存储管理，不进入 renderer、导出或配置文件。
- FlowDesk 将模型函数调用限制为所选窗口内的移动、点击、单行输入、受限按键、滚动、等待和截图；不允许切窗、剪贴板、Shell、外部工具或凭据动作。模型要求确认时，整批动作先停在 `awaiting_confirmation`，展示原因与拟执行动作；确认期间允许停止，不允许修改设置或重新开始。
- 匹配固件的 Pico USB HID 是启动 Computer Use、持续回复和审核后逐键填入的必要硬件，自动与人工草稿模式均不例外；断开或异常会停止，绝不回退 Windows 输入。Pico 的协议和固件保持 0.5.0/4；Gemini 模式以同一 Gemini API Key 的模型读取输入法候选词，不增加第二个普通视觉模型设置。离线时仅可管理配置或查看烧录说明。
- `#desktop-replies` 的持续多会话监听、生成队列和发送状态机仍使用既有独立引擎，并未迁移到 Gemini；0.6 Gemini 只扩展单任务 `#computer-use`。

## 验收层次

1. 代码检查：现有业务测试、新增 SDK 假模型闭环、取消、手动零写、坐标与原生驱动模拟守卫、Key 隔离；0.6 Gemini core 单元测试 31 项、controller 单元测试 3 项已通过，核心 mock smoke 已通过。
2. 本机 EXE：使用隔离 userData；截图本应用虚构测试窗口，4 次回环模型响应、3 个 GUI 动作、恰好 1 次模拟发送。没有用截图识别成功来冒充真实模型能力。
3. 分发包：打包脚本必须通过原模拟器启动检查和新增 Gemini smoke 才能替换上一份 ZIP；本轮 186 项测试、打包、Gemini smoke 和独立解压检查已通过，见 Windows-Gemini-0.6-验收记录。
4. 待验收：客户所选真实动作模型的识别/响应质量、Windows 原生窗口实际兼容性、第二台电脑和 Mac。

本轮所有开发测试只使用虚构窗口和本机模型 stub，未读取、截图或操作微信及真实账号。

## 桌面持续回复

历史 0.5.0 记录的软件控制 Pico USB HID 执行器沿用窗口观察、知识与回复状态机，通过协议 4 的串口会话执行鼠标、滚动、受限按键与逐键全拼。0.6 起匹配 Pico 是启动持续回复及单任务 Computer Use 的必要条件，USB 故障或断开会停止任务，不存在 Windows 软件输入降级。USB 中文不使用剪贴板、Ctrl+V 或 Enter；自动回复的提交点击仍通过 USB。当前到货步骤见 [Pico 烧录与测试](Pico-到货烧录与测试.md)。

`#desktop-replies` 是与单次 UI-TARS 任务分开的 Windows 视觉监听接口。它用五个归一化区域校准会话列表、标题、消息、输入框和发送按钮；主进程串行轮询配置中名称唯一的会话。首次观察只保存基线，后续通过消息尾部重叠识别新增消息，不能证明连续性、发现新的人工发出消息、失焦或窗口变化时交人工。

自动模式只对确认的新消息生成并发送；人工模式只产生可复制草稿。每个任务保存生成状态、知识/工作流快照摘要和发送意图；输入前持久化为 `sending`，视觉确认出现对应发出消息后才标记为 `visually_confirmed`。结果不明确、发送中断或上下文过期时会禁用该会话并标为人工处理，绝不自动重试发送。

暂停、锁屏、休眠、模式或配置变更、人工接管会取消在途工作。程序重启默认暂停，清除观察基线，旧生成/待发送任务交人工；不会自动启动监听。持久化失败时 fail-closed，后续轮询和输入停止。SDK 只提供 GUIAgent 与动作解析，客户消息检查点、队列、发送状态机、持久化和人工守卫由 FlowDesk 新增实现。

当前 0.5 开发验证继续限定在 Node 回归、隐藏的自建虚构窗口、虚拟 USB、虚构输入法候选页和本机 loopback 模型。逐键全拼的模型读取使用真实 fixture PNG 与 `ImeScene`，但不调用真实模型、系统输入法、微信或真实账号。0.5 Windows 分发包已通过构建和独立解压检查，具体结果见《Windows-USB-0.5-验收记录》；客户 API、目标应用版本、显示缩放、多屏、实体板和真实输入法兼容性均需单独验收。

窗口激活之后使用 `SendMessageTimeout(WM_NULL)` 等待目标窗口处理异步激活，再检查前台归属；失败仍停止。依据 [Microsoft 对跨线程前台激活的说明](https://devblogs.microsoft.com/oldnewthing/20161118-00/?p=94745)，不使用全局快捷键或附加输入队列绕过前台检查。
