import os
import sys
import time
import subprocess
import serial
import serial.tools.list_ports

python_exe = r"C:\Users\dasea\AppData\Local\Programs\Python\Python311\python.exe"
firmware_dir = r"E:\GhostDesk\firmware\m5stack_cores3\.pio\build\m5stack-cores3"
bootloader = os.path.join(firmware_dir, "bootloader.bin")
partitions = os.path.join(firmware_dir, "partitions.bin")
firmware = os.path.join(firmware_dir, "firmware.bin")

def find_esp_ports():
    ports = []
    for p in serial.tools.list_ports.comports():
        if p.vid == 0x303A and p.pid == 0x1001:
            ports.append(p.device)
    return ports

print("🔍 正在扫描设备...")
ports = find_esp_ports()
print("当前发现 ESP32-S3 端口:", ports)

if not ports:
    print("❌ 未发现 ESP32-S3 端口！")
    sys.exit(1)

current_port = ports[0]

# 尝试直接使用 esptool 带有 usb-reset 烧录
def try_flash(target_port):
    print(f"\n🚀 尝试在端口 [{target_port}] 上执行烧录...")
    cmd = [
        python_exe, "-m", "esptool",
        "--chip", "esp32s3",
        "--port", target_port,
        "--baud", "921600",
        "--before", "usb-reset",
        "--after", "hard-reset",
        "write-flash", "-z",
        "--flash-mode", "dio",
        "--flash-freq", "80m",
        "--flash-size", "16MB",
        "0x0000", bootloader,
        "0x8000", partitions,
        "0x10000", firmware
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    print(res.stdout)
    if res.stderr:
        print("STDERR:", res.stderr)
    return res.returncode == 0

# 1. 优先尝试直接烧录
if try_flash(current_port):
    print("🎉 烧录成功！")
    sys.exit(0)

print("\n⚠️ 直接烧录未连接，正在通过 DTR/RTS 信号触发纯纯软件复位进入 Bootloader...")

# 2. 软件触发复位
try:
    with serial.Serial(current_port, 115200) as s:
        s.dtr = False
        s.rts = True
        time.sleep(0.1)
        s.dtr = True
        s.rts = False
        time.sleep(0.1)
except Exception as e:
    print("触发复位过程:", e)

# 等待端口切换 (例如 COM6 切换为 COM7)
print("等待 Bootloader 端口重新枚举 (3秒)...")
for i in range(10):
    time.sleep(0.5)
    new_ports = find_esp_ports()
    if new_ports:
        print("检测到端口:", new_ports)
        for p in new_ports:
            # 尝试烧录
            if try_flash(p):
                print("🎉🎉🎉 远程纯软件控制线一键烧录成功！")
                sys.exit(0)

print("❌ 烧录未能完成，请检查端口状态。")
