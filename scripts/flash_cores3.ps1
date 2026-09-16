# GhostDesk 一键烧录 M5Stack CoreS3 专属脚本
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$firmwareDir = Resolve-Path (Join-Path $scriptDir "..\firmware\m5stack_cores3")

# 查找可用 Python 解释器
$pythonCandidates = @(
    "python.exe",
    "python3.exe",
    "py.exe",
    "C:\Users\dasea\AppData\Local\Programs\Python\Python311\python.exe"
)
$python = $null
foreach ($cand in $pythonCandidates) {
    if (Get-Command $cand -ErrorAction SilentlyContinue) {
        $python = $cand
        break
    }
}

Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host "⚡ GhostDesk x M5Stack CoreS3 一键自动编译与烧录工具" -ForegroundColor Green
Write-Host "=========================================================" -ForegroundColor Cyan

# 1. 检查串口设备
Write-Host "🔍 正在扫描电脑上的 USB 串口设备..." -ForegroundColor Yellow
if ($python) {
    try {
        $ports = & $python -c "import serial.tools.list_ports; print('\n'.join([f'{p.device} | {p.description}' for p in serial.tools.list_ports.comports()]))" 2>$null
        if ($ports) { Write-Host $ports }
    } catch {
        # Optional scan
    }
}

# 2. 进入固件工程目录并编译烧录
Set-Location $firmwareDir

Write-Host "`n🚀 正在启动 PlatformIO 进行本地编译与物理烧录..." -ForegroundColor Cyan

$pioCmd = Get-Command "pio" -ErrorAction SilentlyContinue
if ($pioCmd) {
    & pio run --target upload
} elseif ($python) {
    & $python -m platformio run --target upload
} else {
    Write-Host "❌ 未找到 pio 或 Python platformio 模块，请使用 VS Code + PlatformIO 插件打开本目录直接烧录。" -ForegroundColor Red
    exit 1
}

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n🎉🎉🎉 恭喜！M5Stack CoreS3 固件烧录大获成功！" -ForegroundColor Green
    Write-Host "设备已自动重启，你可以观察 CoreS3 彩屏上的赛博眼睛和功能按钮了！" -ForegroundColor Yellow
} else {
    Write-Host "`n❌ 烧录遇到问题，请检查 USB 数据线是否插紧或是否有其他串口助手占用了端口。" -ForegroundColor Red
}

