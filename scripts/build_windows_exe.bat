@echo off
echo ============================================================
echo [GhostDesk] 正在打包单文件免安装 Windows 版 GhostDesk.exe...
echo ============================================================

pyinstaller --onefile --name GhostDesk --clean --noconfirm scripts/walkie_talkie.py

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ============================================================
    echo [GhostDesk] 打包成功！可执行文件位于: dist\GhostDesk.exe
    echo ============================================================
) else (
    echo.
    echo [GhostDesk] 打包失败，请确保已安装 pyinstaller: pip install pyinstaller
)
pause
