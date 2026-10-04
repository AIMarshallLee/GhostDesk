# FlowDesk Windows - 1-Command Setup & Auto-Start Script
# Usage: powershell -ExecutionPolicy Bypass -File scripts\setup_win.ps1

param(
    [switch]$Uninstall
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$MicScript = Join-Path $ScriptDir "flowdesk_wireless_mic.py"
$SwarmScript = Join-Path $ScriptDir "swarm_node.py"
$ReqFile = Join-Path $ScriptDir "requirements-mic.txt"

# 1. Detect Python and pythonw (silent background runner)
$PythonExe = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $PythonExe) {
    $PythonExe = (Get-Command python3 -ErrorAction SilentlyContinue).Source
}
if (-not $PythonExe) {
    Write-Host "[Error] Python not found. Please install Python 3.9+ and add to PATH." -ForegroundColor Red
    exit 1
}

$PythonDir = Split-Path $PythonExe
$PythonwExe = Join-Path $PythonDir "pythonw.exe"
if (-not (Test-Path $PythonwExe)) {
    $PythonwExe = $PythonExe
}

# 2. Uninstall logic
if ($Uninstall) {
    Write-Host ">>> Stopping and uninstalling FlowDesk Windows background services..." -ForegroundColor Yellow
    Get-Process -Name pythonw -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*$PythonDir*" } | Stop-Process -Force -ErrorAction SilentlyContinue
    $RegPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
    Remove-ItemProperty -Path $RegPath -Name "FlowDesk-MicBridge" -ErrorAction SilentlyContinue
    Remove-ItemProperty -Path $RegPath -Name "FlowDesk-SwarmWorker" -ErrorAction SilentlyContinue
    Remove-ItemProperty -Path $RegPath -Name "FlowDesk-WinWatchdog" -ErrorAction SilentlyContinue
    Write-Host "[OK] FlowDesk Windows services uninstalled successfully!" -ForegroundColor Green
    exit 0
}

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ">>> FlowDesk Windows 1-Click Automated Setup" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# 3. Install Python dependencies
Write-Host "1/3 Checking Python dependencies (sounddevice, bleak, paho-mqtt, pillow, etc.)..." -ForegroundColor Yellow
& $PythonExe -m pip install --quiet --disable-pip-version-check -r $ReqFile
Write-Host "[OK] Python dependencies ready!" -ForegroundColor Green

# 4. Check Virtual Audio Driver (VB-Cable / CABLE Input)
Write-Host "2/3 Checking Virtual Audio Device (VB-Cable)..." -ForegroundColor Yellow
$CheckAudioPy = "import sounddevice as sd; devs=[d['name'].lower() for d in sd.query_devices() if d['max_output_channels']>0]; print('FOUND' if any('cable' in n or 'vb-audio' in n for n in devs) else 'NOT_FOUND')"
$AudioStatus = & $PythonExe -c $CheckAudioPy
if ($AudioStatus -like "*FOUND*") {
    Write-Host "[OK] VB-Cable virtual audio channel detected!" -ForegroundColor Green
} else {
    Write-Host "[Notice] VB-Cable driver not found. Download free driver from: https://vb-audio.com/Cable/" -ForegroundColor DarkYellow
}

# 5. Register Startup autostart in HKCU Run
Write-Host "3/3 Registering Windows Startup background services..." -ForegroundColor Yellow
$RegPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"

$CmdMic = "`"$PythonwExe`" `"$MicScript`""
Set-ItemProperty -Path $RegPath -Name "FlowDesk-MicBridge" -Value $CmdMic

$CmdSwarm = "`"$PythonwExe`" `"$SwarmScript`""
Set-ItemProperty -Path $RegPath -Name "FlowDesk-SwarmWorker" -Value $CmdSwarm

# 6. Stop old background instances and launch new background instances silently
Get-Process -Name pythonw -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*$PythonDir*" } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Process -FilePath $PythonwExe -ArgumentList "`"$MicScript`"" -WorkingDirectory $ProjectRoot -WindowStyle Hidden
Start-Process -FilePath $PythonwExe -ArgumentList "`"$SwarmScript`"" -WorkingDirectory $ProjectRoot -WindowStyle Hidden

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "FlowDesk Windows Services Setup Complete!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  * Wireless Mic Bridge : Running in background (Auto-connect to CoreS3)" -ForegroundColor Cyan
Write-Host "  * Swarm Worker Node   : Running in background (Connected to Cloud Bus)" -ForegroundColor Cyan
Write-Host "  * Auto-Start          : Enabled on Windows Login (HKCU Run)" -ForegroundColor Cyan
Write-Host "  * Binary              : $PythonwExe" -ForegroundColor Gray
Write-Host "  * Uninstall           : powershell -ExecutionPolicy Bypass -File scripts\setup_win.ps1 -Uninstall" -ForegroundColor Gray
Write-Host "============================================================" -ForegroundColor Green
