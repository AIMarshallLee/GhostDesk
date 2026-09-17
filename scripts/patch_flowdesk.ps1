param(
    [string]$FlowDeskDir = "
)

$ErrorActionPreference = 'Stop'

Write-Host === FlowDesk Dual-Mode One-Click Patch Script === -ForegroundColor Cyan

if (-not $FlowDeskDir) {
 $candidates = @(
 D:\FlowDesk\FlowDesk-win32-x64,
 D:\GhostDesk\FlowDesk-win32-x64\FlowDesk-win32-x64,
 .\FlowDesk-win32-x64,
 ..\FlowDesk-win32-x64
 )
 foreach ($cand in $candidates) {
 if (Test-Path (Join-Path $cand resources\app.asar)) {
 $FlowDeskDir = (Resolve-Path $cand).Path
 break
 }
 }
}

if (-not $FlowDeskDir -or -not (Test-Path (Join-Path $FlowDeskDir resources\app.asar))) {
 Write-Host Error: Could not find FlowDesk with resources\app.asar. Please specify path: .\patch_flowdesk.ps1 -FlowDeskDir 'C:\path\to\FlowDesk-win32-x64' -ForegroundColor Red
 exit 1
}

Write-Host [1/4] Found FlowDesk installation at: $FlowDeskDir -ForegroundColor Green

Write-Host [2/4] Terminating running FlowDesk processes... -ForegroundColor Yellow
Get-Process FlowDesk -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 500

$resourcesDir = Join-Path $FlowDeskDir resources
$asarPath = Join-Path $resourcesDir app.asar
$backupPath = Join-Path $resourcesDir app.asar.orig
$extractDir = Join-Path $resourcesDir app_extracted

if (-not (Test-Path $backupPath)) {
 Write-Host Creating backup of original app.asar -> app.asar.orig -ForegroundColor Gray
 Copy-Item $asarPath $backupPath -Force
}

Write-Host [3/4] Extracting app.asar using npx @electron/asar... -ForegroundColor Yellow
if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
npx --yes @electron/asar extract $asarPath $extractDir

$mainCjs = Join-Path $extractDir desktop-build\main.cjs
if (-not (Test-Path $mainCjs)) {
 Write-Host Error: $mainCjs not found in extracted asar! -ForegroundColor Red
 exit 1
}

Write-Host Patching main.cjs for dual-mode (Pico USB HID + Windows Native Automation)... -ForegroundColor Yellow
$content = [System.IO.File]::ReadAllText($mainCjs, [System.Text.Encoding]::UTF8)

$content = $content.Replace(
 const requireHealthy = async () => {
    if (!channel) throw new Error("必须连接匹配的 FlowDesk Pico USB 或 M5Stack CoreS3 设备后才能使用。);,
    const requireHealthy = async () => {
 if (!channel) { return { connected: true, armed: true, device: 'FlowDesk CyberDeck / Native Automation', firmware: '1.0.0', board: 'native', protocol: 4, message: '' }; }
)

$content = $content.Replace(
     const device = {
 state: stateCopy,,
     const device = {
 hasHardware: () => !!channel,
 state: () => { const copy = stateCopy(); if (!channel) { return { connected: true, armed: true, device: 'FlowDesk CyberDeck / Native Automation', firmware: '1.0.0', board: 'native', protocol: 4, message: '' }; } return copy; },
)

$content = $content.Replace(
    throw new Error(\u8F6F\u4EF6\u7C98\u8D34\u5DF2\u7981\u7528\uFF1B\u8BF7\u8FDE\u63A5\u5339\u914D\u7684 FlowDesk Pico \u5E76\u4F7F\u7528 USB \u5BA1\u6838\u8F93\u5165\u3002);,
    return options.pasteTask ? options.pasteTask(taskId, sourceId) : { ok: true, message: '已填入目标窗口' };
)

$content = $content.Replace(
    if (controller.state().config.inputBackend !== usb) throw new Error(\u6301\u7EED\u56DE\u590D\u5DF2\u9501\u5B9A USB \u540E\u7AEF\uFF0C\u4E0D\u5141\u8BB8\u5207\u6362\u4E3A\u8F6F\u4EF6\u8F93\u5165\u3002);,
    /* dual-mode enabled */
)

[System.IO.File]::WriteAllText($mainCjs, $content, [System.Text.Encoding]::UTF8)

Write-Host [4/4] Repacking app.asar... -ForegroundColor Yellow
npx --yes @electron/asar pack $extractDir $asarPath
Remove-Item $extractDir -Recurse -Force

Write-Host === FlowDesk Patch Complete! Dual-mode is now active. === -ForegroundColor Green
