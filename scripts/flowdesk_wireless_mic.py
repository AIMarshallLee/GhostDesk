"""
FlowDesk 独立无线话筒网桥 (Wireless Mic Bridge)
原理：
1. 监听 CoreS3 机身双麦克风通过 BLE 发送的实时压缩语音流 (16kHz IMA-ADPCM)
2. 实时解码并推流至 Windows 虚拟声卡 "CABLE Input"
3. 微信输入法 (WeType) 从 "CABLE Output" 接收无线音频，实现免配置、高精度语音转写输入！
"""

import sys
import time
import asyncio
import numpy as np

# 关键：Windows 11 上强制当前线程为 COM MTA 多线程套间，杜绝 WinRT 与 PortAudio/sounddevice 冲突
if sys.platform == "win32":
    import ctypes
    ctypes.windll.ole32.CoInitializeEx(None, 0x0)

try:
    import sounddevice as sd
except ImportError:
    print("[Error] 请先运行: pip install sounddevice", file=sys.stderr)
    sys.exit(1)

try:
    from bleak import BleakScanner, BleakClient
except ImportError:
    print("[Error] 请先运行: pip install bleak", file=sys.stderr)
    sys.exit(1)

# IMA-ADPCM 解码表
STEP_TABLE = [
    7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
    50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230,
    253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963,
    1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327,
    3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487,
    12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767
]
INDEX_TABLE = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8]

class AdpcmDecoder:
    def __init__(self):
        self.predicted = 0
        self.step_index = 0

    def reset(self):
        self.predicted = 0
        self.step_index = 0

    def decode_sample(self, nibble):
        step = STEP_TABLE[self.step_index]
        diff = step >> 3
        if nibble & 4: diff += step
        if nibble & 2: diff += step >> 1
        if nibble & 1: diff += step >> 2
        if nibble & 8:
            self.predicted -= diff
        else:
            self.predicted += diff

        self.predicted = max(-32768, min(32767, self.predicted))
        # 泄漏衰减 (Leaky integration)，每帧平滑向 0 衰减，彻底防止丢包导致数值积分锁死饱和
        self.predicted = (self.predicted * 255) // 256
        self.step_index += INDEX_TABLE[nibble]
        self.step_index = max(0, min(88, self.step_index))
        return self.predicted

    def decode_chunk(self, data: bytes) -> np.ndarray:
        samples = []
        for b in data:
            s1 = self.decode_sample((b >> 4) & 0x0F)
            s2 = self.decode_sample(b & 0x0F)
            samples.append(s1)
            samples.append(s2)
        return np.array(samples, dtype=np.int16)

def find_cable_input_device():
    devices = sd.query_devices()
    for idx, dev in enumerate(devices):
        name = dev['name'].lower()
        if dev['max_output_channels'] > 0 and ('cable input' in name or 'vb-cable' in name or 'blackhole' in name):
            return idx, dev['name'], dev['max_output_channels']
    for idx, dev in enumerate(devices):
        name = dev['name'].lower()
        if dev['max_output_channels'] > 0 and 'cable' in name:
            return idx, dev['name'], dev['max_output_channels']
    return None, None, 1

VOICE_CHAR_UUID = "12345678-1234-5678-1234-56789abcdef1"

async def main():
    print("=" * 60)
    print(">>> FlowDesk 独立无线话筒 音频网桥启动")
    print("=" * 60)

    cable_id, cable_name, dev_channels = find_cable_input_device()
    target_channels = min(2, max(1, dev_channels))

    # 智能探测声卡支持的采样率 (macOS CoreAudio 原生常锁定 48kHz 或 44.1kHz)
    target_sr = 16000
    if cable_id is not None:
        for candidate_sr in [16000, 48000, 44100]:
            try:
                sd.check_output_settings(device=cable_id, samplerate=candidate_sr, channels=target_channels, dtype='int16')
                target_sr = candidate_sr
                break
            except Exception:
                continue

    if cable_id is None:
        print("[提示] 尚未检测到虚拟音频设备 'VB-Cable' 或 'CABLE Input'！")
        print(">>> 正在使用系统默认音频通道做预览监听...\n")
        out_stream = sd.OutputStream(samplerate=16000, channels=1, dtype='int16')
        target_channels = 1
        target_sr = 16000
    else:
        print(f"[就绪] 成功绑定虚拟音频输入通道: [{cable_id}] {cable_name} ({target_channels}声道, {target_sr}Hz)")
        out_stream = sd.OutputStream(device=cable_id, samplerate=target_sr, channels=target_channels, dtype='int16')

    out_stream.start()
    decoder = AdpcmDecoder()

    packet_count = 0
    last_ui_time = 0
    last_packet_time = 0

    def on_voice_data(sender, data: bytearray):
        nonlocal packet_count, last_ui_time, last_packet_time
        now = time.time()
        if last_packet_time > 0 and (now - last_packet_time > 0.4):
            decoder.reset()
        last_packet_time = now

        pcm = decoder.decode_chunk(bytes(data))
        raw_peak = int(np.max(np.abs(pcm)))
        rms = int(np.sqrt(np.mean(pcm.astype(np.float32)**2)))
        
        # 1. 软件适度增益 (1.5x 保持自然人声饱满度，杜绝爆音削波)
        pcm_boosted = np.clip(pcm.astype(np.float32) * 1.5, -32768, 32767).astype(np.int16)

        # 2. 采样率平滑适配 (CoreS3 采集为 16kHz，若声卡要求 48kHz/44.1kHz 则智能插值)
        if target_sr == 48000:
            pcm_resampled = np.repeat(pcm_boosted, 3)
        elif target_sr == 16000:
            pcm_resampled = pcm_boosted
        else:
            src_len = len(pcm_boosted)
            dst_len = int(src_len * target_sr / 16000)
            pcm_resampled = np.interp(
                np.linspace(0, src_len, dst_len, endpoint=False),
                np.arange(src_len),
                pcm_boosted
            ).astype(np.int16)

        # 3. 适配 macOS CoreAudio 严格要求的双声道 (Stereo 2-channel)
        if target_channels == 2:
            pcm_out = np.column_stack((pcm_resampled, pcm_resampled))
        else:
            pcm_out = pcm_resampled

        out_stream.write(pcm_out)
        packet_count += 1

        # 实时声波跳动电平打印 (终端可视化律动表：显示真实人声 RMS 与未失真峰值)
        if now - last_ui_time >= 0.12:
            last_ui_time = now
            bar_len = min(18, rms // 220)
            bars = "█" * bar_len + "░" * (18 - bar_len)
            sys.stdout.write(f"\r[🎤 实时拾音推流] 律动: [{bars}] RMS: {rms:4d} | 原始峰值: {raw_peak:5d} | 已送达帧: {packet_count}   ")
            sys.stdout.flush()

    print(">>> 正在搜索 FlowDesk 蓝牙无线话筒设备...")
    while True:
        try:
            def is_flowdesk(d, ad):
                name = (d.name or (ad.local_name if ad else "") or "")
                if "flowdesk" in name.lower():
                    return True
                if d.address and d.address.upper().startswith("30:ED:A0:D4:B3"):
                    return True
                if ad and ad.service_uuids:
                    for u in ad.service_uuids:
                        if "1812" in u.lower() or "12345678" in u.lower():
                            return True
                return False

            # 在 macOS 上传入 HID Service UUID 即可让 CoreBluetooth 瞬间检索出“已连接”的蓝牙设备！
            device = await BleakScanner.find_device_by_filter(
                is_flowdesk,
                service_uuids=["00001812-0000-1000-8000-00805f9b34fb"],
                timeout=3.5
            )

            # 如果按服务没扫到，再全网无过滤兜底扫一次
            if not device:
                device = await BleakScanner.find_device_by_filter(is_flowdesk, timeout=2.0)

            if not device:
                print("...等待 FlowDesk 蓝牙握手 (请确认 CoreS3 在 Mac 蓝牙中已配对连接)...")
                await asyncio.sleep(2)
                continue

            dev_label = device.name or "FlowDesk Mac"
            print(f"\n>>> 找到设备: {dev_label} ({device.address})，正在建立无线音频流通道...")
            async with BleakClient(device) as client:
                print(f"[成功连接] 已接入 {dev_label} 无线双麦通道！")
                print(">>> 现在可以对着 CoreS3 机身说话，微信输入法/听写将实时捕获并出字！")
                decoder.reset()

                # 订阅语音特征通知
                try:
                    await client.start_notify(VOICE_CHAR_UUID, on_voice_data)
                except Exception as e:
                    print(f"[Info] 音频特征订阅状态: {e}，正在保持待命...")

                while client.is_connected:
                    await asyncio.sleep(1)

        except Exception as e:
            print(f"\n[重连中] 蓝牙连接波动 ({e})，2 秒后自动重试...")
            await asyncio.sleep(2)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n网桥已退出")
