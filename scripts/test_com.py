import ctypes
import time

GENERIC_READ = 0x80000000
GENERIC_WRITE = 0x40000000
OPEN_EXISTING = 3

h = ctypes.windll.kernel32.CreateFileW(
    r"\\.\COM4",
    GENERIC_READ | GENERIC_WRITE,
    0,
    None,
    OPEN_EXISTING,
    0,
    None
)
print("CreateFile result handle:", h)
if h == -1 or h == 0xFFFFFFFF:
    err = ctypes.GetLastError()
    print("WinError:", err)
else:
    print("Successfully opened COM4 handle directly!")
    ctypes.windll.kernel32.CloseHandle(h)
