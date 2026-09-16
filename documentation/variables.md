# FlowDesk 配置与密钥

| 名称 | 使用位置 | 来源与范围 | 风险/处理 |
| --- | --- | --- | --- |
| FLOWDESK_PORT | server/index.ts | 本地 Node 服务；默认 4318 | 仅本机监听 |
| FLOWDESK_DATA_DIR | server/index.ts | 本地 JSON 数据目录 | 包含任务和知识；打包时不应带入 |
| FLOWDESK_API_KEY | server/service.ts | 浏览器服务进程内环境变量 | 不导出，不写状态 JSON |
| FLOWDESK_SMOKE_DIR | desktop smoke 脚本 | 临时 Electron userData 路径 | 仅隐藏启动验收使用 |

Windows Electron API key 使用 safeStorage 加密文件；浏览器模式密钥只在服务内存或上述环境变量。Base URL、模型名和温度属于本地设置，但不是密钥。

打包前确认发行目录不含 .flowdesk-data、密钥文件、环境文件或开发工具；在另一台电脑重新输入自己的 provider 设置。Gemini Computer Use、Antigravity CLI 和本机已登录的官方 CLI 均未接入 FlowDesk，也不得写入包内。
