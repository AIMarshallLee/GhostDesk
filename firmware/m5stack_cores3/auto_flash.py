import time
import subprocess
import re
import sys
import serial.tools.list_ports

print("==================================================", flush=True)
print(">>> CoreS3 v0.8.0 智能全自动烧录程序就绪", flush=True)
print(">>> 正在监听端口变动 (支持 COM3 下载模式 & COM4 自动重置)...", flush=True)
print("==================================================", flush=True)

if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')

def get_ports():
    ports = []
    for p in serial.tools.list_ports.comports():
        ports.append((p.device, p.description or ""))
    return ports

last_seen_ports = []

while True:
    ports = get_ports()
    port_names = [p[0] for p in ports]
    
    # 检查是否有可用 COM 端口 (COM3, COM4, COM5)
    target_port = None
    for p in ["COM3", "COM4", "COM5"]:
        if p in port_names:
            target_port = p
            break

    if target_port:
        print(f"\n>>> [CoreS3 Flasher] 捕获到端口 [{target_port}]，立即握手烧录...", flush=True)
        time.sleep(0.1)
        cmd = [
            sys.executable, r"C:\Users\dasea\.platformio\packages\tool-esptoolpy\esptool.py",
            "--chip", "esp32s3", "--port", target_port, "--baud", "921600",
            "--before", "default_reset", "--after", "hard_reset",
            "--connect-attempts", "5",
            "write_flash", "-z", "--flash_mode", "dio", "--flash_freq", "80m", "--flash_size", "16MB",
            "0x0", "bootloader.bin", "0x8000", "partitions.bin", "0x10000", "firmware.bin"
        ]
        res = subprocess.run(cmd, cwd=r"d:\GhostDesk\firmware\m5stack_cores3")
        if res.returncode == 0:
            print("\n>>> [CoreS3 Flasher] 🎉 烧录成功！CoreS3 固件已更新至 4 通道增强版！", flush=True)
            sys.exit(0)
        else:
            print(">>> [CoreS3 Flasher] 提示: 请长按 CoreS3 底部按键 2 秒使其稳定在下载模式...", flush=True)
            time.sleep(0.5)
    else:
        time.sleep(0.5)
