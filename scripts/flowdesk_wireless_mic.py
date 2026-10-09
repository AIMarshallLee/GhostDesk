"""
FlowDesk 独立无线话筒网桥 (Wireless Mic Bridge) - 全平台强化版
原理：
1. 监听 CoreS3 机身双麦克风通过 BLE 发送的实时压缩语音流 (16kHz IMA-ADPCM)
2. 针对 macOS：优先采用原生 CoreBluetooth 引擎，秒级直连已连接系统蓝牙的 CoreS3，绕过 BLE 广播屏蔽限制
3. 针对 Windows：采用 Bleak + MTA COM 套间架构
4. 实时 2.5x 拾音动态增益 + CoreAudio 48kHz 双声道适配 + 实时终端电平跳动显示
5. 推流至虚拟声卡 (VB-Cable / BlackHole)，微信输入法秒级实时转写上屏！
"""

import sys
import time
import asyncio
import numpy as np

# 关键：开启标准输出行缓冲，并强制 Windows 11 当前线程为 COM MTA 套间
try:
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)
except Exception:
    pass

if sys.platform == "win32":
    import ctypes
    ctypes.windll.ole32.CoInitializeEx(None, 0x0)

try:
    import sounddevice as sd
except ImportError:
    print("[Error] 请先运行: pip install sounddevice", file=sys.stderr)
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

VOICE_SERVICE_UUID = "12345678-1234-5678-1234-56789abcdef0"
VOICE_CHAR_UUID    = "12345678-1234-5678-1234-56789abcdef1"

class AudioPipeline:
    def __init__(self):
        cable_id, cable_name, dev_channels = find_cable_input_device()
        self.target_channels = min(2, max(1, dev_channels))
        self.target_sr = 16000
        if cable_id is not None:
            for candidate_sr in [16000, 48000, 44100]:
                try:
                    sd.check_output_settings(device=cable_id, samplerate=candidate_sr, channels=self.target_channels, dtype='int16')
                    self.target_sr = candidate_sr
                    break
                except Exception:
                    continue

        if cable_id is None:
            print("[提示] 尚未检测到虚拟音频设备 'VB-Cable' 或 'CABLE Input'！", flush=True)
            print(">>> 正在使用系统默认音频通道做预览监听...\n", flush=True)
            self.out_stream = sd.OutputStream(samplerate=16000, channels=1, dtype='int16')
            self.target_channels = 1
            self.target_sr = 16000
        else:
            print(f"[就绪] 成功绑定虚拟音频输入通道: [{cable_id}] {cable_name} ({self.target_channels}声道, {self.target_sr}Hz)", flush=True)
            self.out_stream = sd.OutputStream(device=cable_id, samplerate=self.target_sr, channels=self.target_channels, dtype='int16')

        self.out_stream.start()
        self.decoder = AdpcmDecoder()
        self.packet_count = 0
        self.last_ui_time = 0

    def reset_decoder(self):
        self.decoder.reset()

    def process_packet(self, raw_bytes: bytes):
        pcm = self.decoder.decode_chunk(raw_bytes)
        # 1. 软件数字动态增益 (2.5x 提升远场与微弱语音清晰度，带限幅防爆音)
        pcm_boosted = np.clip(pcm.astype(np.float32) * 2.5, -32768, 32767).astype(np.int16)

        # 2. 采样率平滑适配 (CoreS3 采集为 16kHz，若声卡要求 48kHz/44.1kHz 则智能插值)
        if self.target_sr == 48000:
            pcm_resampled = np.repeat(pcm_boosted, 3)
        elif self.target_sr == 16000:
            pcm_resampled = pcm_boosted
        else:
            src_len = len(pcm_boosted)
            dst_len = int(src_len * self.target_sr / 16000)
            pcm_resampled = np.interp(
                np.linspace(0, src_len, dst_len, endpoint=False),
                np.arange(src_len),
                pcm_boosted
            ).astype(np.int16)

        # 3. 适配 macOS CoreAudio 严格要求的双声道 (Stereo 2-channel)
        if self.target_channels == 2:
            pcm_out = np.column_stack((pcm_resampled, pcm_resampled))
        else:
            pcm_out = pcm_resampled

        self.out_stream.write(pcm_out)
        self.packet_count += 1

        now = time.time()
        if now - self.last_ui_time >= 0.12:
            self.last_ui_time = now
            peak = int(np.max(np.abs(pcm_boosted)))
            bar_len = min(18, peak // 1200)
            bars = "█" * bar_len + "░" * (18 - bar_len)
            sys.stdout.write(f"\r[🎤 实时推流] 电平: [{bars}] 峰值: {peak:5d} | 已送达帧数: {self.packet_count}   ")
            sys.stdout.flush()

# ==========================================
# macOS 原生 CoreBluetooth 高性能引擎
# ==========================================
def run_darwin_engine(pipeline: AudioPipeline):
    import objc
    from CoreBluetooth import CBCentralManager, CBUUID
    from Foundation import NSRunLoop, NSDate, NSDefaultRunLoopMode

    print(">>> 启动 macOS 原生 CoreBluetooth 极速引擎...", flush=True)

    state = {
        "manager_ready": False,
        "peripheral": None,
        "connected": False,
        "subscribed": False,
        "voice_char": None
    }

    class PDelegate(objc.lookUpClass('NSObject')):
        def peripheral_didDiscoverServices_(self, p, err):
            if err:
                print(f"[Error] 发现服务异常: {err}", flush=True)
                return
            for s in p.services():
                if "12345678" in str(s.UUID()).lower():
                    char_uuid = CBUUID.UUIDWithString_(VOICE_CHAR_UUID)
                    p.discoverCharacteristics_forService_([char_uuid], s)

        def peripheral_didDiscoverCharacteristicsForService_error_(self, p, s, err):
            if err:
                print(f"[Error] 发现特征异常: {err}", flush=True)
                return
            for c in s.characteristics():
                if "abcdef1" in str(c.UUID()).lower():
                    state["voice_char"] = c
                    state["subscribed"] = True
                    p.setNotifyValue_forCharacteristic_(True, c)
                    print(f"\n[成功连接] 已接入 {p.name() or 'FlowDesk Mac'} 无线双麦通道！", flush=True)
                    print(">>> 请轻触 CoreS3 机身屏幕（显示“正在倾听”）或对着话筒说话，微信输入法将秒级实时上屏！\n", flush=True)
                    pipeline.reset_decoder()

        def peripheral_didUpdateValueForCharacteristic_error_(self, p, c, err):
            if err or not c.value():
                return
            data_bytes = bytes(c.value())
            pipeline.process_packet(data_bytes)

        def peripheral_didUpdateNotificationStateForCharacteristic_error_(self, p, c, err):
            if err:
                print(f"[Notice] 订阅状态更新: {err}", flush=True)

    p_delegate = PDelegate.new()

    class CMDelegate(objc.lookUpClass('NSObject')):
        def centralManagerDidUpdateState_(self, central):
            if central.state() == 5:
                state["manager_ready"] = True
            else:
                state["manager_ready"] = False

        def centralManager_didConnectPeripheral_(self, central, p):
            state["connected"] = True
            p.setDelegate_(p_delegate)
            service_uuid = CBUUID.UUIDWithString_(VOICE_SERVICE_UUID)
            p.discoverServices_([service_uuid])

        def centralManager_didDisconnectPeripheral_error_(self, central, p, err):
            state["connected"] = False
            state["subscribed"] = False
            state["peripheral"] = None
            print(f"\n[提示] 蓝牙设备已断开 ({err})，正在等待重新握手...", flush=True)

        def centralManager_didFailToConnectPeripheral_error_(self, central, p, err):
            state["connected"] = False
            state["peripheral"] = None
            print(f"\n[重试] 连接失败 ({err})，稍后自动重试...", flush=True)

    cm_delegate = CMDelegate.new()
    central = CBCentralManager.alloc().initWithDelegate_queue_(cm_delegate, None)

    # 等待蓝牙管理器初始化就绪
    while not state["manager_ready"]:
        NSRunLoop.currentRunLoop().runUntilDate_(NSDate.dateWithTimeIntervalSinceNow_(0.1))

    print(">>> 正在搜索 FlowDesk 蓝牙无线话筒设备...", flush=True)
    voice_cbuuid = CBUUID.UUIDWithString_(VOICE_SERVICE_UUID)
    info_cbuuid = CBUUID.UUIDWithString_("180A")

    last_waiting_print = 0

    while True:
        try:
            NSRunLoop.currentRunLoop().runUntilDate_(NSDate.dateWithTimeIntervalSinceNow_(0.02))

            if not state["connected"]:
                periphs = central.retrieveConnectedPeripheralsWithServices_([voice_cbuuid, info_cbuuid])
                target_p = None
                if periphs:
                    for p in periphs:
                        name = (p.name() or "").lower()
                        if "flowdesk" in name or "cores3" in name:
                            target_p = p
                            break
                    if not target_p and len(periphs) > 0:
                        target_p = periphs[0]

                if target_p:
                    state["peripheral"] = target_p
                    print(f"\n>>> 找到设备: {target_p.name()}，正在建立无线音频流通道...", flush=True)
                    central.connectPeripheral_options_(target_p, None)
                    # 等待连接确认
                    wait_connect_start = time.time()
                    while not state["connected"] and (time.time() - wait_connect_start < 4.0):
                        NSRunLoop.currentRunLoop().runUntilDate_(NSDate.dateWithTimeIntervalSinceNow_(0.05))
                else:
                    now = time.time()
                    if now - last_waiting_print >= 3.0:
                        last_waiting_print = now
                        print("...等待 FlowDesk 蓝牙握手 (请确认 CoreS3 在 Mac 蓝牙中已配对连接)...", flush=True)
                    time.sleep(0.5)

        except KeyboardInterrupt:
            break
        except Exception as e:
            print(f"[Exception] {e}", flush=True)
            time.sleep(1.0)

# ==========================================
# 跨平台 (Windows / Linux) Bleak 引擎
# ==========================================
async def run_bleak_engine(pipeline: AudioPipeline):
    from bleak import BleakScanner, BleakClient
    print(">>> 启动 Bleak 跨平台音频网桥...", flush=True)

    def on_voice_data(sender, data: bytearray):
        pipeline.process_packet(bytes(data))

    while True:
        try:
            device = None

            if sys.platform == "win32":
                # Windows 原生超高速直连：直接从系统已配对表中获取 FlowDesk Marshall，彻底绕过广告扫描！
                try:
                    import winrt.windows.devices.bluetooth as bt
                    import winrt.windows.devices.enumeration as de
                    from bleak.backends.device import BLEDevice

                    sel = bt.BluetoothLEDevice.get_device_selector_from_pairing_state(True)
                    devs = await de.DeviceInformation.find_all_async_aqs_filter(sel)
                    for d in devs:
                        if "marshall" in d.name.lower() or ("flowdesk" in d.name.lower() and "mac" not in d.name.lower()):
                            ble_obj = await bt.BluetoothLEDevice.from_id_async(d.id)
                            if ble_obj and ble_obj.connection_status == bt.BluetoothConnectionStatus.CONNECTED:
                                addr = ':'.join(f'{(ble_obj.bluetooth_address >> (i*8)) & 0xff:02x}' for i in reversed(range(6)))
                                device = BLEDevice(addr, d.name, None)
                                break
                except Exception:
                    device = None

            if not device:
                def is_flowdesk(d, ad):
                    name = (d.name or (ad.local_name if ad else "") or "").lower()
                    if d.address and d.address.upper().startswith("30:ED:A0:D4:B3"):
                        return True
                    if sys.platform == "darwin":
                        if "marshall" in name or "pc" in name or "win" in name:
                            return False
                        return "flowdesk mac" in name
                    else:
                        if "mac" in name:
                            return False
                        return "marshall" in name or ("flowdesk" in name and "mac" not in name)

                # macOS 或未连接状态：通过服务 UUID 或全网广播探测
                device = await BleakScanner.find_device_by_filter(
                    is_flowdesk,
                    service_uuids=["00001812-0000-1000-8000-00805f9b34fb"],
                    timeout=2.0
                )
                if not device:
                    device = await BleakScanner.find_device_by_filter(is_flowdesk, timeout=1.5)

            if not device:
                sys.stdout.write("\r...等待 FlowDesk 蓝牙就绪 (切回 Windows 时将在 1~2 秒内自动接入)...   ")
                sys.stdout.flush()
                await asyncio.sleep(1.5)
                continue

            dev_label = device.name or "FlowDesk"
            print(f"\n>>> 找到设备: {dev_label} ({device.address})，正在建立无线音频通道...", flush=True)
            async with BleakClient(device) as client:
                print(f"[成功连接] 已接入 {dev_label} 无线双麦通道！", flush=True)
                pipeline.reset_decoder()
                await client.start_notify(VOICE_CHAR_UUID, on_voice_data)
                while client.is_connected:
                    await asyncio.sleep(1)

        except Exception as e:
            print(f"\n[重连中] 蓝牙连接波动 ({e})，2 秒后自动重试...", flush=True)
            await asyncio.sleep(2)

def main():
    print("=" * 60, flush=True)
    print(">>> FlowDesk 独立无线话筒 音频网桥启动", flush=True)
    print("=" * 60, flush=True)

    pipeline = AudioPipeline()

    if sys.platform == "darwin":
        run_darwin_engine(pipeline)
    else:
        asyncio.run(run_bleak_engine(pipeline))

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n网桥已退出", flush=True)
