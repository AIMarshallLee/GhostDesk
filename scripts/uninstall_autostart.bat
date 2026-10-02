@echo off
chcp 65001 >nul
echo ========================================================
echo   正在取消 FlowDesk / CoreS3 对讲机开机自启...
echo ========================================================

set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LNK_PATH=%STARTUP_FOLDER%\FlowDesk_CoreS3.lnk"

if exist "%LNK_PATH%" (
    del "%LNK_PATH%"
    echo.
    echo [OK] 已成功从开机启动项中移除！
) else (
    echo.
    echo 未发现开机自启快捷方式，无需清理。
)

echo.
pause
