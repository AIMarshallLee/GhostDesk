# GhostDesk 👻🖥️⚡

> **The Open-Source Hardware-in-the-Loop Desktop AI Employee Substrate for Windows & macOS**  
> *攻壳机动队式软硬协同·物理级防封的桌面 AI 员工开源底座 (支持 Windows 与 macOS)*

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-blue)](https://github.com/AIMarshallLee/GhostDesk)
[![CI](https://github.com/AIMarshallLee/GhostDesk/actions/workflows/ci.yml/badge.svg)](https://github.com/AIMarshallLee/GhostDesk/actions/workflows/ci.yml)
[![Hardware](https://img.shields.io/badge/hardware-Raspberry%20Pi%20Pico%20%7C%20M5Stack%20CoreS3-red)](firmware/)
[![Models](https://img.shields.io/badge/models-Gemini%20%7C%20UI--TARS%201.5%20%7C%20Qwen2.5--VL-green)](https://ai.google.dev/)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-purple)](https://modelcontextprotocol.io/)
[![Python SDK](https://img.shields.io/badge/python-LangGraph%20%7C%20CrewAI-yellow)](sdk/python/)

**🇺🇸 English** | [🇨🇳 简体中文 (Chinese Version)](README.md)

<p align="center">
  <img src="docs/assets/worker-studio-preview.svg" alt="GhostDesk AI Worker Studio Preview" width="100%" />
</p>

---

## 💡 What is GhostDesk? / 什么是 GhostDesk？

Most modern Computer Use and RPA frameworks (such as PyAutoGUI, Windows UI Automation, and OS-level hooks) rely on **software input injection**. When automating sensitive enterprise applications (e.g. WeChat, DingTalk, Feishu, e-commerce admin panels, ERPs, and banking software), software hooks are detected within seconds by anti-bot and anti-fraud engines, leading to immediate account bans.

**GhostDesk** ("Ghost in the Machine for your Desktop") introduces an enterprise-grade **Hardware-in-the-Loop (HITL)** substrate:

1. 🛡️ **Physical Hardware HID Emulation (RP2040 Pico)**: AI keystrokes and mouse movements are piped through an external hardware microchip running custom TinyUSB firmware. To Windows and target software, input appears as an authentic external USB keyboard and mouse. **Zero API hooks, zero anti-cheat detection.**
2. ⚡ **Hybrid Fast/Ghost Channel Routing**:
   - **Ghost Channel**: Pico USB HID + VLM OCR candidate typing for high-risk targets (WeChat, DingTalk, Pinduoduo).
   - **Fast Channel**: Instant native typing & direct automation for safe productivity tools (Excel, Chrome, Notepad), cutting typing latency from 15s to 50ms and saving ~80% VLM tokens!
3. 🔒 **100% Offline Local VLM Adapter (Qwen2.5-VL / Ollama)**: Zero data leakage. Run entirely offline on local enterprise GPUs using Ollama or vLLM with automated coordinate scaling.
4. 🐍 **Official Python SDK (`ghostdesk`)**: Seamlessly connects to **LangGraph**, **CrewAI**, **AutoGen**, and LangChain with typed Pydantic models.
5. 📑 **Markdown SOP Community Skill Hub**: Write enterprise automation procedures in human-readable Markdown SOPs. No code required. Built-in SOPs include *Feishu Leave Approval*, *Tax Invoice Batch Export*, *Xiaohongshu Lead Capture*, and *WeChat Order to Excel*.
6. 🤖 **Autonomous Worker Studio & Self-Healing Watchdog**: Visual React dashboard for monitoring workers, token savings metrics, interval/file-watcher autonomous triggers, and automatic `ESC` self-healing on modal blockage.
7. 🔌 **Model Context Protocol (MCP) Server**: Standard MCP tool endpoints for Claude Desktop, Cursor, and any external agent orchestrator.

---

## 🏗️ Architecture / 核心架构

```mermaid
graph TD
    subgraph Agent_Ecosystem ["Agent Orchestration & Frameworks"]
        PY["Official Python SDK (LangGraph / CrewAI)"]
        MCP_CLIENT["MCP Clients (Claude Desktop / Cursor)"]
        STUDIO["GhostDesk Worker Studio (React UI)"]
    end

    subgraph Vision_Brains ["Vision & LLM Intelligence"]
        GEMINI["Google Gemini Interactions API"]
        UITARS["ByteDance UI-TARS 1.5 / Doubao"]
        LOCAL_VLM["Offline Local VLM (Qwen2.5-VL via Ollama)"]
    end

    subgraph Core_Substrate ["GhostDesk Desktop Substrate (Electron + Node.js)"]
        WM["Multi-Window Workspace & Focus Guard"]
        PR{"Hybrid Policy Router"}
        PLANNER["Goal-Driven Subgoal Planner"]
        WATCHDOG["Autonomous Watchdog & Trigger Engine"]
        SKILL_HUB["Markdown Skill Hub & SOP Engine"]
        MCP_SERVER["Model Context Protocol (MCP) Server"]
    end

    subgraph Execution_Channels ["Dual Execution Channels"]
        PICO["Ghost Channel: Pico RP2040 Hardware USB HID (Zero-Ban)"]
        FAST["Fast Channel: High-Speed Native Driver (50ms)"]
    end

    subgraph Target_OS ["Operating System Workspaces (Windows 10/11 & macOS Sonoma/Sequoia)"]
        SENSITIVE["High-Risk Apps (WeChat / DingTalk / E-Commerce)"]
        OFFICE["Safe Apps (Excel / Chrome / Safari / Local ERP)"]
    end

    Agent_Ecosystem <--> Core_Substrate
    Vision_Brains <--> Core_Substrate
    Core_Substrate --> PR
    PR -->|"High-Risk Policy"| PICO
    PR -->|"Safe Office Policy"| FAST
    PICO --> SENSITIVE
    FAST --> OFFICE
```

---

## ⚡ Quick Start / 快速上手

### 1. Prerequisites
- **Operating System**:
  - 🪟 **Windows**: Windows 10 / Windows 11 (x64)
  - 🍎 **macOS**: macOS 12+ (Monterey / Ventura / Sonoma / Sequoia) with native **Apple Silicon (M1/M2/M3/M4)** and Intel x86_64 support
- **Runtime**: Node.js v20+ / npm v10+
- **Python (Optional)**: Python 3.10+ (for Python SDK and M5Stack CoreS3 walkie-talkie daemon)
- *(Optional Hardware)*: Raspberry Pi Pico 1 (RP2040) or M5Stack CoreS3 (ESP32-S3) via USB-C / USB-A cable

### 2. Installation & Automated Tests
```bash
# Clone the repository
git clone https://github.com/AIMarshallLee/GhostDesk.git
cd GhostDesk

# Install dependencies
npm ci

# Run test suite (236 cross-platform & hardware unit tests)
npm test
```

### 3. Launching
- **Worker Studio (Desktop App)**:
  ```bash
  npm run desktop
  ```
- **Developer Software-Only Mode (No Hardware Needed)**:
  - Windows (PowerShell): `$env:FLOWDESK_DEV_MODE="1"; npm run desktop`
  - macOS / Linux: `FLOWDESK_DEV_MODE=1 npm run desktop`
- **Local MCP Server**:
  ```bash
  npx tsx desktop/mcp-server.ts
  ```

---

## 🍎 Native macOS Support & Configuration Guide

GhostDesk includes full native macOS integration via [`desktop/macos-adapter.ts`](desktop/macos-adapter.ts):

1. 🔌 **Zero-Driver Hardware-in-the-Loop (HITL)**:
   - Raspberry Pi Pico and M5Stack CoreS3 report standard USB HID Keyboard and Mouse descriptors.
   - Plugged into your Mac's USB-C port, macOS recognizes it as a genuine external physical peripheral without requiring kernel extensions (kext) or disabling SIP.
2. 🔍 **Automatic CDC Serial Port Discovery**:
   - The substrate scans `/dev/cu.usbmodem*` to auto-detect Pico and CoreS3 hardware dongles with millisecond-level handshaking.
3. ⌨️ **Intelligent Key Modifier Translation**:
   - Automatically maps automation key combinations to macOS native standards:
     - `Ctrl / Win` -> `Command ⌘`
     - `Alt` -> `Option ⌥`
     - `Backspace` -> `Delete ⌫`
     - `Enter` -> `Return ↩`
4. 🖥️ **macOS Window Focus & Guarding (AppleScript & Quartz)**:
   - Integrates with AppleScript and Quartz Window Services to reliably focus and switch target apps by Bundle ID (e.g. `com.tencent.xinWeChat`, `com.google.Chrome`, `com.apple.Safari`).
5. 🛡️ **System Permissions**:
   - When running on macOS for the first time, simply allow GhostDesk in **System Settings -> Privacy & Security -> Accessibility**.

---

## 🐍 Python SDK Quickstart (LangGraph & CrewAI)

Install and run the Python SDK:
```powershell
cd sdk/python
pip install -e .
```

### Basic Usage
```python
from ghostdesk import GhostClient, WindowTarget

client = GhostClient(base_url="http://127.0.0.1:4318")

# 1. High-risk app: Automatically routed to Pico USB Hardware HID
res = client.execute_action(process="wechat.exe", kind="type_text", text="订单已发货！")
print(f"Executed via: {res.channel}")  # -> 'ghost'

# 2. Safe app: Routed to Fast Channel (50ms native speed)
res = client.execute_action(process="excel.exe", kind="click", x=120.0, y=85.0)
print(f"Executed via: {res.channel}")  # -> 'fast'

# 3. Autonomous SOP Skill execution
res = client.dispatch_skill(
    skill_id="skill_order_to_excel",
    target_windows=[
        WindowTarget(hwnd="0x001A", process="wechat.exe", title="WeChat"),
        WindowTarget(hwnd="0x002B", process="excel.exe", title="OrderSheet.xlsx"),
    ]
)
```

See [sdk/python/examples/](sdk/python/examples/) for complete **LangGraph** and **CrewAI** worker integration scripts.

---

## 📑 Markdown SOP Skill Hub

Create enterprise skills in plain Markdown without programming:

```markdown
---
id: skill_vat_export
name: 增值税发票批量下载导出
processes: [chrome.exe, excel.exe]
---

### Step 1: 检索发票明细
- Target: chrome.exe
- Channel: fast
- Action: 点击【已开具发票查询】，选择上月区间并点击【查询】
- Expect: 表格渲染出查询结果列表

### Step 2: 批量下载与 Excel 格式化
- Target: chrome.exe
- Channel: ghost
- Action: 勾选全选，点击【批量下载】，保存至本地 Downloads
- Expect: 文件下载完成
```

Save to `skills/` directory and GhostDesk will automatically discover and register the skill.

---

## 🔌 Four Hardware Archetypes / 四大硬件形态

GhostDesk supports four versatile hardware tiers to match any use case or budget:

| Hardware Archetype | Device | Cost | Flashing Barrier | Highlights |
| :--- | :--- | :--- | :--- | :--- |
| **⭐ Turnkey Dongle** | **CH9329 USB-HID Module** | ~$2 | **Zero (No Flashing Needed)** | Plug-and-play straight from retail; native GhostDesk serial frame driver |
| **Budget Workhorse** | **Raspberry Pi Pico (RP2040)** | ~$3 | Minimal (Drag & drop UF2) | Dual-core Cortex-M0+; authentic USB HID composite keyboard & mouse |
| **Geek Open Source** | **Universal Arduino (Leonardo/Pro Micro/SAMD21)** | ~$3 - $5 | Minimal (Arduino IDE 1-click) | Single-file zero-dependency source code `firmware/arduino_universal/` |
| **Cyber Companion** | **M5Stack CoreS3 (ESP32-S3)** | ~$40 | Minimal (WebSerial 1-click) | 2.0" Touch LCD, expressive cyber eyes, physical touch emergency stop, walkie-talkie |

---

### Option 1: Zero-Flashing Turnkey Dongle — CH9329 (Recommended for Beginners)
1. Purchase a **"CH9329 Serial to USB HID Module"** on Taobao, AliExpress, or eBay (~$2).
2. **No compiler, no Python, no firmware flashing required**.
3. Plug directly into your computer USB port, open GhostDesk Desktop, select the port, and enjoy 100% hardware anti-ban automation!

### Option 2: Budget Workhorse — Raspberry Pi Pico 1 (RP2040)
1. Hold down the **BOOTSEL** button on your Pico and plug it into your computer via USB.
2. A mass storage drive named `RPI-RP2` will appear.
3. Drag and drop `firmware/release/flowdesk_usb_bridge.uf2` onto the `RPI-RP2` drive.
4. The Pico will reboot automatically as an authentic USB HID controller.

### Option 3: Geek Open-Source — Universal Arduino HID
1. Compatible with any native USB board: Arduino Leonardo, Pro Micro (ATmega32U4), Seeed Studio XIAO SAMD21, Teensy 2.0/3.x/4.x.
2. Open `firmware/arduino_universal/GhostDesk_Universal_HID.ino` in Arduino IDE.
3. Select your board and port, then click **Upload**! Built-in watchdog disarms automatically on 10s heartbeat timeout.

### Option 4: Cyber Companion & Smart Touch Terminal — M5Stack CoreS3 (ESP32-S3)
> Features a 2.0" IPS touch screen, audio alarms, and a **Physical Emergency Kill-Switch**!
1. **Web Browser 1-Click Flasher**: Open [firmware/m5stack_cores3/web_flasher.html](firmware/m5stack_cores3/web_flasher.html) in Chrome or Edge, connect CoreS3 via USB-C, and flash with one click.
2. **From Source**: Compile and upload via VS Code + PlatformIO or Arduino IDE (see [firmware/m5stack_cores3/README.md](firmware/m5stack_cores3/README.md)).
3. Once booted, the CoreS3 screen visualizes real-time AI action logs, heartbeat lease status, and an interactive red Emergency Stop button.

Once connected, open **USB Hardware** in the GhostDesk Desktop app to automatically pair.

---

## 🗺️ Roadmap: Growing into an AI Employee Substrate

- [x] **v0.8.0 (Substrate Milestone 1)**:
  - **Hybrid Execution Engine**: Fast Path (50ms typing) + Ghost Path (Pico hardware anti-ban)
  - **Multi-Window Workspace Scope**: Focus switching with HWND whitelist validation
  - **Model Context Protocol (MCP) Server**: Standard tool interface for agentic control
- [x] **v0.9.0 (Substrate Milestone 2)**:
  - **Goal-Driven Task Planner**: Sub-goal decomposition and progress tracking
  - **Visual Self-Reflection Engine**: Stuck detection and automatic `ESC` self-healing
  - **Modular Skill Ecosystem**: `SkillRegistry` with built-in benchmark SOPs
- [x] **v1.0.0 (The Moat Milestone - Released!)**:
  - **Worker Studio UI**: Visual dashboard with live progress and token savings tracker
  - **Autonomous Triggers & Watchdog**: Interval/file-watcher autonomous workers
  - **Official Python SDK**: LangGraph and CrewAI first-class adapters
  - **Local Offline VLM Adapter**: 100% private Qwen2.5-VL via Ollama
  - **Markdown Community Skill Hub**: Human-readable SOP execution
- [ ] **v1.1.0 (Enterprise Fleet Cluster)**:
  - Multi-dongle USB hub support for parallel desktop AI worker pods

---

## 🤝 Contributing & License

Contributions are welcome! Please feel free to submit issues and pull requests.

This project is licensed under the **Apache License 2.0** - see the [LICENSE](LICENSE) file for details.  
Firmware includes TinyUSB components subject to MIT/BSD licensing (see `firmware/licenses`).
