# FlowDesk 权限与边界

没有登录用户、角色、RBAC、云表或行级权限；运行模型是单用户本地实例。

| 资源 | 谁可调用 | 强制点 | 拒绝结果 |
| --- | --- | --- | --- |
| HTTP /api | 本机同源且有 session 的页面 | Host/Origin 和 HttpOnly session | 403/401 |
| Electron IPC | FlowDesk 主 renderer | preload 暴露项、main-frame 与 URL 白名单 | IPC error |
| sandbox relay | 当前 opaque iframe | relay token、父 frame、路径白名单 | relay error |
| live provider | 本地操作者显式确认后 | provider 配置与 allowLive | 400 |
| Windows 填入 | 本地操作者经捕获目标 | HWND、标题、PID、启动时间复核 | 中止填入 |

本地 JSON 不提供多用户隔离；将数据目录复制给其他人等同于交付该本地工作区。真实外部账号发送不在当前授权或验证范围。
