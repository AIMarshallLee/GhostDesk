#!/bin/bash
# ========================================================
# GhostDesk 👻 M5Stack CoreS3 后台静默启动器 (macOS 专属)
# 双击或终端运行，完全隐形并在后台启动对讲机服务，不占终端。
# ========================================================

cd "$(dirname "$0")"

# 检查是否已在运行
ALREADY_RUNNING=$(pgrep -f "walkie_talkie.py")
if [ -n "$ALREADY_RUNNING" ]; then
    osascript -e 'display notification "GhostDesk 对讲机后台服务已经在运行中！直接使用桌上的 CoreS3 即可。" with title "GhostDesk 👻"' 2>/dev/null || true
    echo "✨ GhostDesk 对讲机后台服务已经在运行中 (PID: $ALREADY_RUNNING)！"
    exit 0
fi

# 启动后台进程 (nohup 忽略挂起信号，完全与终端解绑)
nohup python3 scripts/walkie_talkie.py >/dev/null 2>&1 &
PID=$!

sleep 1
if ps -p $PID > /dev/null 2>&1; then
    osascript -e 'display notification "🎉 GhostDesk AI 对讲机后台服务已隐形启动！随时按住 M5Stack CoreS3 说话即可。" with title "GhostDesk 👻"' 2>/dev/null || true
    echo "🎉 GhostDesk AI 对讲机后台服务已成功启动 (PID: $PID)！"
    echo "• 终端已解绑，无多余窗口占用"
    echo "• 如需关闭，运行【一键停止后台服务.sh】即可"
else
    echo "❌ 启动失败，请检查 Python3 与依赖环境：pip3 install -r requirements.txt"
fi
