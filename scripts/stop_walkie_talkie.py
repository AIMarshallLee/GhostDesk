"""
GhostDesk CoreS3 停止后台服务脚本
"""
import sys
import subprocess

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

def stop_daemon():
    ps_cmd = """
    $procs = Get-WmiObject Win32_Process | Where-Object { $_.CommandLine -like '*walkie_talkie.py*' }
    if ($procs) {
        foreach ($p in $procs) {
            Stop-Process -Id $p.ProcessId -Force
            Write-Host "🛑 已停止进程 PID: $($p.ProcessId)"
        }
    } else {
        Write-Host "ℹ️ 未发现正在运行的 walkie_talkie.py 进程。"
    }
    """
    res = subprocess.run(["powershell", "-NoProfile", "-Command", ps_cmd], capture_output=True, text=True)
    print(res.stdout.strip())

if __name__ == "__main__":
    stop_daemon()
