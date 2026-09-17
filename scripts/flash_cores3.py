import subprocess
import sys
import time
import serial
import serial.tools.list_ports

def get_ports():
    ports = [p.device for p in serial.tools.list_ports.comports()]
    if not ports:
        try:
            import winreg
            key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DEVICEMAP\SERIALCOMM")
            for i in range(winreg.QueryInfoKey(key)[1]):
                val = winreg.EnumValue(key, i)[1]
                if val not in ports:
                    ports.append(val)
            winreg.CloseKey(key)
        except Exception:
            pass
    return ports

# 确保没有后台进程锁定串口
subprocess.run(["powershell", "-Command", "Get-Process -Name 'FlowDesk' -ErrorAction SilentlyContinue | Stop-Process -Force"], capture_output=True)
time.sleep(0.5)

print("Available ports:", get_ports())

target_port = None
ports = get_ports()
if "COM3" in ports:
    target_port = "COM3"
    print("Found ESP32-S3 in bootloader mode on COM3")
elif "COM4" in ports:
    print("CoreS3 is currently on COM4. Triggering 1200 baud bootloader reset...")
    try:
        s = serial.Serial('COM4', 1200)
        time.sleep(0.3)
        s.close()
    except Exception as e:
        print("Note:", e)

    print("Waiting for ESP32-S3 to enumerate as COM3 bootloader...")
    for i in range(30):
        time.sleep(0.5)
        p_now = get_ports()
        if "COM3" in p_now:
            target_port = "COM3"
            print(f"Device ready on COM3 (took {i*0.5:.1f}s)")
            break

if not target_port:
    # 检查当前是否已在 COM3
    ports = get_ports()
    if "COM3" in ports:
        target_port = "COM3"
    else:
        print(f"Current ports: {ports}. COM3 did not appear within 15s.")
        sys.exit(1)

print(f"Target port identified: {target_port}")
print("Waiting 3.0s for Windows driver enumeration to settle...")
time.sleep(3.0)

bootloader = r"d:\GhostDesk\firmware\m5stack_cores3\.pio\build\m5stack-cores3\bootloader.bin"
partitions = r"d:\GhostDesk\firmware\m5stack_cores3\.pio\build\m5stack-cores3\partitions.bin"
firmware = r"d:\GhostDesk\firmware\m5stack_cores3\.pio\build\m5stack-cores3\firmware.bin"

cmd = [
    "uvx", "--from", "esptool", "esptool",
    "--chip", "esp32s3",
    "--port", target_port,
    "--baud", "921600",
    "--before", "default-reset",
    "--after", "hard-reset",
    "--connect-attempts", "7",
    "write-flash", "-z",
    "--flash-mode", "dio",
    "--flash-freq", "80m",
    "--flash-size", "16MB",
    "0x0", bootloader,
    "0x8000", partitions,
    "0x10000", firmware
]
print("Running esptool flash...")
res = subprocess.run(cmd)
sys.exit(res.returncode)
