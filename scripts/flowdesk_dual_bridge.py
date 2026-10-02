#!/usr/bin/env python3
"""
FlowDesk M5Stack CoreS3 极速双通道无线对讲机服务 (Wi-Fi 无损音频流 + 蓝牙/USB 备用)

架构特性：
1. 【Wi-Fi 无损音频通道】：
   - 监听 UDP 8266 端口，接收 CoreS3 机身双麦克风发来的 16kHz 16bit PCM 高清音频流；
   - 随身走动、离开电脑桌面依然畅连无阻；
   - 自动进行极速语音识别 (STT)；
   - 毫秒级将文本无缝输入当前活动窗口 (VS Code / Claude / 微信 / 网页 / Antigravity)，并自动敲击回车提交！
   - 反馈识别结果至 CoreS3 屏幕显示。
2. 【手势调度通道】：
   - 支持 CoreS3 屏幕上下左右划动，无缝秒切当前激活窗口。
3. 【USB 串口备用通道】：
   - 兼顾插线调试与串口日志。
"""

import io
import os
import sys
import time
import wave
import socket
import threading

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import pyautogui
import pyperclip
pyautogui.FAILSAFE = False
import speech_recognition as sr

try:
    from scripts.desktop_switcher import DesktopController
except ImportError:
    try:
        from desktop_switcher import DesktopController
    except Exception:
        DesktopController = None

SAMPLE_RATE = 16000
UDP_LISTEN_PORT = 8266
CORES3_REPLY_PORT = 8267

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
    """语音识别处理 (超低延迟 Google STT，无缝升级豆包 ASR)"""
    # 1. 尝试火山引擎豆包大模型流式识别 (若已配置)
    try:
        from scripts.volc_streaming_asr import VolcStreamingASR, load_volc_config
        import asyncio
        volc_cfg = load_volc_config()
        if volc_cfg.get("volc_appid") and volc_cfg.get("volc_token"):
            client = VolcStreamingASR(
                app_id=volc_cfg["volc_appid"],
                access_token=volc_cfg["volc_token"],
                resource_id=volc_cfg.get("volc_cluster", "volc.bigasr.sauc.duration")
            )
            text = asyncio.run(client.transcribe_pcm_stream(pcm_bytes, sample_rate=SAMPLE_RATE))
            if text:
                return text.strip()
    except Exception:
        pass

    # 2. 免费高速中文智能识别 (Google STT Engine)
    recognizer = sr.Recognizer()
    with io.BytesIO(wav_bytes) as audio_file:
        with sr.AudioFile(audio_file) as source:
            audio_data = recognizer.record(source)
    try:
        text = recognizer.recognize_google(audio_data, language="zh-CN")
        return text.strip()
    except sr.UnknownValueError:
        return ""
    except Exception as e:
        print(f"⚠️ 在线语音引擎连接提示: {e}")
        return ""

def inject_prompt_to_active_window(text: str, auto_enter: bool = True):
    """通过剪贴板瞬时填入当前窗口，完美支持中文与特殊符号"""
    if not text:
        return
    old_clipboard = pyperclip.paste()
    try:
        pyperclip.copy(text)
        time.sleep(0.04)
        paste_modifier = "command" if sys.platform == "darwin" else "ctrl"
        pyautogui.hotkey(paste_modifier, "v")
        if auto_enter:
            time.sleep(0.06)
            pyautogui.press("enter")
        print(f"🚀 已自动发送给 AI: 【{text}】", flush=True)
    finally:
        time.sleep(0.3)
        try:
            pyperclip.copy(old_clipboard)
        except Exception:
            pass

class DualChannelBridge:
    def __init__(self):
        self.udp_sock = None
        self.audio_buffer = bytearray()
        self.is_recording = False
        self.last_client_addr = None

    def start_udp_listener(self):
        self.udp_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.udp_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.udp_sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        self.udp_sock.bind(("0.0.0.0", UDP_LISTEN_PORT))

        print(f"📡 [Wi-Fi 通道] UDP 语音接收器正在监听 0.0.0.0:{UDP_LISTEN_PORT}...", flush=True)

        while True:
            try:
                data, addr = self.udp_sock.recvfrom(4096)
                if not data:
                    continue
                self.last_client_addr = addr

                # 1. 音频数据分片 ('A' 开头)
                if data[0] == ord('A'):
                    if self.is_recording:
                        self.audio_buffer.extend(data[1:])
                    continue

                # 2. 文本控制信号
                try:
                    text_msg = data.decode("utf-8", errors="ignore").strip()
                except Exception:
                    continue

                if text_msg == "VOICE_START":
                    self.is_recording = True
                    self.audio_buffer.clear()
                    print("\n🎙️ [CoreS3 开麦] 正在接收机身板载双麦克风无线音频流...", flush=True)

                elif text_msg == "VOICE_END":
                    if not self.is_recording:
                        continue
                    self.is_recording = False
                    raw_len = len(self.audio_buffer)
                    print(f"⏹️ [CoreS3 闭麦] 音频采集完成 ({raw_len} 字节)，正在智能转写中...", flush=True)

                    if raw_len < 3200:  # 录音短于 0.1 秒
                        print("⚠️ 说话时间过短，已忽略。", flush=True)
                        self.reply_cores3(addr, "buddy\tidle\t时间过短\n")
                        continue

                    # 启动异步线程识别，绝不阻塞网络接收
                    threading.Thread(target=self.process_audio, args=(bytes(self.audio_buffer), addr), daemon=True).start()

                elif text_msg == "VOICE_CANCEL":
                    self.is_recording = False
                    self.audio_buffer.clear()
                    print("❌ [CoreS3 取消] 录音已放弃，丢弃音频，不发送任何文字。", flush=True)
                    self.reply_cores3(addr, "buddy\tidle\t已取消\n")

                elif text_msg.startswith("CMD:switch:"):
                    app_name = text_msg.split(":", 2)[2].strip()
                    print(f"🔄 [硬件手势] 切换活动窗口: {app_name}", flush=True)
                    if DesktopController:
                        DesktopController.switch_to_app(app_name)

            except Exception as e:
                time.sleep(0.1)

    def process_audio(self, pcm_bytes: bytes, addr):
        wav_bytes = pcm_to_wav_bytes(pcm_bytes, SAMPLE_RATE)
        recognized_text = recognize_speech(pcm_bytes, wav_bytes)

        if recognized_text:
            print(f"🎉 [识别结果] \"{recognized_text}\"", flush=True)
            # 反馈至 CoreS3 屏幕
            short_preview = recognized_text[:14] + ("..." if len(recognized_text) > 14 else "")
            self.reply_cores3(addr, f"buddy\tdone\t{short_preview}\n")
            # 自动打字上屏并回车
            inject_prompt_to_active_window(recognized_text, auto_enter=True)
        else:
            print("❓ 未能清晰识别人声，请重试。", flush=True)
            self.reply_cores3(addr, "buddy\terror\t未能听清\n")

    def reply_cores3(self, addr, msg: str):
        try:
            target_ip = addr[0]
            self.udp_sock.sendto(msg.encode("utf-8"), (target_ip, CORES3_REPLY_PORT))
        except Exception:
            pass

def main():
    print("=" * 68, flush=True)
    print("✨ FlowDesk M5Stack CoreS3 无线对讲机 & 桌面控制器服务已启动", flush=True)
    print("⚡ 模式: 【Wi-Fi 高清无线音频流 + CoreS3 机身收音 + 自动回车提交】", flush=True)
    print("=" * 68, flush=True)

    bridge = DualChannelBridge()
    bridge.start_udp_listener()

if __name__ == "__main__":
    main()
