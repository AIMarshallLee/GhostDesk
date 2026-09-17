# GhostDesk 通用 Arduino 固件 (Universal Arduino HID)

本固件提供单文件、零第三方依赖的开源实现，运行标准的 **GhostDesk 协议 v4**。
只需一块支持 USB HID 的微控制器开发板，在 Arduino IDE 中一键点击“上传”，即可将手头的板子直接变身为物理防封的 GhostDesk 硬件执行器！

---

## 🚀 支持的开发板与芯片

只要板子支持原生 USB（具有 USB CDC 虚拟串口与 USB HID 键鼠复合功能），均可直接使用：

| 开发板 | 主控芯片 | 推荐场景 | 参考价格 |
| :--- | :--- | :--- | :--- |
| **Arduino Leonardo / Micro** | ATmega32U4 | 经典方案，官方标准板 | ￥25 - ￥45 |
| **Pro Micro 5V / 16MHz** | ATmega32U4 | 超小体积，外挂隐藏极佳 | ￥12 - ￥18 |
| **Seeed Studio XIAO SAMD21** | ATSAMD21G18 | 邮票大小、高性能 ARM Cortex-M0+ | ￥30 |
| **Teensy 2.0 / 3.x / 4.x** | AVR / ARM M4/M7 | 超高回报率、极客首选 | ￥50 - ￥150 |
| **Raspberry Pi Pico (Arduino Core)** | RP2040 双核 | 性价比之王，支持 Philhower Core | ￥18 - ￥25 |

> **注意**：传统的 Arduino Uno (ATmega328P) 或 Nano 默认使用 CH340 或 ATmega16U2 串口芯片，未将主芯片直连 USB 总线，无法作为原生 USB HID 运行（除非单独烧录 16U2 DFU 固件）。建议直接选用 Leonardo、Pro Micro、SAMD21 或 RP2040。

---

## 🛠️ 烧录与使用步骤

1. **安装 Arduino IDE**（推荐 2.x 或 1.8.x）：
   - 官方下载：[https://www.arduino.cc/en/software](https://www.arduino.cc/en/software)

2. **打开固件工程**：
   - 双击打开 `GhostDesk_Universal_HID.ino` 文件。

3. **选择开发板与端口**：
   - 菜单栏依次选择：`工具 (Tools)` -> `开发板 (Board)` -> 选择你的型号（例如 `Arduino Leonardo` 或 `Arduino Micro`）。
   - 依次选择：`工具 (Tools)` -> `端口 (Port)` -> 选择板子识别到的 COM 端口。

4. **一键上传 (Upload)**：
   - 点击顶部绿色向右箭头按钮 **“上传 (Upload)”**。
   - 编译并烧录完成后，开发板板载 LED 将处于待机（低电平熄灭）状态。

5. **在 GhostDesk 中连接**：
   - 打开 GhostDesk 客户端 -> 进入 **“硬件安全执行”** 或 **“工作区设置”**。
   - 选择该 COM 端口进行连接，握手成功后即可物理键鼠接管！

---

## 🛡️ 安全与协议特性

- **硬件看门狗 (Hardware Watchdog)**：握手后 10 秒内未收到心跳包自动 `disarm`，物理复位所有按键与鼠标，防止卡键。
- **指示灯状态**：`isArmed` 工作激活时板载 LED 常亮；待机或心跳超时后自动熄灭。
- **纯标准库**：仅调用 Arduino 官方内置的 `<Keyboard.h>` 与 `<Mouse.h>`，无需额外下载或安装任何第三方 zip 库。
