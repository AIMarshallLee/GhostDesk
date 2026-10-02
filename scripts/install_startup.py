"""
GhostDesk CoreS3 Windows 开机自启与静默服务管理工具
自动生成 Windows Startup 快捷方式，使用 pythonw.exe 无黑框纯静默运行。
"""
import os
import sys
import subprocess

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

def install_startup():
    python_dir = os.path.dirname(sys.executable)
    pythonw_exe = os.path.join(python_dir, "pythonw.exe")
    if not os.path.exists(pythonw_exe):
        pythonw_exe = sys.executable  # fallback

    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    script_path = os.path.join(base_dir, "scripts", "walkie_talkie.py")

    startup_dir = os.path.expandvars(r"%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup")
    shortcut_path = os.path.join(startup_dir, "GhostDesk_CoreS3.lnk")

    # 使用 PowerShell COM 接口创建标准 Windows 快捷方式
    ps_cmd = f"""
    $WshShell = New-Object -ComObject WScript.Shell
    $Shortcut = $WshShell.CreateShortcut('{shortcut_path}')
    $Shortcut.TargetPath = '{pythonw_exe}'
    $Shortcut.Arguments = '"{script_path}"'
    $Shortcut.WorkingDirectory = '{base_dir}'
    $Shortcut.Description = 'GhostDesk CoreS3 对讲机与触控板静默后台服务'
    $Shortcut.Save()
    """

    res = subprocess.run(["powershell", "-NoProfile", "-Command", ps_cmd], capture_output=True, text=True)
    if res.returncode == 0 and os.path.exists(shortcut_path):
        print(f"✅ 开机静默自启快捷方式创建成功！")
        print(f"   路径: {shortcut_path}")
        print(f"   执行: {pythonw_exe} {script_path}")
        return True
    else:
        print(f"❌ 创建快捷方式失败: {res.stderr}")
        return False

def start_daemon_if_not_running():
    # 检查 walkie_talkie.py 是否已在运行
    try:
        res = subprocess.run(
            ["powershell", "-NoProfile", "-Command", "Get-WmiObject Win32_Process | Where-Object { $_.CommandLine -like '*walkie_talkie.py*' } | Select-Object -ExpandProperty ProcessId"],
            capture_output=True,
            text=True
        )
        pids = [line.strip() for line in res.stdout.strip().splitlines() if line.strip()]
        if pids:
            print(f"ℹ️ CoreS3 后台服务已在运行中 (PID: {', '.join(pids)})")
            return
    except Exception:
        pass

    # 使用 pythonw 静默拉起
    python_dir = os.path.dirname(sys.executable)
    pythonw_exe = os.path.join(python_dir, "pythonw.exe")
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    script_path = os.path.join(base_dir, "scripts", "walkie_talkie.py")

    subprocess.Popen([pythonw_exe, script_path], cwd=base_dir, close_fds=True)
    print("🚀 已立即在后台静默启动 CoreS3 服务 (无黑框弹窗)！")

if __name__ == "__main__":
    if install_startup():
        start_daemon_if_not_running()
