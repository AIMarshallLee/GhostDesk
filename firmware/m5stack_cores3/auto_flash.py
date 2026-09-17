import time
import subprocess
import re
import sys

print("==================================================", flush=True)
print(">>> CoreS3 v0.8.0 智能零闪烁固件自动烧录程序就绪", flush=True)
print(">>> 正在监听端口变动...", flush=True)
print("==================================================", flush=True)

if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')

def check_ports():
    try:
        out = subprocess.check_output(
            ["powershell", "-NoProfile", "-Command", "[System.IO.Ports.SerialPort]::GetPortNames()"],
            text=True
        )
        return [p.strip() for p in out.strip().split() if p.strip()]
    except Exception:
        return []

initial_ports = check_ports()
print(f"[CoreS3 Flasher] Initial detected ports: {initial_ports}", flush=True)
print("[CoreS3 Flasher] Listening for COM3 Download Bootloader mode...", flush=True)

while True:
    ports = check_ports()
    # If COM3 appears (native bootloader mode), flash immediately!
    if "COM3" in ports:
        print("\n>>> [CoreS3 Flasher] Captured Download port COM3! Waiting 2.0s for driver to settle...", flush=True)
        time.sleep(2.0)
        print(">>> [CoreS3 Flasher] Starting high-speed flash writing...", flush=True)
        cmd = [
            "uvx", "--from", "esptool", "esptool",
            "--chip", "esp32s3", "--port", "COM3", "--baud", "921600",
            "--before", "default-reset", "--after", "hard-reset",
            "--connect-attempts", "7",
            "write-flash", "-z", "--flash-mode", "dio", "--flash-freq", "80m", "--flash-size", "16MB",
            "0x0", "bootloader.bin", "0x8000", "partitions.bin", "0x10000", "firmware.bin"
        ]
        res = subprocess.run(cmd, cwd=r"d:\GhostDesk\firmware\m5stack_cores3")
        if res.returncode == 0:
            print("\n>>> [CoreS3 Flasher] SUCCESS! Firmware v0.8.0 flashed successfully! Device rebooted.", flush=True)
            sys.exit(0)
        else:
            print(">>> [CoreS3 Flasher] Temporary flash failure, retrying...", flush=True)
            time.sleep(1.0)
    time.sleep(0.3)
