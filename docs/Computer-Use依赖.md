# Computer Use 运行依赖审查

审查日期：2026-09-15。范围包括 `@ui-tars/sdk@1.2.3`、`pinyin-pro@3.29.4` 及本轮新增的 Google 官方 `@google/genai@2.22.0`；未运行 Computer Use、截图、原生自动化、系统输入法或任何真实账户操作。

## 结论与接入约束

- `@ui-tars/sdk@1.2.3` 的 `dist/GUIAgent.mjs` 导入 `uuid`，其自身 `package.json` 却未声明该依赖。FlowDesk 已显式固定 `uuid@11.1.0`（MIT），消除了当前构建的模块解析阻断；升级 SDK 时仍须复核该上游依赖声明。
- SDK 默认将 `logger` 设为 `console`，并记录 `JSON.stringify(this.model)`；其中包含 `modelConfig.apiKey`。还会记录模型预测、动作参数、错误；Responses API 分支还记录请求输入和服务返回。必须注入仅保留枚举状态与耗时的脱敏 logger，禁止记录 model config、API key、headers、任务正文、历史或截图。
- `onData` 的每个截图 delta 含 `screenshotBase64`。SDK 每轮会将图片发到配置的模型端点，模型请求带任务、最近 30 条历史和最近最多 5 张图片。不得将该回调原样持久化、写日志或跨进程暴露给 renderer。
- 网络请求在 `GUIAgent.run()` 后才发生：默认是所配置 `baseURL` 的 Chat Completions；`useResponsesApi` 还会调用 Responses 的创建和删除接口。静态检查未发现 UI-TARS SDK 自身的遥测或更新端点。应由 controller 验证 API URL、只允许 HTTPS，并将 `useResponsesApi` 设为 `false`，避免删除远端响应记录。
- 必须只在 Electron **主进程**使用。SDK 路径依赖 Node 的 `Buffer` 与 Jimp；其 OpenAI 客户端在浏览器环境默认拒绝携带 API key。不要在 renderer/preload 中导入，不要设置 `dangerouslyAllowBrowser`。当前 `scripts/build-desktop.mjs` 使用 `esbuild` 的 `platform: 'node'`、`target: 'node20'`、CJS bundle；Jimp 1.6.0 要求 Node >=18，故目标版本满足。SDK/Jimp 的依赖图未见需安装脚本生成的原生二进制；当前 `ignore-scripts` 安装不构成此处阻碍。
- SDK 的 `stop()` 只设内部标记，不能中断正在进行的模型请求；controller 必须同时调用所属 `AbortController.abort()`。终止后 finally 仍会调用一次 `operator.execute(action_type: 'user_stop')`。此外 `finished()`、`call_user()` 在 SDK 标记状态前也会调用 `execute()`；自定义 WindowOperator 必须将这三种伪动作做成无副作用 no-op。`pause()` 只会在下一轮开始时生效，不能用于拦截正在等待模型的动作。
- `stop()` 设置的 `isStopped` 不会在下一次 `run()` 前复位；停止过的 `GUIAgent` 不可复用。每个 FlowDesk run 都应新建 GUIAgent、AbortController 与 WindowOperator。
- 默认三类重试均为 0。保持为 0：`retry.execute` 会重放相同输入/点击，`retry.model` 在首次失败时已将内部状态标记 `ERROR`，即使后续重试成功仍可能执行一次动作后以错误终态结束。

## Gemini 原生依赖

- `@google/genai@2.22.0` 是 Google 官方 JavaScript SDK，许可证为 Apache-2.0，运行时要求 Node >=20；FlowDesk 只在 Electron 主进程导入其 Node 导出，不在 renderer/preload 中导入。
- FlowDesk 使用 SDK 的原生 Interactions API 和 `interactions.create`，配置 Gemini API Key 及原生根地址；这不是 OpenAI 兼容 API，也不是 Antigravity OAuth。请求设置 `store: false`，并由主进程限制请求/响应尺寸、30 秒请求超时、无重试和中止信号。
- SDK 的 Computer Use 返回不能视为已执行证据。FlowDesk 先校验函数调用、坐标、参数和安全决定；遇到 `require_confirmation` 时将整批动作交给本地人工确认，再在选定窗口内重新聚焦、复核并执行。取消、超时、格式错误或画面变化均停止，不重试写入。
- `gemini-3.8-flash` 仅作为设置页示例模型名；可用模型和配额取决于用户 Gemini API 账户。官方接口资料：[Interactions API](https://ai.google.dev/gemini-api/docs/interactions-overview)、[Computer Use](https://ai.google.dev/gemini-api/docs/computer-use)、[SDK 入门](https://ai.google.dev/gemini-api/docs/get-started)。
- Pico 逐键中文输入在 Gemini 模式复用相同 Gemini API Key 创建只读候选词识别请求，不增加普通视觉模型的第二份凭据。匹配 Pico USB HID 是启动 Computer Use、持续回复及审核后逐键填入的必要条件，自动与人工草稿模式都一样；USB 失败不回退软件输入，固件仍为 0.5.0 协议 4。

## 拼音依赖

`pinyin-pro@3.29.4` 仅在主进程的虚构测试 fixture 与 Pico 逐键全拼路径中把待输入中文转换为拼音；它不访问网络、窗口、剪贴板或 API Key。词段划分使用运行时内置的 `Intl.Segmenter`，不新增第三方包。`pinyin-pro` 为 MIT，源码和许可证来源：[zh-lx/pinyin-pro](https://github.com/zh-lx/pinyin-pro)。升级时应复核版本、许可证和随包文件。

## 随 Windows 包保留的许可证

FlowDesk 当前已落实：全静音 SDK logger；模型原始输出在进入会直接 console.error 的上游 parser 前验证格式与单动作；单次输出最多 2048 tokens；每轮单动作失败即锁定；取消信号贯穿原生 helper；截图仅驻留内存且不随 IPC 状态发送。模型兼容性仍需以用户选定服务实测，不能由本机 stub 测试推断。

当前构建会把主进程依赖 bundle 到 `desktop-build/main.cjs`，所以不需要把 `node_modules` 放入 ZIP；但许可证与版权声明仍需随软件分发。`scripts/runtime-licenses.mjs` 现递归读取实际 `node_modules` 的 `dependencies` 与 `optionalDependencies`，仅复制每个运行包的 LICENSE/COPYING/NOTICE 原文，并生成 `desktop-build/licenses/runtime-manifest.json`。打包和便携验证都从该 manifest 的 allowlist 复制或校验；不会盲拷 `node_modules`。下列清单包含 SDK 本体和其已安装传递运行依赖，以及 FlowDesk 显式固定的 `uuid@11.1.0` 与 `pinyin-pro@3.29.4`。

| 许可证 | 需要保留的包 |
| --- | --- |
| Apache-2.0 | `@google/genai@2.22.0`、`@ui-tars/sdk@1.2.3`、`@ui-tars/action-parser@1.2.3`、`@ui-tars/shared@1.2.3`、`openai@5.23.2` |
| BSD-3-Clause | `ieee754@1.2.1`、`jpeg-js@0.4.4` |
| BlueOak-1.0.0 | `sax@1.6.1` |
| ISC | `pixelmatch@5.3.0` |
| MIT AND Zlib | `pako@1.0.11` |
| MIT | `pinyin-pro@3.29.4`、`@jimp/core@1.6.0`、`@jimp/diff@1.6.0`、`@jimp/file-ops@1.6.0`、`@jimp/js-bmp@1.6.0`、`@jimp/js-gif@1.6.0`、`@jimp/js-jpeg@1.6.0`、`@jimp/js-png@1.6.0`、`@jimp/js-tiff@1.6.0`、`@jimp/plugin-blit@1.6.0`、`@jimp/plugin-blur@1.6.0`、`@jimp/plugin-circle@1.6.0`、`@jimp/plugin-color@1.6.0`、`@jimp/plugin-contain@1.6.0`、`@jimp/plugin-cover@1.6.0`、`@jimp/plugin-crop@1.6.0`、`@jimp/plugin-displace@1.6.0`、`@jimp/plugin-dither@1.6.0`、`@jimp/plugin-fisheye@1.6.0`、`@jimp/plugin-flip@1.6.0`、`@jimp/plugin-hash@1.6.0`、`@jimp/plugin-mask@1.6.0`、`@jimp/plugin-print@1.6.0`、`@jimp/plugin-quantize@1.6.0`、`@jimp/plugin-resize@1.6.0`、`@jimp/plugin-rotate@1.6.0`、`@jimp/plugin-threshold@1.6.0`、`@jimp/types@1.6.0`、`@jimp/utils@1.6.0`、`@tokenizer/token@0.3.0`、`@types/node@26.5.1`、`abort-controller@3.0.0`、`any-base@1.1.0`、`async-retry@1.3.3`、`await-to-js@3.0.0`、`base64-js@1.5.1`、`bmp-ts@1.0.9`、`buffer@6.0.3`、`event-target-shim@5.0.1`、`events@3.3.0`、`exif-parser@0.1.12`、`file-type@16.5.4`、`gifwrap@0.10.1`、`image-q@4.0.0`、`jimp@1.6.0`、`lodash.isnumber@3.0.3`、`mime@3.0.0`、`omggif@1.0.10`、`parse-bmfont-ascii@1.0.6`、`parse-bmfont-binary@1.0.6`、`parse-bmfont-xml@1.1.6`、`peek-readable@4.1.0`、`pngjs@7.0.0`、`process@0.11.10`、`readable-stream@4.7.0`、`readable-web-to-node-stream@3.0.4`、`retry@0.12.0`、`safe-buffer@5.2.1`、`simple-xml-to-json@1.2.7`、`string_decoder@1.3.0`、`strtok3@6.3.0`、`tinycolor2@1.6.0`、`token-types@4.2.1`、`undici-types@8.9.0`、`utif2@4.1.0`、`uuid@11.1.0`、`xml-parse-from-string@1.0.1`、`xml2js@0.5.0`、`xmlbuilder@15.1.1`、`zod@3.25.76` |

`exif-parser@0.1.12` 的 package metadata 未填写 `license` 字段，但其随包 `LICENSE.md` 是 MIT，故按 MIT 保留。每个文件应采用原包随附的 LICENSE/NOTICE/COPYING 文本，不能只保留 SPDX 名称。

四个实际 npm 包未附 LICENSE/COPYING/NOTICE：`@tokenizer/token@0.3.0`、`omggif@1.0.10`、`parse-bmfont-ascii@1.0.6`、`readable-web-to-node-stream@3.0.4`。已将其许可证原文加入 `licenses/third-party/`，并只在这四个明确 package/version 缺少随包法律文件时作为 fallback 复制。manifest 会记录每份的官方上游 source URL 与发布时 `gitHead` SHA；前三份来自对应发布 commit 的 README 原文，`parse-bmfont-ascii` 来自对应发布 commit 的 `LICENSE.md`。任何新的缺失包或缺少 vendored 文件都会使构建失败，不能静默交付。

## 静态证据位置

- `node_modules/@ui-tars/sdk/dist/GUIAgent.mjs`：默认 logger、循环、截图回调、abort/stop、finished/call_user、retry 行为及对 `uuid` 的未声明导入。
- `node_modules/@ui-tars/sdk/dist/Model.mjs`：OpenAI 客户端、Chat Completions/Responses 请求和日志路径。
- `node_modules/@ui-tars/sdk/dist/utils.mjs`：Base64 图片发给模型、最近图片/历史的格式化。
- `node_modules/@ui-tars/sdk/package.json`、`node_modules/jimp/package.json`、`node_modules/openai/package.json`：依赖、Node/浏览器打包边界。
- `node_modules/@google/genai/package.json`、`desktop/gemini-client.ts`、`desktop/gemini-computer-use.ts`：Google SDK 版本、Node 入口、原生 Interactions 调用、尺寸/超时/取消边界及 Computer Use 动作守卫。
