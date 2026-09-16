# Windows Gemini 0.6 验收记录

日期：2026-09-15。范围：FlowDesk 0.6 的 Gemini 原生 Interactions desktop Computer Use、人工确认、Pico 候选词识别复用同一 API Key，以及必须连接匹配 Pico 才能启动业务功能的约束。

## 已确认的本地证据

- `@google/genai@2.22.0` 已作为项目依赖固定；实现通过该官方 SDK 的原生 Interactions API 发出单任务 Computer Use 请求。
- 全量 `npm test`：186/186 通过；其中 Gemini core 31 项、controller 3 项、真实 IPC 注册模块的硬件等待/取消场景 12 项。日志：`artifacts/windows-gemini-0.6-tests.log`。
- 使用官方 SDK 连接本机模型替身，验证实际渲染 PNG、完整对话步骤和签名回传、函数调用 ID、确认后的 acknowledgement、手动模式不执行输入、虚拟 Pico 中文逐键输入。
- 没有调用真实 Gemini API、真实账号、真实窗口截图或真实系统输入法；测试使用 FlowDesk 自建虚构窗口、测试驱动或 stub。

## 当前行为边界

- Gemini 使用 Gemini API Key，不是 Antigravity OAuth。`gemini-3.8-flash` 是默认示例模型名，是否可用取决于账户支持与配额。
- Gemini 配置使用原生接口根地址，不使用 OpenAI 兼容 `/v1beta/openai` 路径。Key 不写入公开状态、配置文件或导出。
- 模型要求确认时，任务进入“等待确认”；界面展示原因与动作。确认前可以停止，但不能改设置或重启。匹配 Pico USB HID 是启动任务的必要条件，自动与人工草稿模式都一样；USB 失败不回退到 Windows 软件输入。
- Pico 固件保持 0.5.0、协议 4；已有匹配的 0.5 固件无需为 0.6 重新烧录。Gemini 模式用相同 Gemini API Key 的模型读取输入法候选词，不另设普通视觉模型。
- 桌面持续回复的多会话监听、生成队列和发送状态机仍是既有独立引擎；本记录不证明它已切换到 Gemini。
- 后台启动检查主动查询 USB 状态，要求 FlowDesk USB Bridge、Pico、协议 4 和固件 0.5.0；不依赖界面按钮或缓存的 connected 字段。旧 Windows 执行配置会拒绝启动，旧软件粘贴 IPC 固定拒绝。
- 电脑操作和持续回复运行时串行检查硬件，发现断开会停止任务；普通模型生成在请求前及返回后检查硬件，离线返回的回复不保存。普通 HTTP 请求不会在拔出瞬间被撤回。
- 等待硬件检查期间，停止、暂停、锁屏、休眠、USB 停止、配置修改和退出会使待启动请求失效。失败的配置请求不会撤销当前硬件监控，旧监控的迟到错误不能停止后续任务。
- 离线可管理资料、设置、查看烧录说明及体验明确标注的本地演示。以上约束针对分发的 Windows 客户端；开发用服务、模型替身和虚构窗口测试保持依赖注入。

## 模型与输入限制

Google 当前仍将 Computer Use 标为 Preview，接口接入不等于真实模型质量验收。资料：[官方 Computer Use](https://ai.google.dev/gemini-api/docs/computer-use)、[官方 JavaScript SDK](https://github.com/googleapis/js-genai)。

单任务最多 25 个动作、180 秒；单请求 30 秒，不自动重试模型或输入操作。原生 SDK 在解析后才实施响应保留体积限制，不能将其描述为网络解析前限流。确认后会重新聚焦并最多采样五次，只有原画面严格重现才继续；持续变化会停止。动作后等待界面刷新再截图，不能将等待或模型结束当作真实发送回执。

Pico 输入保留 0.5 的全拼、数字选词、Shift 中英切换和完整候选页条件；微软/微信/搜狗/百度四种模拟样式通过，不代表真实品牌输入法已验收。固件没有变化。

## 本轮验证

| 项目 | 状态 | 证据位置/结果 |
| --- | --- | --- |
| 全量 `npm test` | 通过 | 186/186，见测试日志 |
| `npm run build` | 通过 | TypeScript 与 Vite 生产构建 |
| `npm run package:win` | 通过 | 0.6.0；包含五类包内检查，见打包日志 |
| Gemini 专用 smoke（仅 FlowDesk 虚构窗口与 stub） | 通过 | 原生规划 5 请求/11 图片附件/1 次确认/3 输入动作/1 次虚构发送；手动模式 0 输入；另通过原生 IME + 虚拟 USB |
| 分发包独立解压与启动 | 通过 | `scripts/verify-portable.mjs`；250 个运行文件逐字节一致、375 个 ASAR 条目白名单；五类检查全部通过 |
| 实体 Pico、真实 Windows 输入法及目标应用 | 待验收 | 需单独授权和实机记录 |
| Gemini API 账户模型可用性、配额和真实请求质量 | 待验收 | 需用户账户和明确授权 |

本记录不以 0.3、0.4 或 0.5 的历史验收替代 0.6 结果，也不把本地单元测试表述为部署、客户使用、模型可用性或外部发送成功。

## 初次 0.6 分发记录（历史）

- 文件：`release/FlowDesk-win32-x64.zip`，163,776,598 字节（约 156.2 MiB），版本 0.6.0，未代码签名。
- ZIP SHA-256：`7137636b366c015e5ee2c2bea21981e5dbf967a206889dfb0d06ff8ef22a97ae`。
- 固件：0.5.0 / 协议 4，76,800 字节、150 个 RP2040 UF2 块；与上一版本固件相同。
- 固件 SHA-256：`722545026e55cc8a3c89ed02c7e598cf4b40a8620915c9d3e2435d863f32ec8d`。
- 验证时间：`2026-09-15T10:07:41.190Z`。机器记录：`artifacts/portable-verification.json`；校验文件：`release/FlowDesk-win32-x64.zip.sha256`。
- 五类包内及新目录检查：主界面/受限 IPC/无硬件启动拒绝、既有 UI-TARS、Gemini 原生、持续回复、虚拟 USB。Gemini 原生检查包含原生 IME 接口的 145 张虚构输入法截图、168 个 ASCII 键字符、45 个输入法控制键和四种虚构候选样式。
- 本机 C 盘临时空间不足后，将本次构建与解压验证进程的 TEMP/TMP 指向项目 `artifacts/package-temp`；没有修改系统环境变量。最终以以上成功记录为准。

## Windows 11 支持范围更新后的分发记录

2026-09-15 用户确认当前只支持 Windows 11 x64；先完成 Windows 实机验收并修复问题，再销售已验收的 Windows 版本，同时开发 Mac。已同步官网、下载弹窗、使用说明、Pico 到货说明和项目记录；本次只更新支持范围与文案，没有新增系统拦截或更改执行逻辑。

- 当前文件：`release/FlowDesk-win32-x64.zip`，163,776,101 字节，版本仍为 0.6.0。此包替代上节同名 ZIP，旧包和旧机器记录已保留。
- ZIP SHA-256：`5914a8f5c7ff1d5e2f7584a6f062df078b47022ee71f8680989e4faa1cac5e8b`。
- 验证时间：`2026-09-15T11:43:04.319Z`；当前机器记录仍为 `artifacts/portable-verification.json`。
- `npm run package:win` 通过，包含类型检查、网页和桌面构建，以及五类包内启动/虚构窗口检查；独立解压验证通过，250 个运行文件一致、375 个 ASAR 条目白名单、随包使用说明和烧录说明与源码一致。日志：`artifacts/windows11-scope-package.log`、`artifacts/windows11-scope-portable.log`。本次未重复运行此前 186 项单元测试。
- 本机检查环境：Windows 11 家庭版中文版，版本 `10.0.26200`，64 位；实体 Pico、另一台电脑和真实模型仍未验收。Pico 固件、协议及固件 SHA-256 均未变化。
