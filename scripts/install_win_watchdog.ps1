# FlowDesk Windows BLE 守护进程 - 安装与自启配置脚本
param(
    [switch]$Uninstall
)

$TaskName = "FlowDesk-WinWatchdog"
$ScriptPath = "D:\GhostDesk\scripts\flowdesk_win_watchdog.py"

# 检测 pythonw (无黑框后台运行) 或 python
$PythonDir = Split-Path (Get-Command python -ErrorAction SilentlyContinue).Source
$PythonwExe = Join-Path $PythonDir "pythonw.exe"
if (-not (Test-Path $PythonwExe)) {
    $PythonwExe = (Get-Command python -ErrorAction SilentlyContinue).Source
}

if ($Uninstall) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "[已卸载] $TaskName 计划任务已删除" -ForegroundColor Yellow
    exit 0
}

# 注册计划任务：登录自动后台无窗启动，崩溃无限自动重试
$Action = New-ScheduledTaskAction -Execute $PythonwExe -Argument "`"$ScriptPath`"" -WorkingDirectory "D:\GhostDesk"
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 0) -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -MultipleInstances IgnoreNew
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Description "FlowDesk Windows BLE 自动重连守护进程" -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName

Write-Host ""
Write-Host "✅ FlowDesk Windows 守护进程已成功注册为开机自启后台任务！" -ForegroundColor Green
Write-Host "   任务名称: $TaskName" -ForegroundColor Cyan
Write-Host "   执行程序: $PythonwExe (静默无黑框)" -ForegroundColor Cyan
Write-Host "   运行脚本: $ScriptPath" -ForegroundColor Cyan
Write-Host "   日志文件: $env:APPDATA\FlowDesk\logs\win_watchdog.log" -ForegroundColor Cyan
Write-Host ""
