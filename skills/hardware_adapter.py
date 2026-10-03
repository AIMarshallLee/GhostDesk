import os
import sys
import time
from typing import Optional

if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

class HardwareDriverAdapter:
    """GhostDesk 物理在环硬件驱动适配器 (Pico H 物理 HID vs 系统级驱动自适应)"""
    _pico_serial = None
    _is_hardware = False

    @classmethod
    def init_driver(cls):
        """探测并尝试连接 Pico H 硬件"""
        try:
            import serial.tools.list_ports
            for p in serial.tools.list_ports.comports():
                # 匹配 Raspberry Pi Pico 官方 VID 0x2E8A 或定制固件 0xCAFE
                if p.vid in [0x2E8A, 0xCAFE]:
                    import serial
                    cls._pico_serial = serial.Serial(p.device, 115200, timeout=0.5)
                    cls._is_hardware = True
                    print(f"[Hardware Adapter] 成功挂载 Pico H 物理防封硬件外设: [{p.device}]", flush=True)
                    return
        except Exception:
            pass

        cls._is_hardware = False
        print("[Hardware Adapter] 未检测到物理 Pico H，自动启用系统底层高稳驱动 (平滑无感)", flush=True)

    @classmethod
    def is_physical_hardware(cls) -> bool:
        return cls._is_hardware

    @classmethod
    def type_text(cls, text: str, auto_enter: bool = False):
        """下发文字输入指令"""
        if cls._is_hardware and cls._pico_serial:
            # 走物理硬件 TinyUSB 发送
            try:
                cmd = f"KEY:TYPE:{text}\n"
                cls._pico_serial.write(cmd.encode("utf-8"))
                if auto_enter:
                    time.sleep(0.05)
                    cls._pico_serial.write(b"KEY:PRESS:ENTER\n")
                return
            except Exception:
                pass

        # 软件级原生安全注入
        import pyperclip
        old_clip = pyperclip.paste()
        pyperclip.copy(text)
        time.sleep(0.05)
        
        if sys.platform == "win32":
            import ctypes
            user32 = ctypes.windll.user32
            VK_CONTROL = 0x11
            VK_V = 0x56
            VK_RETURN = 0x0D
            KEYEVENTF_KEYUP = 0x0002
            
            # Ctrl+V
            user32.keybd_event(VK_CONTROL, 0, 0, 0)
            user32.keybd_event(VK_V, 0, 0, 0)
            time.sleep(0.03)
            user32.keybd_event(VK_V, 0, KEYEVENTF_KEYUP, 0)
            user32.keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0)

            if auto_enter:
                time.sleep(0.05)
                user32.keybd_event(VK_RETURN, 0, 0, 0)
                time.sleep(0.02)
                user32.keybd_event(VK_RETURN, 0, KEYEVENTF_KEYUP, 0)
        else:
            os.system('osascript -e \'tell application "System Events" to keystroke "v" using command down\'')
            if auto_enter:
                time.sleep(0.05)
                os.system('osascript -e \'tell application "System Events" to key code 36\'')

        time.sleep(0.05)
        try:
            pyperclip.copy(old_clip)
        except Exception:
            pass

    @classmethod
    def press_hotkey(cls, *keys):
        """按下组合键"""
        if sys.platform == "win32":
            import ctypes
            # 常见快捷键
            pass

# 初始化驱动探测
HardwareDriverAdapter.init_driver()
