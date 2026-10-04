#!/bin/bash
# FlowDesk Mac 智能一键极速配置与开机自启脚本
# 一句命令完成依赖安装、LaunchAgent 守护服务注册、无线话筒网桥启动
# 用法: bash scripts/setup_mac.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
MIC_SCRIPT="$SCRIPT_DIR/flowdesk_wireless_mic.py"
REQ_FILE="$SCRIPT_DIR/requirements-mic.txt"
PLIST_PATH="$HOME/Library/LaunchAgents/com.flowdesk.mic.plist"

if [ "$1" = "--uninstall" ] || [ "$1" = "-u" ]; then
    echo ">>> 正在停止并卸载 FlowDesk Mac LaunchAgent 服务..."
    launchctl unload "$PLIST_PATH" 2>/dev/null || true
    rm -f "$PLIST_PATH"
    echo "[OK] FlowDesk Mac 开机自启服务已完全卸载！"
    exit 0
fi

echo "============================================================"
echo ">>> FlowDesk Mac 一键自动化部署"
echo "============================================================"

# 1. 查找 Python3
PYTHON_BIN="$(which python3 || true)"
if [ -z "$PYTHON_BIN" ]; then
    echo "[Error] 未检测到 python3，请先安装 Python 3.9+"
    exit 1
fi

# 2. 安装 Python 核心依赖 (自动隔离 venv，完美兼容 Homebrew Python 与 PEP 668)
echo "1/3 准备 Python 独立运行环境与核心依赖 (sounddevice, bleak, numpy)..."
VENV_DIR="$PROJECT_ROOT/.venv"
if [ ! -d "$VENV_DIR" ]; then
    "$PYTHON_BIN" -m venv "$VENV_DIR" 2>/dev/null || true
fi

if [ -f "$VENV_DIR/bin/python3" ]; then
    RUN_PYTHON="$VENV_DIR/bin/python3"
    "$RUN_PYTHON" -m pip install --quiet --disable-pip-version-check -r "$REQ_FILE"
else
    RUN_PYTHON="$PYTHON_BIN"
    "$RUN_PYTHON" -m pip install --quiet --disable-pip-version-check --break-system-packages -r "$REQ_FILE" 2>/dev/null || \
    "$RUN_PYTHON" -m pip install --quiet --disable-pip-version-check -r "$REQ_FILE"
fi
echo "[OK] Python 核心依赖库已就绪！"

# 3. 注册 LaunchAgent (开机自启、崩溃自动重启、零黑框后台常驻)
echo "2/3 注册 macOS 原生 LaunchAgent 守护服务..."
mkdir -p "$HOME/Library/LaunchAgents"

cat <<EOF > "$PLIST_PATH"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.flowdesk.mic</string>
    <key>ProgramArguments</key>
    <array>
        <string>$RUN_PYTHON</string>
        <string>$MIC_SCRIPT</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/flowdesk_mic.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/flowdesk_mic.err</string>
    <key>WorkingDirectory</key>
    <string>$PROJECT_ROOT</string>
</dict>
</plist>
EOF

# 4. 加载并立即启动服务
echo "3/3 启动后台常驻话筒网桥..."
launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load -w "$PLIST_PATH"

echo ""
echo "============================================================"
echo "🎉 FlowDesk Mac 独立无线话筒系统 一键配置完成！"
echo "============================================================"
echo "  * 运行模式: macOS 系统级 LaunchAgent 后台静默守护"
echo "  * 开机自启: 已激活 (开机即常驻，崩溃自动秒级拉起)"
echo "  * 目标设备: FlowDesk Mac (CoreS3 Mac 专属通道)"
echo "  * 日志路径: /tmp/flowdesk_mic.log"
echo "  * 卸载命令: bash scripts/setup_mac.sh --uninstall"
echo "============================================================"
