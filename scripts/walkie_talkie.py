#!/usr/bin/env python3
"""
GhostDesk AI 对讲机后台接收服务 (AI Walkie-Talkie Daemon)
与桌面上手持的 M5Stack CoreS3 联动：
1. 监听 CoreS3 对讲机按住说话发来的实时音频流 (16kHz 16bit PCM)
2. 自动进行智能语音转文字 (STT)
3. 瞬间将识别出的 Prompt 粘贴并敲入电脑当前激活的输入框 (VS Code / Antigravity / Claude 等)
4. 联动 CoreS3 屏幕显示笑脸并播放完成音效

安装依赖:
    pip install pyserial SpeechRecognition pyperclip pyautogui
"""

import io
import os
import struct
import sys
import time
import wave

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# 自动补全必要轻量库 (模块名 -> pip 包名映射，防止误装废弃的 serial 包)
REQUIRED_PACKAGES = {
    "serial": "pyserial>=3.5",
    "speech_recognition": "SpeechRecognition>=3.10.0",
    "pyperclip": "pyperclip>=1.8.2",
    "pyautogui": "pyautogui>=0.9.54",
}
for mod, pkg in REQUIRED_PACKAGES.items():
    try:
        __import__(mod)
    except ImportError:
        import subprocess
        print(f"正在自动安装轻量依赖库 {pkg} (模块: {mod})...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", pkg])

import pyautogui
import pyperclip
pyautogui.FAILSAFE = False
import serial
import serial.tools.list_ports
import speech_recognition as sr

try:
    from scripts.desktop_switcher import IntentDispatcher, DesktopController, activate_window_win32, list_windows
except ImportError:
    from desktop_switcher import IntentDispatcher, DesktopController, activate_window_win32, list_windows

try:
    from scripts.volc_streaming_asr import VolcStreamingASR, load_volc_config
except ImportError:
    from volc_streaming_asr import VolcStreamingASR, load_volc_config

import asyncio

SAMPLE_RATE = 16000


def find_cores3_port():
    """自动扫描并匹配 M5Stack CoreS3 设备 (支持 Windows COM 与 macOS /dev/cu.usbmodem)"""
    ports = serial.tools.list_ports.comports()
    for p in ports:
        if p.vid == 0xCAFE and p.pid == 0x4001:
            return p.device
        if "FlowDesk" in (p.description or "") or "CoreS3" in (p.description or ""):
            return p.device
        # ESP32-S3 原生 USB-JTAG/CDC 备选 VID
        if p.vid == 0x303A:
            return p.device

    # macOS 特别回退：唯一外接 usbmodem 设备
    if sys.platform == "darwin":
        usbmodems = [p.device for p in ports if "usbmodem" in p.device]
        if len(usbmodems) == 1:
            return usbmodems[0]

    return None



def apply_software_agc(pcm_bytes: bytes, target_rms: float = 3500.0, max_gain: float = 8.0) -> bytes:
    """自适应增益控制 (AGC)：针对 1.5~2 米远距离拾音，动态平滑放大声波，防止破音截断"""
    if not pcm_bytes or len(pcm_bytes) < 4:
        return pcm_bytes
    count = len(pcm_bytes) // 2
    samples = struct.unpack(f"<{count}h", pcm_bytes[:count * 2])

    sq_sum = sum(s * s for s in samples)
    current_rms = (sq_sum / count) ** 0.5
    if current_rms < 15.0:  # 极低静音阈值
        return pcm_bytes

    gain = min(target_rms / current_rms, max_gain)
    if gain <= 1.05:
        return pcm_bytes

    print(f"🔊 [远场声学 AGC 自动补偿] 检测到人声较远 (RMS={current_rms:.1f})，已动态无损增益 {gain:.2f}x")
    boosted = []
    for s in samples:
        val = int(s * gain)
        if val > 32767:
            val = 32767
        elif val < -32768:
            val = -32768
        boosted.append(val)

    return struct.pack(f"<{count}h", *boosted)


def pcm_to_wav_bytes(pcm_data: bytes, sample_rate: int = 16000) -> bytes:
    """将 PCM 裸数据封装为标准 WAV 格式"""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)  # 单声道
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_data)
    return buf.getvalue()


def recognize_speech(pcm_bytes: bytes, wav_bytes: bytes) -> str:
    """语音识别处理 (优先火山引擎豆包大模型流式识别，无配置则自动回退)"""
    volc_cfg = load_volc_config()
    if volc_cfg.get("volc_appid") and volc_cfg.get("volc_token"):
        try:
            print("🚀 正在通过火山引擎豆包大模型 2.0 (SeedASR) 进行极速流式识别...")
            import sys
            sys.path.insert(0, os.path.join(os.path.dirname(__file__), "volc_official_demo", "sauc_python"))
            import protocol

            config = protocol.Config(
                app_key=volc_cfg["volc_appid"],
                access_key=volc_cfg["volc_token"],
                resource_id="volc.seedasr.sauc.duration"
            )
            temp_wav = os.path.join(os.path.dirname(__file__), "temp_record.wav")
            with open(temp_wav, "wb") as f:
                f.write(wav_bytes)

            async def run_asr():
                url = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async"
                payload = {
                    "user": {"uid": "ghostdesk_user"},
                    "audio": {
                        "format": "wav",
                        "codec": "raw",
                        "rate": 16000,
                        "bits": 16,
                        "channel": 1
                    },
                    "request": {
                        "model_name": "bigmodel",
                        "enable_itn": True,
                        "enable_punc": True,
                        "enable_ddc": True,
                        "show_utterances": True,
                        "enable_nonstream": True
                    }
                }
                text_out = ""
                async with protocol.AsrWsClient(url, segment_duration=200) as client:
                    async for response in client.execute(temp_wav, config, payload):
                        if response.payload_msg and "result" in response.payload_msg:
                            res = response.payload_msg["result"]
                            if "text" in res and res["text"]:
                                text_out = res["text"]
                return text_out

            text = asyncio.run(run_asr())
            if text:
                return text.strip()
        except Exception as e:
            print(f"⚠️ 火山流式识别异常: {e}")

    recognizer = sr.Recognizer()
    with io.BytesIO(wav_bytes) as audio_file:
        with sr.AudioFile(audio_file) as source:
            audio_data = recognizer.record(source)

    try:
        # 备选通用识别
        text = recognizer.recognize_google(audio_data, language="zh-CN")
        return text.strip()
    except sr.UnknownValueError:
        return ""
    except sr.RequestError as e:
        print(f"⚠️ 在线语音连接失败 ({e})。配置火山方舟 AppID/Token 即可启用豆包大模型原生流式识别。")
        return ""
    except Exception as e:
        print(f"⚠️ 语音识别异常: {e}")
        return ""


def ensure_coding_window_focused():
    """自动将正在使用的代码或AI对话窗口聚焦到前台，突破 Windows 前台聚焦限制"""
    if sys.platform != "win32":
        return True

    import ctypes
    cur_fg = ctypes.windll.user32.GetForegroundWindow()

    # 优先查找目前运行的 AI/代码开发应用窗口
    priority_apps = ["antigravity", "vscode", "terminal", "claude", "chatgpt"]
    for app_key in priority_apps:
        w = DesktopController.find_app_window(app_key)
        if w:
            if cur_fg == w["hwnd"]:
                return True # 已经在前台聚焦，0 延迟跳过！
            activate_window_win32(w["hwnd"])
            time.sleep(0.08)
            return True
    return False


def inject_prompt_to_active_window(text: str, auto_enter: bool = True):
    """自动唤醒目标窗口，极速无感填入并敲击 Enter 回车发送"""
    if not text:
        return

    # 1. 确保前台窗口处于就绪状态
    ensure_coding_window_focused()

    # 2. 写入剪贴板 (极速 30ms 剪贴板就绪)
    pyperclip.copy(text)
    time.sleep(0.03)

    # 3. 硬件级极速发送 Ctrl+V 与 Enter 回车
    if sys.platform == "win32":
        import ctypes
        user32 = ctypes.windll.user32
        KEYEVENTF_KEYUP = 0x0002
        VK_CONTROL = 0x11
        VK_V = 0x56
        VK_RETURN = 0x0D

        # 瞬时按下并释放 Ctrl+V
        user32.keybd_event(VK_CONTROL, 0, 0, 0)
        user32.keybd_event(VK_V, 0, 0, 0)
        time.sleep(0.02)
        user32.keybd_event(VK_V, 0, KEYEVENTF_KEYUP, 0)
        user32.keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0)

        if auto_enter:
            time.sleep(0.06)
            # 瞬时敲击回车 Enter
            user32.keybd_event(VK_RETURN, 0, 0, 0)
            time.sleep(0.02)
            user32.keybd_event(VK_RETURN, 0, KEYEVENTF_KEYUP, 0)
    else:
        # macOS
        paste_modifier = "command" if sys.platform == "darwin" else "ctrl"
        pyautogui.hotkey(paste_modifier, "v")
        if auto_enter:
            time.sleep(0.06)
            pyautogui.press("enter")

    print(f"🚀 已全自动填入并敲击回车: 【{text}】")


import threading

def handle_audio_async(raw_buffer: bytes, ser):
    def worker():
        if len(raw_buffer) < 3200:
            print("⚠️ 说话时间过短，已忽略。")
            try:
                ser.write("buddy\tidle\t录音时间过短\n".encode("utf-8"))
            except Exception:
                pass
            return

        boosted_pcm = apply_software_agc(raw_buffer, target_rms=3500.0, max_gain=8.0)
        wav_data = pcm_to_wav_bytes(boosted_pcm, SAMPLE_RATE)
        prompt_text = recognize_speech(boosted_pcm, wav_data)

        if prompt_text:
            print(f"🎉 识别成功: \"{prompt_text}\"")
            short_msg = prompt_text[:16] + ("..." if len(prompt_text) > 16 else "")
            try:
                ser.write(f"buddy\tdone\t{short_msg}\n".encode("utf-8"))
            except Exception:
                pass
            inject_prompt_to_active_window(prompt_text, auto_enter=True)
            try:
                ser.write(b"NOTICE:SENT\n")
            except Exception:
                pass
        else:
            print("❓ 未能清晰识别人声，请重试。")
            try:
                ser.write("buddy\terror\t未能听清，请重试\n".encode("utf-8"))
            except Exception:
                pass

    threading.Thread(target=worker, daemon=True).start()


def run_walkie_talkie_daemon():
    print("=" * 60)
    print("🎙️ GhostDesk M5Stack CoreS3 智能 AI 对讲机服务已就绪")
    print("=" * 60)

    while True:
        port = find_cores3_port()
        if not port:
            print("⏳ 正在等待 M5Stack CoreS3 接入电脑 USB...", end="\r")
            time.sleep(1.5)
            continue

        print(f"\n✨ 成功握手 M5Stack CoreS3 对讲机设备 [{port}]！")
        print("👉 现在你可以：")
        print("   1. 在 CoreS3 上【长按中间大圆键】说话，松手即刻自动打入当前窗口并回车！")
        print("   2. 点击左下角【APPROVE】一键放行确认；点击右下角【REJECT】一键中断。")

        try:
            with serial.Serial(port, 115200, timeout=1.0) as ser:
                is_recording = False
                audio_buffer = bytearray()

                while True:
                    line = ser.readline().decode("utf-8", errors="ignore").strip()
                    if not line:
                        continue

                    if line.startswith("CMD:switch:"):
                        app_target = line.split(":", 2)[2].strip()
                        print(f"\n👆 [CoreS3 硬件手势] 滑动切换应用: {app_target}")
                        DesktopController.switch_to_app(app_target)
                        continue

                    elif line == "CMD:right_alt":
                        print("\n⌨️ [CoreS3 硬件指令] 触发电脑端原生输入法语音 (发送 Right Alt)...")
                        if sys.platform == "win32":
                            import ctypes
                            VK_RMENU = 0xA5
                            KEYEVENTF_KEYUP = 0x0002
                            KEYEVENTF_EXTENDEDKEY = 0x0001
                            ctypes.windll.user32.keybd_event(VK_RMENU, 0, KEYEVENTF_EXTENDEDKEY, 0)
                            time.sleep(0.05)
                            ctypes.windll.user32.keybd_event(VK_RMENU, 0, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, 0)
                        continue

                    elif line == "CMD:escape":
                        print("\n✕ [CoreS3 硬件指令] 收到取消指令 (发送 Escape 撤销输入)...")
                        if sys.platform == "win32":
                            import ctypes
                            VK_ESCAPE = 0x1B
                            KEYEVENTF_KEYUP = 0x0002
                            ctypes.windll.user32.keybd_event(VK_ESCAPE, 0, 0, 0)
                            time.sleep(0.04)
                            ctypes.windll.user32.keybd_event(VK_ESCAPE, 0, KEYEVENTF_KEYUP, 0)
                        continue

                    elif line == "CMD:enter":
                        print("\n⏎ [CoreS3 硬件指令] 收到回车发送指令...")
                        if sys.platform == "win32":
                            import ctypes
                            user32 = ctypes.windll.user32
                            user32.GetForegroundWindow.restype = ctypes.c_void_p
                            hwnd = user32.GetForegroundWindow()
                            win_title = "活动窗口"
                            if hwnd:
                                title_buf = ctypes.create_unicode_buffer(512)
                                user32.GetWindowTextW(hwnd, title_buf, 512)
                                if title_buf.value:
                                    win_title = title_buf.value

                            print(f"🎯 正在向窗口 [{win_title}] 注入物理回车 Enter...")
                            time.sleep(0.04)
                            VK_RETURN = 0x0D
                            KEYEVENTF_KEYUP = 0x0002
                            user32.keybd_event(VK_RETURN, 0, 0, 0)
                            time.sleep(0.04)
                            user32.keybd_event(VK_RETURN, 0, KEYEVENTF_KEYUP, 0)
                            print(f"✅ 回车已成功敲击入 [{win_title}]！")
                            try:
                                ser.write(b"NOTICE:SENT\n")
                            except Exception:
                                pass
                        continue

                    elif line == "CMD:pageup":
                        print("\n⬆️ [CoreS3 翻页遥控] 上一页 Page Up")
                        if sys.platform == "win32":
                            import ctypes
                            VK_PRIOR = 0x21
                            KEYEVENTF_KEYUP = 0x0002
                            KEYEVENTF_EXTENDEDKEY = 0x0001
                            ctypes.windll.user32.keybd_event(VK_PRIOR, 0, KEYEVENTF_EXTENDEDKEY, 0)
                            time.sleep(0.03)
                            ctypes.windll.user32.keybd_event(VK_PRIOR, 0, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, 0)
                        continue

                    elif line == "CMD:pagedown":
                        print("\n⬇️ [CoreS3 翻页遥控] 下一页 Page Down")
                        if sys.platform == "win32":
                            import ctypes
                            VK_NEXT = 0x22
                            KEYEVENTF_KEYUP = 0x0002
                            KEYEVENTF_EXTENDEDKEY = 0x0001
                            ctypes.windll.user32.keybd_event(VK_NEXT, 0, KEYEVENTF_EXTENDEDKEY, 0)
                            time.sleep(0.03)
                            ctypes.windll.user32.keybd_event(VK_NEXT, 0, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, 0)
                        continue

                    elif line == "CMD:vol_up":
                        print("\n🔊 [CoreS3 多媒体] 音量增加 +")
                        if sys.platform == "win32":
                            import ctypes
                            VK_VOLUME_UP = 0xAF
                            KEYEVENTF_KEYUP = 0x0002
                            ctypes.windll.user32.keybd_event(VK_VOLUME_UP, 0, 0, 0)
                            time.sleep(0.02)
                            ctypes.windll.user32.keybd_event(VK_VOLUME_UP, 0, KEYEVENTF_KEYUP, 0)
                        continue

                    elif line == "CMD:vol_down":
                        print("\n🔉 [CoreS3 多媒体] 音量减小 -")
                        if sys.platform == "win32":
                            import ctypes
                            VK_VOLUME_DOWN = 0xAE
                            KEYEVENTF_KEYUP = 0x0002
                            ctypes.windll.user32.keybd_event(VK_VOLUME_DOWN, 0, 0, 0)
                            time.sleep(0.02)
                            ctypes.windll.user32.keybd_event(VK_VOLUME_DOWN, 0, KEYEVENTF_KEYUP, 0)
                        continue

                    elif line == "CMD:mute":
                        print("\n🔇 [CoreS3 多媒体] 静音开关 Mute")
                        if sys.platform == "win32":
                            import ctypes
                            VK_VOLUME_MUTE = 0xAD
                            KEYEVENTF_KEYUP = 0x0002
                            ctypes.windll.user32.keybd_event(VK_VOLUME_MUTE, 0, 0, 0)
                            time.sleep(0.02)
                            ctypes.windll.user32.keybd_event(VK_VOLUME_MUTE, 0, KEYEVENTF_KEYUP, 0)
                        continue

                    elif line == "CMD:play_pause":
                        print("\n⏯️ [CoreS3 多媒体] 播放/暂停")
                        if sys.platform == "win32":
                            import ctypes
                            VK_MEDIA_PLAY_PAUSE = 0xB3
                            KEYEVENTF_KEYUP = 0x0002
                            ctypes.windll.user32.keybd_event(VK_MEDIA_PLAY_PAUSE, 0, 0, 0)
                            time.sleep(0.02)
                            ctypes.windll.user32.keybd_event(VK_MEDIA_PLAY_PAUSE, 0, KEYEVENTF_KEYUP, 0)
                        continue

                    elif line == "CMD:next_track":
                        print("\n⏭️ [CoreS3 多媒体] 下一曲 Next")
                        if sys.platform == "win32":
                            import ctypes
                            VK_MEDIA_NEXT_TRACK = 0xB0
                            KEYEVENTF_KEYUP = 0x0002
                            ctypes.windll.user32.keybd_event(VK_MEDIA_NEXT_TRACK, 0, 0, 0)
                            time.sleep(0.02)
                            ctypes.windll.user32.keybd_event(VK_MEDIA_NEXT_TRACK, 0, KEYEVENTF_KEYUP, 0)
                        continue

                    elif line == "CMD:prev_track":
                        print("\n⏮️ [CoreS3 多媒体] 上一曲 Prev")
                        if sys.platform == "win32":
                            import ctypes
                            VK_MEDIA_PREV_TRACK = 0xB1
                            KEYEVENTF_KEYUP = 0x0002
                            ctypes.windll.user32.keybd_event(VK_MEDIA_PREV_TRACK, 0, 0, 0)
                            time.sleep(0.02)
                            ctypes.windll.user32.keybd_event(VK_MEDIA_PREV_TRACK, 0, KEYEVENTF_KEYUP, 0)
                        continue

                    elif line == "CMD:screenshot":
                        print("\n✂️ [CoreS3 快捷台] 触发微信截图 (Ctrl + J)...")
                        if sys.platform == "win32":
                            import ctypes
                            VK_CONTROL = 0x11
                            VK_J = 0x4A
                            KEYEVENTF_KEYUP = 0x0002
                            ctypes.windll.user32.keybd_event(VK_CONTROL, 0, 0, 0)
                            ctypes.windll.user32.keybd_event(VK_J, 0, 0, 0)
                            time.sleep(0.04)
                            ctypes.windll.user32.keybd_event(VK_J, 0, KEYEVENTF_KEYUP, 0)
                            ctypes.windll.user32.keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0)
                        continue

                    elif line == "CMD:lock":
                        print("\n🔒 [CoreS3 快捷台] 一键锁屏 LockWorkStation")
                        if sys.platform == "win32":
                            import ctypes
                            ctypes.windll.user32.LockWorkStation()
                        continue

                    elif line == "CMD:desktop":
                        print("\n🖥️ [CoreS3 快捷台] 一键显示/恢复桌面...")
                        if sys.platform == "win32":
                            import ctypes
                            # 方法 1: 发送任务栏消息 407 (Windows 原生 Toggle Desktop)
                            tray_hwnd = ctypes.windll.user32.FindWindowW("Shell_TrayWnd", None)
                            if tray_hwnd:
                                ctypes.windll.user32.PostMessageW(tray_hwnd, 0x0111, 407, 0)
                            else:
                                # 方法 2: COM 接口 ToggleDesktop
                                try:
                                    import win32com.client
                                    win32com.client.Dispatch("Shell.Application").ToggleDesktop()
                                except Exception:
                                    # 兜底 Win + D
                                    VK_LWIN = 0x5B
                                    VK_D = 0x44
                                    KEYEVENTF_KEYUP = 0x0002
                                    ctypes.windll.user32.keybd_event(VK_LWIN, 0, 0, 0)
                                    ctypes.windll.user32.keybd_event(VK_D, 0, 0, 0)
                                    time.sleep(0.04)
                                    ctypes.windll.user32.keybd_event(VK_D, 0, KEYEVENTF_KEYUP, 0)
                                    ctypes.windll.user32.keybd_event(VK_LWIN, 0, KEYEVENTF_KEYUP, 0)
                    elif line.startswith("MOUSE:"):
                        # MOUSE:dx,dy,wheel
                        parts = line[6:].split(',')
                        if len(parts) >= 2:
                            try:
                                dx = int(parts[0])
                                dy = int(parts[1])
                                wheel = int(parts[2]) if len(parts) >= 3 else 0
                                if sys.platform == "win32":
                                    import ctypes
                                    user32 = ctypes.windll.user32
                                    if dx != 0 or dy != 0:
                                        user32.mouse_event(0x0001, ctypes.c_long(dx), ctypes.c_long(dy), 0, 0)
                                    if wheel != 0:
                                        user32.mouse_event(0x0800, 0, 0, wheel * 120, 0)
                            except Exception:
                                pass
                    elif line == "MODE:TOUCH_MOUSE":
                        print("\n🖱️ [CoreS3 触控板] 进入触控鼠标模式 (双通道待命，指哪打哪)...")
                        continue

                    elif line == "CMD:mouse_left":
                        if sys.platform == "win32":
                            import ctypes
                            user32 = ctypes.windll.user32
                            user32.mouse_event(0x0002, 0, 0, 0, 0) # LEFTDOWN
                            time.sleep(0.015)
                            user32.mouse_event(0x0004, 0, 0, 0, 0) # LEFTUP
                        continue

                    elif line == "CMD:mouse_double_click":
                        if sys.platform == "win32":
                            import ctypes
                            user32 = ctypes.windll.user32
                            user32.mouse_event(0x0002, 0, 0, 0, 0)
                            user32.mouse_event(0x0004, 0, 0, 0, 0)
                            time.sleep(0.04)
                            user32.mouse_event(0x0002, 0, 0, 0, 0)
                            user32.mouse_event(0x0004, 0, 0, 0, 0)
                        continue

                    elif line == "CMD:mouse_right":
                        if sys.platform == "win32":
                            import ctypes
                            user32 = ctypes.windll.user32
                            user32.mouse_event(0x0008, 0, 0, 0, 0) # RIGHTDOWN
                            time.sleep(0.015)
                            user32.mouse_event(0x0010, 0, 0, 0, 0) # RIGHTUP
                        continue

                    elif line == "CMD:switch_window":
                        print("\n🔀 [CoreS3 快捷台] 切换应用 (Alt + Tab / Switch App)...")
                        if sys.platform == "win32":
                            import ctypes
                            user32 = ctypes.windll.user32
                            VK_MENU = 0x12
                            VK_TAB = 0x09
                            KEYEVENTF_KEYUP = 0x0002
                            user32.keybd_event(VK_MENU, 0, 0, 0)
                            user32.keybd_event(VK_TAB, 0, 0, 0)
                            time.sleep(0.03)
                            user32.keybd_event(VK_TAB, 0, KEYEVENTF_KEYUP, 0)
                            user32.keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, 0)
                        continue

                    elif line == "CMD:select_all":
                        print("\n📑 [CoreS3 快捷台] 全选 Ctrl + A")
                        if sys.platform == "win32":
                            import ctypes
                            VK_CONTROL = 0x11
                            VK_A = 0x41
                            KEYEVENTF_KEYUP = 0x0002
                            ctypes.windll.user32.keybd_event(VK_CONTROL, 0, 0, 0)
                            ctypes.windll.user32.keybd_event(VK_A, 0, 0, 0)
                            time.sleep(0.03)
                            ctypes.windll.user32.keybd_event(VK_A, 0, KEYEVENTF_KEYUP, 0)
                            ctypes.windll.user32.keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0)
                        continue

                    elif line == "CMD:copy":
                        print("\n📋 [CoreS3 快捷台] 复制 Ctrl + C")
                        if sys.platform == "win32":
                            import ctypes
                            VK_CONTROL = 0x11
                            VK_C = 0x43
                            KEYEVENTF_KEYUP = 0x0002
                            ctypes.windll.user32.keybd_event(VK_CONTROL, 0, 0, 0)
                            ctypes.windll.user32.keybd_event(VK_C, 0, 0, 0)
                            time.sleep(0.03)
                            ctypes.windll.user32.keybd_event(VK_C, 0, KEYEVENTF_KEYUP, 0)
                            ctypes.windll.user32.keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0)
                        continue

                    elif line == "CMD:paste":
                        print("\n📋 [CoreS3 快捷台] 粘贴 Ctrl + V")
                        if sys.platform == "win32":
                            import ctypes
                            VK_CONTROL = 0x11
                            VK_V = 0x56
                            KEYEVENTF_KEYUP = 0x0002
                            ctypes.windll.user32.keybd_event(VK_CONTROL, 0, 0, 0)
                            ctypes.windll.user32.keybd_event(VK_V, 0, 0, 0)
                            time.sleep(0.03)
                            ctypes.windll.user32.keybd_event(VK_V, 0, KEYEVENTF_KEYUP, 0)
                            ctypes.windll.user32.keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0)
                        continue

                    elif line == "CMD:clear_input":
                        print("\n🧹 [CoreS3 硬件指令] 取消录音：全选并清空输入框 (Ctrl+A -> Backspace)...")
                        if sys.platform == "win32":
                            import ctypes
                            VK_CONTROL = 0x11
                            VK_A = 0x41
                            VK_BACK = 0x08
                            KEYEVENTF_KEYUP = 0x0002
                            # Ctrl + A
                            ctypes.windll.user32.keybd_event(VK_CONTROL, 0, 0, 0)
                            ctypes.windll.user32.keybd_event(VK_A, 0, 0, 0)
                            time.sleep(0.02)
                            ctypes.windll.user32.keybd_event(VK_A, 0, KEYEVENTF_KEYUP, 0)
                            ctypes.windll.user32.keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0)
                            time.sleep(0.03)
                            # Backspace
                            ctypes.windll.user32.keybd_event(VK_BACK, 0, 0, 0)
                            time.sleep(0.02)
                            ctypes.windll.user32.keybd_event(VK_BACK, 0, KEYEVENTF_KEYUP, 0)
                        continue

                    elif line == "CMD:undo":
                        print("\n↩️ [CoreS3 快捷台] 撤销 Ctrl + Z")
                        if sys.platform == "win32":
                            import ctypes
                            VK_CONTROL = 0x11
                            VK_Z = 0x5A
                            KEYEVENTF_KEYUP = 0x0002
                            ctypes.windll.user32.keybd_event(VK_CONTROL, 0, 0, 0)
                            ctypes.windll.user32.keybd_event(VK_Z, 0, 0, 0)
                            time.sleep(0.03)
                            ctypes.windll.user32.keybd_event(VK_Z, 0, KEYEVENTF_KEYUP, 0)
                            ctypes.windll.user32.keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0)
                        continue

                    elif line == "VOICE_START":
                        is_recording = True
                        audio_buffer = bytearray()
                        print("\n🎙️ [对讲机开麦] 正在倾听您的指令...")

                    elif line == "VOICE_CANCEL":
                        is_recording = False
                        audio_buffer = bytearray()
                        print("\n❌ [对讲机取消] 用户已取消本次录音。")

                    elif line == "VOICE_END":
                        is_recording = False
                        print(f"⏹️ [对讲机闭麦] 采样完成 ({len(audio_buffer)} 字节)，后台异步转写中...")
                        handle_audio_async(bytes(audio_buffer), ser)
                        audio_buffer = bytearray()

                    elif line.startswith("V:") and is_recording:
                        # 解析十六进制音频块
                        hex_str = line[2:]
                        try:
                            chunk = bytes.fromhex(hex_str)
                            audio_buffer.extend(chunk)
                        except ValueError:
                            pass

        except serial.SerialException as e:
            print(f"\n⚠️ 设备断开: {e}，正在尝试重连...")
            time.sleep(2)
        except KeyboardInterrupt:
            print("\n👋 对讲机后台服务已退出。")
            break


if __name__ == "__main__":
    run_walkie_talkie_daemon()
