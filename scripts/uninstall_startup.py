"""
GhostDesk CoreS3 卸载开机自启快捷方式
"""
import os
import sys

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

def uninstall_startup():
    startup_dir = os.path.expandvars(r"%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup")
    shortcut_path = os.path.join(startup_dir, "GhostDesk_CoreS3.lnk")
    if os.path.exists(shortcut_path):
        os.remove(shortcut_path)
        print(f"🗑️ 已成功移除开机自启快捷方式: {shortcut_path}")
    else:
        print("ℹ️ 开机自启快捷方式不存在，无需移除。")

if __name__ == "__main__":
    uninstall_startup()
