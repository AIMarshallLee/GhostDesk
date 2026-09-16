#!/bin/bash
# ========================================================
# GhostDesk 👻 M5Stack CoreS3 后台服务停止器 (macOS 专属)
# ========================================================

PIDS=$(pgrep -f "walkie_talkie.py")

if [ -n "$PIDS" ]; then
    kill -9 $PIDS 2>/dev/null || true
    osascript -e 'display notification "✅ 成功安全停止所有 GhostDesk 后台对讲机服务！" with title "GhostDesk 👻"' 2>/dev/null || true
    echo "✅ 成功停止 GhostDesk 后台对讲机进程 (PID: $PIDS)"
else
    osascript -e 'display notification "ℹ️ 当前没有正在运行的 GhostDesk 对讲机后台服务。" with title "GhostDesk 👻"' 2>/dev/null || true
    echo "ℹ️ 当前没有正在运行的 GhostDesk 对讲机后台服务。"
fi
