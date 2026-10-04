import os
import sys
import winreg
import subprocess

def main():
    python_dir = os.path.dirname(sys.executable)
    pythonw_exe = os.path.join(python_dir, "pythonw.exe")
    if not os.path.exists(pythonw_exe):
        pythonw_exe = sys.executable

    script_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "flowdesk_win_watchdog.py"))
    cmd_val = f'"{pythonw_exe}" "{script_path}"'

    # 1. 注册至 Windows 当前用户开机自启表 (永久生效，重启自动拉起，零权限弹窗)
    key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run", 0, winreg.KEY_SET_VALUE)
    winreg.SetValueEx(key, "FlowDesk-WinWatchdog", 0, winreg.REG_SZ, cmd_val)
    winreg.CloseKey(key)

    print(f"[OK] Successfully registered in HKCU Run: {cmd_val}")

    # 2. 检查当前是否已经在运行，若未运行则立即后台启动
    # 使用 pythonw.exe 后台静默启动，绝无黑框
    subprocess.Popen([pythonw_exe, script_path], creationflags=subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS)
    print("[OK] Background watchdog process started successfully (silent mode)!")

if __name__ == "__main__":
    main()
