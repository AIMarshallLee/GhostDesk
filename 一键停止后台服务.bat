@echo off
chcp 65001 >nul
title GhostDesk - 停止后台服务

echo ========================================================
echo   GhostDesk 👻 M5Stack CoreS3 后台服务停止器
echo ========================================================
echo.
echo 正在检测并安全关闭后台对讲机服务 (walkie_talkie.py)...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$procs = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*walkie_talkie.py*' };" ^
  "if ($procs) {" ^
  "    $procs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force };" ^
  "    Write-Host '✅ 成功停止所有 GhostDesk 后台对讲机进程！' -ForegroundColor Green;" ^
  "} else {" ^
  "    Write-Host 'ℹ️ 当前没有正在运行的 GhostDesk 对讲机后台服务。' -ForegroundColor Yellow;" ^
  "}"

echo.
echo [提示] 如需重新启动，只需双击【一键后台静默启动.vbs】即可。
echo.
timeout /t 3 >nul
