@echo off
chcp 65001 >nul
echo ========================================================
echo   正在为 FlowDesk / CoreS3 对讲机设置开机静默启动...
echo ========================================================

set "SCRIPT_DIR=%~dp0"
set "VBS_PATH=%SCRIPT_DIR%start_silent.vbs"
set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LNK_PATH=%STARTUP_FOLDER%\FlowDesk_CoreS3.lnk"

powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%LNK_PATH%'); $s.TargetPath = 'wscript.exe'; $s.Arguments = '\"%VBS_PATH%\"'; $s.WorkingDirectory = '%SCRIPT_DIR%..'; $s.Description = 'FlowDesk CoreS3 对讲机静默后台通信服务'; $s.Save()"

if exist "%LNK_PATH%" (
    echo.
    echo [OK] 开机自启设置成功！
    echo 快捷方式已写入: %LNK_PATH%
    echo 以后每次开机，电脑将自动在后台静默连接 CoreS3 对讲机，无需手动开黑窗口！
) else (
    echo.
    echo [ERR] 设置快捷方式失败，请以管理员身份运行本脚本。
)

echo.
pause
