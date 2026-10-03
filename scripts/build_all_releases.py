import os
import shutil
import zipfile
import sys
from pathlib import Path

if sys.platform == "win32":
    import codecs
    sys.stdout = codecs.getwriter("utf-8")(sys.stdout.buffer, "replace")
    sys.stderr = codecs.getwriter("utf-8")(sys.stderr.buffer, "replace")

ROOT_DIR = Path(__file__).resolve().parent.parent
DIST_DIR = ROOT_DIR / "dist"
PACK_TEMP = DIST_DIR / "release_packages"
OUT_DIR = DIST_DIR / "releases"

def ensure_dirs():
    if PACK_TEMP.exists():
        shutil.rmtree(PACK_TEMP, ignore_errors=True)
    PACK_TEMP.mkdir(parents=True, exist_ok=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

def zip_directory(folder_path: Path, output_zip: Path):
    with zipfile.ZipFile(output_zip, "w", zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(folder_path):
            for file in files:
                full_path = Path(root) / file
                rel_path = full_path.relative_to(folder_path)
                zipf.write(full_path, rel_path)
    print(f"[Done] Release Asset -> {output_zip} ({output_zip.stat().st_size / 1024 / 1024:.2f} MB)", flush=True)

def build_windows():
    print("\n========================================================")
    print(">>> 正在打包 Windows 免安装绿色客户端...")
    print("========================================================")
    win_dir = PACK_TEMP / "GhostDesk-Windows-x64"
    win_dir.mkdir(parents=True, exist_ok=True)

    exe_path = DIST_DIR / "GhostDesk.exe"
    if not exe_path.exists():
        print("⚠️ 未找到 dist/GhostDesk.exe，请先通过 PyInstaller 打包生成。")
        return None

    shutil.copy2(exe_path, win_dir / "GhostDesk.exe")
    shutil.copy2(ROOT_DIR / "volc_config.example.json", win_dir / "volc_config.example.json")
    
    # 拷贝附属脚本
    win_assets = ROOT_DIR / "package_assets" / "windows"
    if win_assets.exists():
        for item in win_assets.iterdir():
            shutil.copy2(item, win_dir / item.name)

    zip_out = OUT_DIR / "GhostDesk-Windows-x64.zip"
    zip_directory(win_dir, zip_out)
    return zip_out

def build_macos():
    print("\n========================================================")
    print(">>> 正在打包 macOS 通用客户端...")
    print("========================================================")
    mac_dir = PACK_TEMP / "GhostDesk-macOS-Universal"
    mac_dir.mkdir(parents=True, exist_ok=True)

    # 拷贝 scripts 目录 (排除 pycache, wav, run.log)
    scripts_dest = mac_dir / "scripts"
    scripts_dest.mkdir(parents=True, exist_ok=True)
    
    scripts_src = ROOT_DIR / "scripts"
    for item in scripts_src.rglob("*"):
        if "__pycache__" in item.parts or item.suffix in [".pyc", ".wav", ".log"]:
            continue
        rel = item.relative_to(scripts_src)
        dest = scripts_dest / rel
        if item.is_dir():
            dest.mkdir(parents=True, exist_ok=True)
        else:
            shutil.copy2(item, dest)

    shutil.copy2(ROOT_DIR / "volc_config.example.json", mac_dir / "volc_config.example.json")
    if (ROOT_DIR / "requirements.txt").exists():
        shutil.copy2(ROOT_DIR / "requirements.txt", mac_dir / "requirements.txt")

    mac_assets = ROOT_DIR / "package_assets" / "macos"
    if mac_assets.exists():
        for item in mac_assets.iterdir():
            shutil.copy2(item, mac_dir / item.name)

    zip_out = OUT_DIR / "GhostDesk-macOS-Universal.zip"
    zip_directory(mac_dir, zip_out)
    return zip_out

def build_firmware():
    print("\n========================================================")
    print(">>> 正在打包 M5Stack CoreS3 固件一键刷机包...")
    print("========================================================")
    fw_dir = PACK_TEMP / "M5Stack-CoreS3-Firmware"
    fw_dir.mkdir(parents=True, exist_ok=True)

    fw_src = ROOT_DIR / "firmware" / "m5stack_cores3"
    for bin_name in ["bootloader.bin", "partitions.bin", "firmware.bin"]:
        bin_file = fw_src / bin_name
        if bin_file.exists():
            shutil.copy2(bin_file, fw_dir / bin_name)
        else:
            print(f"⚠️ 缺少固件文件: {bin_file}")

    fw_assets = ROOT_DIR / "package_assets" / "firmware"
    if fw_assets.exists():
        for item in fw_assets.iterdir():
            shutil.copy2(item, fw_dir / item.name)

    zip_out = OUT_DIR / "M5Stack-CoreS3-Firmware.zip"
    zip_directory(fw_dir, zip_out)
    return zip_out

def main():
    ensure_dirs()
    build_windows()
    build_macos()
    build_firmware()
    print("\n[SUCCESS] All release packages built successfully in dist/releases!", flush=True)

if __name__ == "__main__":
    main()
