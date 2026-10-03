# CoreS3 Mac 无线话筒与虚拟声卡 (VB-Cable) 全链路实战指南

> **核心目标**：将桌面闲置的 M5Stack CoreS3（ESP32-S3）作为 Mac Mini 的超高灵敏度无线双麦克风，利用 BLE 传输与 VB-Cable 虚拟声卡桥接，无缝驱动微信输入法 / 系统自带听写，实现“按住说话、实时上屏”。

---

## 1. 整体架构与声音流转链路

```mermaid
flowchart LR
    A["M5Stack CoreS3 (ESP32-S3)<br/>板载 ES7210 高灵敏度双麦"] --"16kHz 16bit PCM<br/>(IMA-ADPCM 压缩)"--> B["BLE GATT Notify<br/>(UUID: ...def1)"]
    B --> C["Mac 端 Python 音频网桥<br/>(flowdesk_wireless_mic.py)"]
    C --"智能重采样 (16k -> 48k)<br/>双声道 Stereo 2.5x 增益"--> D["VB-Cable 虚拟音频驱动<br/>(CoreAudio CABLE Input)"]
    D --> E["macOS 系统声音输入<br/>(CABLE Output 麦克风)"]
    E --> F["微信输入法 / 微信语音 / 系统听写<br/>(实时转文字上屏)"]
```

---

## 2. 为什么需要 Mac 端音频网桥？（物理与协议真相）

1. **ESP32-S3 硬件特性**：
   ESP32-S3 仅支持 BLE（低功耗蓝牙），不支持经典蓝牙音频协议（Classic Bluetooth HFP / A2DP）。
2. **免驱 HID 与数据双模**：
   CoreS3 连接 Mac 时，Mac 将其视作**免驱的复合蓝牙键鼠**（支持右 Alt 快捷键、切窗、滚轮等）。
3. **音频传输通道**：
   语音数据通过自定义 BLE GATT 特征（UUID `12345678-1234-5678-1234-56789abcdef1`）高速推送，因此 Mac 端必须由一个轻量后台网桥进程读取该特征，并将音频数据写入虚拟声卡。

---

## 3. macOS CoreAudio 核心踩坑与专项优化

| 潜在问题 | 表现现象 | 解决方案 (已固化在网桥代码中) |
| :--- | :--- | :--- |
| **采样率不匹配 (致命)** | VB-Cable 在 macOS 中锁定 48kHz/44.1kHz，用 16kHz 推流触发 `PaErrorCode -9997` 崩溃或丢包 | 动态探测声卡原生采样率，自动执行高效线性插值与倍数重采样 (16kHz $\rightarrow$ 48kHz/44.1kHz) |
| **声道限制 (强制立体声)** | macOS CoreAudio 驱动要求 VB-Cable 必须为 2 通道 (Stereo) | 智能感知声卡声道数，自动将单声道 PCM 复制扩展为双声道 (`np.column_stack`) |
| **远场音量偏弱** | ES7210 裸 PCM 音量贴近底噪，导致输入法判定为静音 | 引入 2.5x 软件数字动态增益与削顶限幅保护 (`np.clip`) |
| **黑盒排查困难** | 不知道音频有没有到达，纯靠猜 | 增加终端**动态跳动声波电平表**（`[🎤 实时推流] 电平: [████████░░░░] 峰值: 8520`），肉眼可查 |

---

## 4. 快速部署与使用步骤

### 第一步：Mac 端拉取最新代码并运行
```bash
# 1. 切换到项目目录并拉取
cd ~/GhostDesk
git pull origin main

# 2. 停止旧进程 (若有)
pkill -f flowdesk_wireless_mic.py || true

# 3. 激活虚拟环境并启动网桥
source .venv/bin/activate
python3 scripts/flowdesk_wireless_mic.py
```

### 第二步：Mac 系统声音与输入法配置
1. **系统声音输入**：
   - 打开 macOS **「系统设置」 $\rightarrow$ 「声音」 $\rightarrow$ 「输入」**；
   - 选中 **VB-Cable** 作为输入设备。
2. **微信输入法快捷键**：
   - 打开微信输入法「偏好设置」 $\rightarrow$ 「快捷按键」；
   - 确认语音输入快捷键设置为 **Right Alt**（或双击 Option）；
   - 在语音麦克风选项中确保选择了 **VB-Cable**。

### 第三步：拿起 CoreS3 体验
1. 确认 CoreS3 当前处于 **「无线」模式**（MODE_WIRELESS_MIC），蓝牙连接至 `FlowDesk Mac`；
2. 轻按或按住麦克风区域说话；
3. 终端实时跳出声波电平，微信输入法光标处秒级输出转写文字！
