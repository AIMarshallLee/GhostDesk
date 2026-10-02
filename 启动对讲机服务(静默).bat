@echo off
chcp 65001 >nul
echo 正在后台静默启动 GhostDesk CoreS3 对讲机服务...
start "" "%LOCALAPPDATA%\Programs\Python\Python312\pythonw.exe" "%~dp0scripts\walkie_talkie.py"
echo 启动完成！无需保留此窗口。
timeout /t 2 >nul
