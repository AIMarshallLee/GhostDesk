#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "============================================================"
echo "🍎 GhostDesk M5Stack CoreS3 macOS 客户端启动中..."
echo "============================================================"

# 检查 Python3 环境
if ! command -v python3 &> /dev/null; then
    echo "❌ 未检测到 Python3，请先安装 Python: brew install python3"
    exit 1
fi

# 检查并自动补齐依赖
python3 -c "import serial, speech_recognition, pyperclip, pyautogui" 2>/dev/null
if [ $? -ne 0 ]; then
    echo "📦 正在自动配置所需基础依赖 (pyserial, speech_recognition, pyperclip, pyautogui)..."
    pip3 install pyserial SpeechRecognition pyperclip pyautogui
fi

echo "✨ 正在监听 CoreS3 设备接入 (支持 USB CDC 与 蓝牙 BLE)..."
echo "👉 首次在 Mac 上运行如果提示【辅助功能与辅助键权限】，请在【系统偏好设置 -> 隐私与安全性 -> 辅助功能】中勾选允许 Terminal 或 Python 即可！"
echo "------------------------------------------------------------"

python3 -u scripts/walkie_talkie.py
