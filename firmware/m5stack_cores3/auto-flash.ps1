Write-Host ">>> 自动监听并烧录 M5Stack CoreS3 固件 v0.8.0..." -ForegroundColor Cyan
$root = "d:\GhostDesk\firmware\m5stack_cores3"
Set-Location $root

$maxTries = 60
for ($i = 0; $i -lt $maxTries; $i++) {
    $dev = Get-CimInstance Win32_PnPEntity | Where-Object { $_.DeviceID -match "303A" -and ($_.Caption -match "COM\d+" -or $_.Name -match "COM\d+") } | Select-Object -First 1
    if ($dev) {
        $caption = $dev.Caption
        if ($caption -match "(COM\d+)") {
            $com = $matches[1]
            Write-Host ">>> 检测到 CoreS3 端口: $com，正在触发高速写入..." -ForegroundColor Yellow
            uvx esptool --chip esp32s3 --port $com --baud 921600 write-flash 0x0 bootloader.bin 0x8000 partitions.bin 0x10000 firmware.bin
            if ($LASTEXITCODE -eq 0) {
                Write-Host ">>> 🎉 烧录圆满成功！" -ForegroundColor Green
                exit 0
            }
        }
    }
    Start-Sleep -Milliseconds 800
}
Write-Host ">>> 超时退出"
