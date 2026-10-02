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
    
    # 检查是否有 COM3 (Bootloader 模式)
    target_port = None
    if "COM3" in port_names:
        target_port = "COM3"

    if target_port:
        print(f"\n>>> [CoreS3 Flasher] 检测到设备端口 [{target_port}]，等待驱动就绪...", flush=True)
        time.sleep(1.0)
        print(f">>> [CoreS3 Flasher] 正在通过 {target_port} 执行高速极速烧录...", flush=True)
        cmd = [
            "uvx", "--from", "esptool", "esptool",
            "--chip", "esp32s3", "--port", target_port, "--baud", "921600",
            "--before", "default-reset", "--after", "hard-reset",
            "--connect-attempts", "7",
            "write-flash", "-z", "--flash-mode", "dio", "--flash-freq", "80m", "--flash-size", "16MB",
            "0x0", "bootloader.bin", "0x8000", "partitions.bin", "0x10000", "firmware.bin"
        ]
        res = subprocess.run(cmd, cwd=r"d:\GhostDesk\firmware\m5stack_cores3")
        if res.returncode == 0:
            print("\n>>> [CoreS3 Flasher] 🎉 烧录成功！CoreS3 固件已更新至 v0.8.0 苹果水波极简版！", flush=True)
            sys.exit(0)
        else:
            print(">>> [CoreS3 Flasher] 烧录遇阻，若卡住请按住 CoreS3 底部红色电源键 2 秒重试...", flush=True)
            time.sleep(2.0)
    else:
        time.sleep(0.5)
