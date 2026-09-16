# FlowDesk 验证地图

## 已有覆盖（34 个 Node 测试）

| 来源 | 数量 | 已验证规则 |
| --- | ---: | --- |
| server/autopilot.test.ts | 19 | 队列、去重、暂停/接管、ACK、持久化锁重试、manual copy |
| server/http.test.ts | 1 | 本地 HTTP bootstrap、Origin/Host、session 和静态路径 |
| server/sandbox-service.test.ts | 1 | sandbox service 路由与 provider 边界 |
| server/service.test.ts | 6 | 任务、导入导出、provider 和状态校验 |
| desktop/guards.test.ts | 7 | IPC/API 白名单、iframe relay、窗口与 USB 输入防护 |

npm test 是当前本地测试入口；当前没有 CI，也没有标记为合并门禁的检查。

2026-09-14 最终源码 34/34 通过，生产构建通过。打包后的 EXE 与最终 ZIP 在独立解压目录中、使用全新 userData 的 smoke 均通过：子帧取得三个虚构会话、渲染完成、parent DOM 隔离检查通过。精确 ZIP 与 117 个运行文件校验结果见 `artifacts/portable-verification.json`，不包含六项样例的 Windows GUI 全流程验收。

## 待补验证

| 用例 | 类型 | 状态 |
| --- | --- | --- |
| 另一台 Windows 的解压、正常启动和样例操作 | 用户手工测试 | 待用户在目标机测试；本机独立解压 smoke 已通过 |
| OpenAI-compatible provider 的真实调用 | 受控 live | 未执行；会产生供应商调用 |
| 真实微信或其他第三方平台 | 人工授权的集成测试 | 未授权、未验证 |
| 安全存储在目标 Windows 账户的可用性 | 手工 | 未验证 |

## 主要缺口

包在目标机器的兼容性、真实 provider 行为和第三方账号实际发送均没有当前通过证据；本地 sandbox PASS 不替代这些验证。
