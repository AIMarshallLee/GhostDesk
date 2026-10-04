"""
FlowDesk Windows BLE 自动重连守护进程 (flowdesk_win_watchdog.py)
功能：
1. 后台静默运行（无黑框、低功耗），监测「FlowDesk Marshall」设备连接状态
2. 一旦检测到设备从 Mac 切换回 Windows，瞬间通过原生 WinRT 触发系统级 BLE 重连握手
3. 实现真正开机自启、随开随连、无需手动删设备
"""

import sys
import os
import time
import asyncio
import logging

LOG_DIR = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "FlowDesk", "logs")
os.makedirs(LOG_DIR, exist_ok=True)
LOG_PATH = os.path.join(LOG_DIR, "win_watchdog.log")

class FlushingFileHandler(logging.FileHandler):
    def emit(self, record):
        super().emit(record)
        self.flush()

handler = FlushingFileHandler(LOG_PATH, encoding="utf-8")
handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", datefmt="%Y-%m-%d %H:%M:%S"))
logger = logging.getLogger()
logger.setLevel(logging.INFO)
logger.addHandler(handler)

TARGET_NAME = "FlowDesk Marshall"
CHECK_INTERVAL = 3  # 每 3 秒轻量轮询一次
RECONNECT_COOLDOWN = 15  # 触发重连后 15 秒冷却

try:
    import winrt.windows.devices.bluetooth as bt
    import winrt.windows.devices.enumeration as de
except ImportError:
    logging.error("缺少 winrt 模块，请先运行: pip install winrt-Windows.Devices.Bluetooth winrt-Windows.Devices.Enumeration")
    sys.exit(1)


async def find_paired_target_device():
    """查找已在 Windows 配对的 FlowDesk Marshall"""
    try:
        selector = bt.BluetoothLEDevice.get_device_selector_from_pairing_state(True)
        devs = await de.DeviceInformation.find_all_async_aqs_filter(selector)
        for d in devs:
            if TARGET_NAME.lower() in d.name.lower():
                return d
    except Exception as e:
        logging.warning(f"搜索已配对设备异常: {e}")
    return None


async def trigger_ble_reconnect(device_id):
    """通过 WinRT 触发系统物理重连"""
    try:
        dev = await bt.BluetoothLEDevice.from_id_async(device_id)
        if not dev:
            return False
        
        # 强制 UNCACHED 读取，唤醒 Windows 蓝牙协议栈向空中发送连线帧
        res = await dev.get_gatt_services_with_cache_mode_async(bt.BluetoothCacheMode.UNCACHED)
        is_success = (res.status == 0)
        logging.info(f"触发系统 BLE 重连结果: status={res.status} (0=连接成功)")
        return is_success
    except Exception as e:
        logging.warning(f"重连握手异常: {e}")
        return False


async def is_connected(device_id):
    """检查当前是否处于连接状态"""
    try:
        dev = await bt.BluetoothLEDevice.from_id_async(device_id)
        if dev:
            return dev.connection_status == bt.BluetoothConnectionStatus.CONNECTED
    except Exception:
        pass
    return False


async def run_watchdog():
    logging.info("=" * 60)
    logging.info("FlowDesk Windows BLE 自动重连守护进程已启动")
    logging.info(f"目标设备: {TARGET_NAME}")
    logging.info("=" * 60)

    last_reconnect_time = 0
    cached_device_id = None

    while True:
        try:
            if not cached_device_id:
                target_dev = await find_paired_target_device()
                if target_dev:
                    cached_device_id = target_dev.id
                    logging.info(f"已锁定 Windows 配对设备 ID: {cached_device_id}")
                else:
                    logging.debug(f"等待配对设备 {TARGET_NAME}...")
                    await asyncio.sleep(5)
                    continue

            connected = await is_connected(cached_device_id)
            if not connected:
                now = time.time()
                if now - last_reconnect_time >= RECONNECT_COOLDOWN:
                    logging.info(f"检测到 {TARGET_NAME} 离线，正在探测并拉起连接...")
                    last_reconnect_time = now
                    success = await trigger_ble_reconnect(cached_device_id)
                    if success:
                        logging.info(f"🎉 {TARGET_NAME} 自动重连成功！")
            else:
                # 处于正常连接状态
                pass

        except Exception as e:
            logging.error(f"守护主循环异常: {e}")

        await asyncio.sleep(CHECK_INTERVAL)


if __name__ == "__main__":
    try:
        asyncio.run(run_watchdog())
    except KeyboardInterrupt:
        logging.info("守护进程退出")
