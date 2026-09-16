# M5Stack CoreS3 专属固件：GhostDesk 物理防封控制终端 👻🖥️⚡

本工程将闲置的 **M5Stack CoreS3（ESP32-S3）** 变身为具备**彩屏实时监控、声效报警与触控物理急停**的高端 AI 桌面员工控制终端，100% 兼容 GhostDesk 底座的硬件控制协议。

---

## 🌟 核心特性

1. **零软件注入，物理防封**：
   - ESP32-S3 原生 USB OTG 直接向 Windows 宿主机枚举为标准 HID 键鼠与虚拟串口。
   - 自动模拟真实击键、鼠标相对平滑移动、Ctrl+V 粘贴与全拼逐字击键。
2. **2.0 寸全彩触屏实时看板**：
   - **顶部状态**：实时显示 `ARMED`（AI 控制中）、`STANDBY`（就绪待命）或 `EMERGENCY STOP`（急停断开）。
   - **执行看板**：实时显示当前 AI 操作的动作（如 `CLICK: left`, `TYPE: "订单已发出"`, `KEY: enter`）与累计执行步数。
   - **心跳守护**：实时显示 10 秒租约倒计时与电池电量。
3. **触屏物理急停（Emergency Kill Switch）**：
   - 屏幕底部常驻大号红色 **【STOP / 物理急停】** 触控按钮。
   - 一旦发现 AI 操作偏离预期，伸手轻触屏幕即可瞬间释放所有键鼠按键并中断会话，同时发出蜂鸣警报，杜绝误操作风险！
4. **即插即用无缝识别**：
   - 固件已配置标准 VID/PID (`0xCAFE:0x4001`) 与产品名称 (`FlowDesk USB Bridge`)，GhostDesk 客户端与后台服务可自动秒级免驱发现。

---

## 🚀 编译与烧录方法

### 方法一：使用 VS Code + PlatformIO（推荐，最省心）

1. 在 VS Code 中安装 **PlatformIO IDE** 插件。
2. 在 VS Code 中打开本目录：`E:\GhostDesk\firmware\m5stack_cores3`。
3. 用一条 Type-C 数据线将 **M5Stack CoreS3 顶部的 USB-C 口** 连接到电脑。
4. 点击 VS Code 底部状态栏的 **PlatformIO: Upload**（向右箭头图标），即可自动拉取依赖库、编译并烧录至 CoreS3。

---

### 方法二：使用 Arduino IDE

1. 打开 **Arduino IDE**，在“首选项”中添加 ESP32 开发板源地址：
   `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
2. 在“开发板管理器”中安装 `esp32`（版本建议 2.0.14 或更高）。
3. 在“库管理器”中搜索并安装：
   - `M5Unified`
4. 打开 `src/main.cpp`（或将其另存为 `m5stack_cores3.ino`）。
5. 在“工具”菜单中配置如下关键项：
   - **Board (开发板)**: `M5Stack CoreS3` (或 `ESP32S3 Dev Module`)
   - **USB Mode**: `Hardware CDC and JTAG` 或 `OTG`
   - **USB CDC On Boot**: `Enabled` (非常关键！保证串口直接走 USB)
   - **PSRAM**: `OPI PSRAM`
   - **Upload Mode**: `UART0 / Hardware CDC`
6. 点击 **上传** 按钮烧录。

---

## 🎮 如何在 GhostDesk 中使用？

1. **连接硬件**：
   - 烧录完成后，CoreS3 屏幕亮起并发出启动音，显示 `[ STANDBY ]` 状态。
   - 电脑设备管理器中会多出一个端口为 `FlowDesk USB Bridge (COMx)` 的虚拟串口。
2. **启动 GhostDesk**：
   - 在 `E:\GhostDesk` 目录下运行 `npm run desktop` 启动工作台。
   - 打开界面的 **USB 硬件控制** 面板，GhostDesk 会自动扫描并识别到 CoreS3。
   - 点击连接，CoreS3 屏幕顶栏会立即变成亮绿色 `[ ARMED / RUNNING ]`，Session ID 同步点亮！
3. **安全测试**：
   - 运行任意带硬件防封的 SOP（如微信发送测试）。
   - 观察 CoreS3 屏幕实时滚动的动作日志。
   - 尝试按下屏幕下方的红色 **STOP** 按钮，验证物理急停机制。
