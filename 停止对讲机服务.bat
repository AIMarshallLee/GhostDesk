@echo off
chcp 65001 >nul
echo 正在停止 GhostDesk CoreS3 对讲机后台服务...
powershell -NoProfile -Command "Get-WmiObject Win32_Process | Where-Object { $_.CommandLine -like '*walkie_talkie.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host '已停止 PID: ' $_.ProcessId }"
echo 已经全部停止。
timeout /t 2 >nul
