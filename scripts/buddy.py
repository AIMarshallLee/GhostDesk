#!/usr/bin/env python3
"""
GhostDesk & AI Buddy CLI Helper
让 Antigravity、Claude、Codex 或终端脚本向桌面的 M5Stack CoreS3 发送状态与通知。

用法示例:
    python scripts/buddy.py thinking "正在检索代码库并思考..."
    python scripts/buddy.py done "代码重构完成，单测全部通过！"
    python scripts/buddy.py error "构建失败，请检查语法错误"
    python scripts/buddy.py idle
    python scripts/buddy.py volume 15  # 设置温和轻柔音量 (0~255)
    python scripts/buddy.py mute       # 一键完全静音
    python scripts/buddy.py screen dim # 屏幕柔和低亮度（护眼不刺眼）
    python scripts/buddy.py screen off # 彻底息屏（黑屏省电，后台仍然工作）
    python scripts/buddy.py screen on  # 恢复正常亮度
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
        # 匹配 VID:PID 0xCAFE:0x4001 或 FlowDesk/CoreS3 产品名
        if p.vid == 0xCAFE and p.pid == 0x4001:
            return p.device
        if "FlowDesk" in (p.description or "") or "CoreS3" in (p.description or ""):
            return p.device
        if p.vid == 0x303A:
            return p.device

    # macOS 专属回退：自动匹配唯一的 usbmodem 串口
    if sys.platform == "darwin":
        usbmodems = [p.device for p in ports if "usbmodem" in p.device]
        if len(usbmodems) == 1:
            return usbmodems[0]

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
