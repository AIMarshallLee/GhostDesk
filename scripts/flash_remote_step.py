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

def get_ports():
    return {p.device: p.description for p in serial.tools.list_ports.comports()}

print("1. 当前端口列表:", get_ports())

# 触发 COM6 进入 Bootloader
print("2. 正在通过 USB 向设备发送硬件 Bootloader 切换信号...")
try:
    with serial.Serial('COM6', 1200, timeout=0.5) as s:
        s.dtr = False
        s.rts = True
        time.sleep(0.15)
        s.dtr = True
        s.rts = False
        time.sleep(0.15)
except Exception as e:
    print("触发信号已送达 (设备断开并重枚举):", e)

# 轮询等待新的 Bootloader 端口 (通常为 COM7)
print("3. 等待 Bootloader 端口上线...")
bootloader_port = None
for i in range(15):
    time.sleep(0.4)
    current = get_ports()
    for dev, desc in current.items():
        if dev != 'COM6' and ('USB' in desc or '串行' in desc or 'JTAG' in desc):
            bootloader_port = dev
            break
    if bootloader_port:
        break
    # 如果依然在 COM6 (部分系统仍保持原端口名)
    if 'COM6' in current and i > 4:
        bootloader_port = 'COM6'
        break

if not bootloader_port:
    # 默认尝试 COM7
    bootloader_port = 'COM7'

print(f"4. 锁定目标 Bootloader 端口: [{bootloader_port}]")

# 调用 esptool 进行烧录并实时输出
print(f"5. 开始向 {bootloader_port} 写入固件...")
cmd = [
    python_exe, "-m", "esptool",
    "--chip", "esp32s3",
    "--port", bootloader_port,
    "--baud", "921600",
    "--before", "no-reset",
    "--after", "hard-reset",
    "write-flash", "-z",
    "--flash-mode", "dio",
    "--flash-freq", "80m",
    "--flash-size", "16MB",
    "0x0000", bootloader,
    "0x8000", partitions,
    "0x10000", firmware
]

process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
for line in iter(process.stdout.readline, ''):
    print(line, end='', flush=True)

process.stdout.close()
return_code = process.wait()

if return_code == 0:
    print("\n🎉🎉🎉 远程纯数据线免按键烧录大获成功！设备已自动重启！")
else:
    print(f"\n❌ 烧录退出，退出码: {return_code}")
    sys.exit(return_code)
