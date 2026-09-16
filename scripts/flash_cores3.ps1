# Antigravity 一键烧录 M5Stack CoreS3 专属脚本
$ErrorActionPreference = "Stop"
$python = "C:\Users\dasea\AppData\Local\Programs\Python\Python311\python.exe"

Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host "⚡ Antigravity x M5Stack CoreS3 一键自动编译与烧录工具" -ForegroundColor Green
Write-Host "=========================================================" -ForegroundColor Cyan

# 1. 检查串口设备
Write-Host "🔍 正在扫描电脑上的 USB 串口设备..." -ForegroundColor Yellow
$ports = & $python -c "import serial.tools.list_ports; print('\n'.join([f'{p.device} | {p.description}' for p in serial.tools.list_ports.comports()]))"
Write-Host $ports

# 2. 进入固件工程目录并编译烧录
$firmwareDir = "E:\GhostDesk\firmware\m5stack_cores3"
Set-Location $firmwareDir

Write-Host "`n🚀 正在启动 PlatformIO 进行云端依赖拉取、本地编译与物理烧录..." -ForegroundColor Cyan
& $python -m platformio run --target upload

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n🎉🎉🎉 恭喜！M5Stack CoreS3 固件烧录大获成功！" -ForegroundColor Green
    Write-Host "设备已自动重启，你可以观察 CoreS3 彩屏上的赛博眼睛和功能按钮了！" -ForegroundColor Yellow
} else {
    Write-Host "`n❌ 烧录遇到问题，请检查 USB 数据线是否插紧或是否有其他串口助手占用了端口。" -ForegroundColor Red
}
