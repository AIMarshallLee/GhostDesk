import time
import subprocess
import sys

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import serial.tools.list_ports

def get_com_ports():
    return [p.device for p in serial.tools.list_ports.comports()]

print("=" * 60)
print("🚀 GhostDesk M5Stack CoreS3 自动极速烧录程序")
print("=" * 60)

cur_ports = get_com_ports()
print(f"当前在线端口: {cur_ports}")

target_port = "COM4" if "COM4" in cur_ports else ("COM3" if "COM3" in cur_ports else (cur_ports[0] if cur_ports else "COM4"))

def flash_port(port):
    print(f"\n⚡ 正在向 {port} 写入最新 BLE + 叭哥长按固件 (波特率 921600)...")
    cmd = [
        "uvx", "--from", "esptool", "esptool",
        "--chip", "esp32s3", "--port", port, "--baud", "921600",
        "--before", "default-reset", "--after", "hard-reset",
        "--connect-attempts", "5",
        "write-flash", "-z", "--flash-mode", "dio", "--flash-freq", "80m", "--flash-size", "16MB",
        "0x0", "bootloader.bin", "0x8000", "partitions.bin", "0x10000", "firmware.bin"
    ]
    res = subprocess.run(cmd, cwd=r"d:\GhostDesk\firmware\m5stack_cores3")
    return res.returncode == 0

# 如果已经在 COM3 (下载模式)
if "COM3" in cur_ports:
    if flash_port("COM3"):
        print("\n🎉 烧录成功！设备已自动重启！")
        sys.exit(0)

# 如果在 COM4，尝试通过 platformio 触发重启并烧录
print(f"正在尝试连接 {target_port} 触发 Bootloader 烧录...")
p = subprocess.Popen(
    ["uvx", "platformio", "run", "--target", "upload", f"--upload-port={target_port}"],
    cwd=r"d:\GhostDesk\firmware\m5stack_cores3",
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True
)

# 监听端口是否变为 COM3
start_time = time.time()
flashed = False
while time.time() - start_time < 20:
    ports = get_com_ports()
    if "COM3" in ports:
        print("\n🎯 检测到设备进入 ROM Bootloader 下载模式 (COM3)！")
        p.kill()
        time.sleep(1.2)
        if flash_port("COM3"):
            print("\n🎉 烧录成功！设备已自动重启！")
            flashed = True
            break
    time.sleep(0.3)

if not flashed:
    out, _ = p.communicate()
    if "SUCCESS" in out:
        print("\n🎉 烧录成功！")
    else:
        print("\n⚠️ 输出日志:\n", out)
        # 最后尝试一次 COM3
        ports = get_com_ports()
        if "COM3" in ports:
            flash_port("COM3")
