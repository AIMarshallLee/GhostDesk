#!/usr/bin/env python3
"""
GhostDesk & AI Buddy CLI Helper
让 Antigravity、Claude、Codex 或终端脚本向桌面的 M5Stack CoreS3 发送状态与通知。

用法示例:
    python scripts/buddy.py thinking "正在检索代码库并思考..."
    python scripts/buddy.py done "代码重构完成，单测全部通过！"
    python scripts/buddy.py error "构建失败，请检查语法错误"
    python scripts/buddy.py idle
"""

import sys
import time

try:
    import serial
    import serial.tools.list_ports
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "pyserial"])
    import serial
    import serial.tools.list_ports


def find_buddy_port():
    ports = serial.tools.list_ports.comports()
    for p in ports:
        # 匹配 VID:PID 0xCAFE:0x4001 或 FlowDesk 产品名
        if p.vid == 0xCAFE and p.pid == 0x4001:
            return p.device
        if "FlowDesk" in (p.description or ""):
            return p.device
    return None


def send_buddy_command(cmd: str, message: str = ""):
    port = find_buddy_port()
    if not port:
        print("⚠️ 未找到已连接的 M5Stack CoreS3 (FlowDesk USB Bridge) 设备。")
        print("请确认 Type-C 数据线已连接并且固件已正常运行。")
        return False

    try:
        with serial.Serial(port, 115200, timeout=1.0) as ser:
            time.sleep(0.1)
            payload = f"buddy\t{cmd}\t{message}\n"
            ser.write(payload.encode("utf-8"))
            ser.flush()
            reply = ser.readline().decode("utf-8", errors="ignore").strip()
            print(f"✨ 成功通知桌面的 M5Stack CoreS3 [{port}]: {cmd} -> {message or 'OK'}")
            return True
    except Exception as e:
        print(f"❌ 通信失败: {e}")
        return False


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)

    command = sys.argv[1].lower()
    text = sys.argv[2] if len(sys.argv) > 2 else ""
    send_buddy_command(command, text)
