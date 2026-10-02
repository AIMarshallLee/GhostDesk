#!/usr/bin/env python3
"""
FlowDesk M5Stack CoreS3 专属网易叭哥桌面桥接服务 (有线高速桌面模式)

功能特性：
1. 桌面插线模式：
   - 用户触控 CoreS3 屏幕（Apple 极简水波涟漪），毫秒级触发网易叭哥输入法；
   - 说话时使用【电脑本机麦克风/耳机麦】直接高清收音，零延迟、打字极准；
   - 再次轻点发送（或点击左下角取消），自动闭麦上屏并敲击回车提交 AI！
2. 手势切换应用：
   - CoreS3 屏幕向左/右/上/下滑动，自动切换当前桌面激活窗口 (VS Code, Terminal, Antigravity, Claude)。
"""

import os
import sys
import time
import ctypes
import threading
import serial
import serial.tools.list_ports

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# Win32 虚拟键码与扫描码定义
VK_RMENU = 0xA5       # Right Alt
SCAN_RMENU = 0x38     # Right Alt ScanCode
VK_RETURN = 0x0D      # Enter
SCAN_RETURN = 0x1C
VK_ESCAPE = 0x1B      # Escape
SCAN_ESCAPE = 0x01

VK_SPACE = 0x20      # Space
SCAN_SPACE = 0x39

KEYEVENTF_EXTENDEDKEY = 0x0001
KEYEVENTF_KEYUP = 0x0002

user32 = ctypes.windll.user32

def tap_doubao_hotkey():
    """点按 RightAlt + Space (豆包语音输入法)"""
    user32.keybd_event(VK_RMENU, SCAN_RMENU, KEYEVENTF_EXTENDEDKEY, 0)
    time.sleep(0.02)
    user32.keybd_event(VK_SPACE, SCAN_SPACE, 0, 0)
    time.sleep(0.04)
    user32.keybd_event(VK_SPACE, SCAN_SPACE, KEYEVENTF_KEYUP, 0)
    time.sleep(0.02)
    user32.keybd_event(VK_RMENU, SCAN_RMENU, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, 0)

def tap_right_alt():
    """点按一次 Right Alt (网易叭哥备选开关)"""
    user32.keybd_event(VK_RMENU, SCAN_RMENU, KEYEVENTF_EXTENDEDKEY, 0)
    time.sleep(0.03)
    user32.keybd_event(VK_RMENU, SCAN_RMENU, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, 0)

def trigger_voice_ime():
    """唤醒/关闭语音输入法 (优先豆包输入法，兼容网易叭哥)"""
    tap_doubao_hotkey()
    time.sleep(0.04)
    tap_right_alt()

def delayed_enter():
    """等待输入法识别上屏后，自动敲击回车发送给 AI"""
    time.sleep(0.65)
    user32.keybd_event(VK_RETURN, SCAN_RETURN, 0, 0)
    time.sleep(0.04)
    user32.keybd_event(VK_RETURN, SCAN_RETURN, KEYEVENTF_KEYUP, 0)
    print("🚀 [自动回车] 已提交 AI 输入框！", flush=True)

def tap_escape():
    """点按一次 Esc 键 (取消输入法)"""
    user32.keybd_event(VK_ESCAPE, SCAN_ESCAPE, 0, 0)
    time.sleep(0.04)
    user32.keybd_event(VK_ESCAPE, SCAN_ESCAPE, KEYEVENTF_KEYUP, 0)

try:
    from scripts.desktop_switcher import DesktopController
except ImportError:
    try:
        from desktop_switcher import DesktopController
    except Exception:
        DesktopController = None

def find_cores3_port():
    """自动扫描并匹配 M5Stack CoreS3 串口 (优先 COM4，严禁抢占 COM3 下载口)"""
    ports = serial.tools.list_ports.comports()
    for p in ports:
        if p.device == "COM4":
            return "COM4"
    for p in ports:
        if p.device == "COM3":
            continue
        if p.vid == 0x303A:
            return p.device
    for p in ports:
        if p.device == "COM3":
            continue
        desc = p.description or ""
        if "USB" in desc or "CoreS3" in desc or "SERIAL" in desc.upper():
            return p.device
    return None

def run_bridge():
    print("=" * 65, flush=True)
    print("✨ FlowDesk M5Stack CoreS3 网易叭哥桌面专属桥接服务已就绪", flush=True)
    print("⚡ 模式: 【有线模式 • 触控触发展开 • 电脑本机麦克风收音】", flush=True)
    print("=" * 65, flush=True)

    while True:
        port = find_cores3_port()
        if not port:
            print("⏳ 正在等待 CoreS3 接入电脑 USB...", end="\r", flush=True)
            time.sleep(1.0)
            continue

        try:
            ser = serial.Serial(port, 115200, timeout=0.5)
        except Exception as e:
            time.sleep(1.0)
            continue

        print(f"\n🟢 成功连接 CoreS3 硬件触控板 [{port}]！", flush=True)
        print("👉 现在你可以：", flush=True)
        print("   1. 轻点一下 CoreS3 屏幕：网易叭哥秒开，使用【电脑麦克风】说话；", flush=True)
        print("   2. 说完再点一下（或右侧发送）：网易叭哥停止录音，自动打字上屏并回车发送！", flush=True)
        print("   3. 点左下角 [✕ 取消]：1ms 瞬时取消，不发任何文字；", flush=True)
        print("   4. 屏幕左右上下滑动：快速切换当前激活窗口。", flush=True)
        print("-" * 65, flush=True)

        try:
            with ser:
                while True:
                    line = ser.readline().decode("utf-8", errors="ignore").strip()
                    if not line:
                        continue

                    print(f"[CoreS3 硬件信号] -> {line}", flush=True)

                    if line == "VOICE_START":
                        print("🎙️ [CoreS3 硬件触控] USB HID 硬件唤醒豆包输入法 -> 请使用【电脑本机麦克风】说话...", flush=True)

                    elif line == "VOICE_END":
                        print("⏹️ [CoreS3 硬件触控] USB HID 闭麦并自动回车提交 AI！", flush=True)

                    elif line == "VOICE_CANCEL":
                        print("❌ [CoreS3 硬件触控] USB HID 发送 Esc 撤销，不发文字。", flush=True)

                    elif line.startswith("CMD:switch:"):
                        target_app = line.split(":", 2)[2].strip()
                        print(f"🔄 [硬件手势] 切换窗口: {target_app}", flush=True)
                        if DesktopController:
                            DesktopController.switch_to_app(target_app)

        except serial.SerialException as e:
            print(f"\n⚠️ 设备串口断开 ({e})，重新连接中...", flush=True)
            time.sleep(1.0)
        except Exception as e:
            print(f"\n⚠️ 运行时异常: {e}", flush=True)
            time.sleep(1.0)

if __name__ == "__main__":
    run_bridge()
