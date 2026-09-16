# GhostDesk 👻🖥️⚡

> **攻壳机动队式软硬协同·物理级防封的桌面 AI 员工开源底座 (Windows)**  
> *The Open-Source Hardware-in-the-Loop Desktop AI Employee Substrate*

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%2011%20x64-blue)](https://www.microsoft.com/windows)
[![Hardware](https://img.shields.io/badge/hardware-Raspberry%20Pi%20Pico%20RP2040-red)](https://www.raspberrypi.com/products/raspberry-pi-pico/)
[![Models](https://img.shields.io/badge/models-Gemini%20Interactions%20%7C%20UI--TARS%201.5-green)](https://ai.google.dev/)

[English](README.md) | [中文说明](README_CN.md)

---

## 💡 为什么需要 GhostDesk？

目前主流的桌面自动化与 Computer Use 方案（如 PyAutoGUI、Windows UI Automation、系统级键盘鼠标模拟钩子），本质上全是**软件层面的 API 注入**。

当企业尝试使用 AI 自动化操作敏感业务软件（如微信、企微、钉钉、千牛、电商后台、各类 ERP 与网银）时，此类软件注入行为会在几秒钟内被平台反作弊与风控系统捕获，**导致批量封号与封禁**。

**GhostDesk（意为“驻留在桌面硬件躯壳中的 AI 幽灵”）从底层采用了完全不同的真实生产级解法：**
1. **物理级硬件 HID 仿真（树莓派 Pico RP2040）**：AI 的鼠标移动与按键通过外接硬件芯片（运行定制 TinyUSB 固件）下发。在 Windows 与目标软件看来，这就是一个完全合法的外部物理键盘与鼠标。
2. **视觉感知驱动的输入法全拼打字**：中文不走剪贴板、不产生 `Ctrl+V` 特征，而是由 `pinyin-pro` 将中文转为全拼 ASCII 击键下发，同时配合视觉模型毫秒级读取输入法候选框并按下数字选词。
3. **双前沿视觉 Computer Use 引擎**：
   - 官方原生 **Google Gemini Interactions** 桌面端操作协议。
   - 国内与开源前沿 **字节跳动 UI-TARS 1.5** / 豆包 Computer Use 模型。
4. **银行级 Fail-Closed 安全边界与窗口核验**：严格校验目标窗口的 `HWND`、`PID`、进程启动时间与标题尺寸，杜绝切窗误触；人机在环（HITL）审核与审核撤销机制，API 密钥由 Windows `safeStorage` 硬件隔离保护。
5. **双执行模式解耦**：
   - **生产/防封模式（Pico USB HID）**：硬件在环物理执行，用于真实业务场景。
   - **开发者模式（纯软件运行）**：无需任何硬件，设置 `FLOWDESK_DEV_MODE=1` 即可快速本地开发与调试。

---

## 🏗️ 系统架构

```mermaid
graph TD
    subgraph AI大脑与视觉引擎 ["AI 视觉与动作模型"]
        M1["Google Gemini Interactions API"]
        M2["字节跳动 UI-TARS 1.5 / 豆包"]
        M3["通用 OpenAI 兼容视觉端点"]
    end

    subgraph 桌面执行底座 ["GhostDesk 桌面底座 (Electron + Node.js)"]
        GW["窗口守卫与 HWND 强校验"]
        VLM["视觉截屏与闭环调度循环"]
        IME["全拼分词 + 候选窗视觉转写"]
        SEC["安全存储 safeStorage / 审计日志"]
    end

    subgraph 硬件层 ["物理外设层 (外部硬件)"]
        PICO["树莓派 Pico (RP2040 开发板)"]
        USB_HID["TinyUSB 物理键鼠协议"]
    end

    subgraph 操作系统与目标应用 ["Windows 11 宿主环境"]
        APPS["目标业务软件 (微信 / 浏览器 / ERP / Excel)"]
    end

    AI大脑与视觉引擎 <--> VLM
    VLM --> GW
    GW --> IME
    IME --> PICO
    PICO --> USB_HID
    USB_HID --> APPS
    APPS -.->|"PrintWindow 窗口捕获"| VLM
```

---

## ⚡ 快速上手

### 1. 环境准备
- 操作系统：Windows 11 x64
- 运行时：Node.js v20+ / npm v10+
- *(可选)*：树莓派 Pico 1（RP2040 核心板，淘宝约 15~20 元）+ Micro-USB 数据线

### 2. 获取代码与依赖安装
```powershell
# 克隆仓库
git clone https://github.com/<your-username>/GhostDesk.git
cd GhostDesk

# 安装依赖
npm ci

# 执行全套自动化单元测试（210+ 测试项）
npm test
```

### 3. 运行体验
- **启动网页工作台 (Web Studio)**：
  ```powershell
  npm run dev
  # 浏览器访问 http://127.0.0.1:5178
  ```
- **启动 Windows 客户端 (Electron)**：
  ```powershell
  npm run desktop
  ```
- **免硬件开发者模式 (Software-Only)**：
  ```powershell
  $env:FLOWDESK_DEV_MODE="1"; npm run desktop
  ```

---

## 🔌 硬件烧录指南（30 秒免工具搞定）

GhostDesk 采用极其普及的 **树莓派 Pico 1 (RP2040)**：
1. 按住 Pico 板子上的 **BOOTSEL** 白色小按键不放，插上电脑 USB。
2. 电脑会自动弹出一个名为 `RPI-RP2` 的 U 盘驱动器。
3. 将本项目自带的预编译固件 `firmware/release/flowdesk_usb_bridge.uf2` 拖入该 U 盘。
4. 板子会自动重启，瞬间变身 GhostDesk 硬件键鼠控制器！
5. 在 GhostDesk 客户端中打开「USB 硬件」页面，系统将自动识别该设备。

---

## 🗺️ 演进路线图：从客服助手到全能 AI 员工底座

- [x] **v0.7.0 (当前版本)**：
  - Gemini 原生 Interactions Computer Use 支持
  - UI-TARS 1.5 单任务视觉规划与操作
  - 树莓派 Pico USB HID 协议 4 与心跳看门狗
  - 中文视觉输入法全拼逐键打字
  - 桌面多会话持续监听与沙箱自动回复实验
- [ ] **v0.8.0 (通用任务协议与 MCP 接入)**：
  - 开放通用 CLI / Webhook 任务分发（突破聊天窗口限制，支持任意工作流）
  - 深度集成 Model Context Protocol (MCP) 客户端与工具集
  - 混合执行模式（非敏感应用走 Windows UIA 高速通道，敏感应用走硬件 HID）
- [ ] **v0.9.0 (数字员工技能生态)**：
  - 模块化技能系统（Excel 批量填报、跨系统订单录入、发票报销、网银查账）
  - 长周期目标规划与反思纠错状态机（Self-Reflection Engine）
- [ ] **v1.0.0 (企业级分布式员工集群)**：
  - 支持单台管理服务器统筹多台插着硬件狗的“AI 员工工控机”集中调度看板

---

## 🤝 贡献与开源许可

欢迎提交 Issue 和 Pull Request！

本项目代码遵循 **Apache License 2.0** 开源许可协议 - 详见 [LICENSE](LICENSE)。  
固件部分包含 TinyUSB 开源组件，遵循 MIT/BSD-3-Clause 协议。
