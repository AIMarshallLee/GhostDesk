import os
import sys
import shutil
import subprocess
from pathlib import Path

# 编码保护
if sys.platform == "win32" and hasattr(sys.stdout, "buffer"):
    import codecs
    sys.stdout = codecs.getwriter("utf-8")(sys.stdout.buffer, "replace")
    sys.stderr = codecs.getwriter("utf-8")(sys.stderr.buffer, "replace")

ROOT_DIR = Path(__file__).resolve().parent.parent
DIST_DIR = ROOT_DIR / "dist"
BUILD_DIR = ROOT_DIR / "build"
PORTABLE_DIR = DIST_DIR / "GhostDesk_Portable"

def build():
    print("=" * 60)
    print("[GhostDesk] 正在打包 Windows 独立桌面软件...")
    print("=" * 60)

    # 1. 确保输出目录干净
    if PORTABLE_DIR.exists():
        try:
            shutil.rmtree(PORTABLE_DIR)
        except Exception:
            pass

    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm",
        "--onedir",
        "--windowed", # 隐藏黑框，纯净原生桌面软件窗口
        "--name", "GhostDesk",
        "--add-data", f"{ROOT_DIR / 'skills'};skills",
        "--add-data", f"{ROOT_DIR / 'mcp_tools'};mcp_tools",
        "--collect-all", "skills",
        "--collect-all", "mcp_tools",
        "--collect-all", "edge_tts",
        "--collect-all", "pyJianYingDraft",
        "--collect-all", "openpyxl",
        "--collect-all", "DrissionPage",
        "--distpath", str(DIST_DIR / "GhostDesk_Portable"),
        str(ROOT_DIR / "desktop" / "mcp_gui_dashboard.py")
    ]

    print("\n[Package] 执行 PyInstaller 编译命令:")
    print(" ".join(cmd))
    
    result = subprocess.run(cmd, cwd=str(ROOT_DIR))
    if result.returncode != 0:
        print("\n[Error] 打包失败，请检查编译日志！")
        return False

    exe_path = DIST_DIR / "GhostDesk_Portable" / "GhostDesk" / "GhostDesk.exe"
    if not exe_path.exists():
        print(f"\n[Error] 未找到生成的可执行文件: {exe_path}")
        return False

    print("\n" + "=" * 60)
    print(f"[Success] 打包成功！Windows 桌面可执行文件已生成:")
    print(f"路径: {exe_path}")
    print("=" * 60)

    # 2. 为用户桌面创建一键启动的快捷方式
    try:
        user_profile = os.environ.get("USERPROFILE", "")
        desktop_dir = Path(user_profile) / "Desktop"
        if desktop_dir.exists():
            vbs_script = f"""
Set oWS = WScript.CreateObject("WScript.Shell")
sLinkFile = "{desktop_dir / 'GhostDesk 桌面助手.lnk'}"
Set oLink = oWS.CreateShortcut(sLinkFile)
oLink.TargetPath = "{exe_path}"
oLink.WorkingDirectory = "{exe_path.parent}"
oLink.Description = "GhostDesk AI 员工桌面客户端"
oLink.Save
"""
            vbs_path = ROOT_DIR / "scripts" / "create_app_shortcut.vbs"
            vbs_path.write_text(vbs_script, encoding="ascii")
            subprocess.run(["cscript", "//nologo", str(vbs_path)], check=True)
            print(f"[Desktop] 已在您的 Windows 桌面上生成快捷方式: GhostDesk 桌面助手.lnk")
    except Exception as e:
        print(f"[Warning] 生成桌面快捷方式提示: {e}")

    return True

if __name__ == "__main__":
    success = build()
    sys.exit(0 if success else 1)
