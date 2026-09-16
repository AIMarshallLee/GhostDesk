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
import serial
import serial.tools.list_ports
import speech_recognition as sr

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



def pcm_to_wav_bytes(pcm_data: bytes, sample_rate: int = 16000) -> bytes:
    """将 PCM 裸数据封装为标准 WAV 格式"""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)  # 单声道
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_data)
    return buf.getvalue()


def recognize_speech(wav_bytes: bytes) -> str:
    """语音识别处理 (优先免 Key 极速识别)"""
    recognizer = sr.Recognizer()
    with io.BytesIO(wav_bytes) as audio_file:
        with sr.AudioFile(audio_file) as source:
            audio_data = recognizer.record(source)

    try:
        # 使用 Google 免费语音识别接口 (支持中文普通话与英文)
        text = recognizer.recognize_google(audio_data, language="zh-CN")
        return text.strip()
    except sr.UnknownValueError:
        return ""
    except Exception as e:
        print(f"⚠️ 语音识别异常: {e}")
        return ""


def inject_prompt_to_active_window(text: str, auto_enter: bool = True):
    """通过剪贴板瞬时填入当前窗口，完美支持中文与特殊符号"""
    if not text:
        return
    # 备份旧剪贴板
    old_clipboard = pyperclip.paste()
    try:
        pyperclip.copy(text)
        time.sleep(0.05)
        pyautogui.hotkey("ctrl", "v")
        if auto_enter:
            time.sleep(0.08)
            pyautogui.press("enter")
        print(f"🚀 已自动发送给 AI: 【{text}】")
    finally:
        # 短暂延迟后恢复剪贴板
        time.sleep(0.5)
        pyperclip.copy(old_clipboard)


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

                    if line == "VOICE_START":
                        is_recording = True
                        audio_buffer = bytearray()
                        print("\n🎙️ [对讲机开麦] 正在倾听您的指令...")

                    elif line == "VOICE_END":
                        is_recording = False
                        print(f"⏹️ [对讲机闭麦] 采样完成 ({len(audio_buffer)} 字节)，正在智能识别中...")

                        if len(audio_buffer) < 3200:  # 录音过短 (小于0.1秒)
                            print("⚠️ 说话时间过短，已忽略。")
                            ser.write(b"buddy\tidle\t录音时间过短\n")
                            ser.flush()
                            continue

                        # 语音识别
                        wav_data = pcm_to_wav_bytes(bytes(audio_buffer), SAMPLE_RATE)
                        prompt_text = recognize_speech(wav_data)

                        if prompt_text:
                            print(f"🎉 识别成功: \"{prompt_text}\"")
                            # 通知 CoreS3 屏幕与声音
                            short_msg = prompt_text[:16] + ("..." if len(prompt_text) > 16 else "")
                            ser.write(f"buddy\tdone\t{short_msg}\n".encode("utf-8"))
                            ser.flush()
                            # 自动键入当前活动的 IDE / 终端
                            inject_prompt_to_active_window(prompt_text, auto_enter=True)
                        else:
                            print("❓ 未能清晰识别人声，请重试。")
                            ser.write(b"buddy\terror\t未能听清，请重试\n")
                            ser.flush()

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
