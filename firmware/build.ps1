$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$tools = Join-Path $PSScriptRoot '.tools'
$cmake = Join-Path $tools 'python\cmake\data\bin\cmake.exe'
$ninjaDir = Join-Path $tools 'python\ninja\data\bin'
$armBin = Join-Path $tools 'arm-gnu-toolchain-13.3.rel1-mingw-w64-i686-arm-none-eabi\bin'
$sdk = Join-Path $tools 'pico-sdk'
$tinyusb = Join-Path $tools 'tinyusb-86ad6e56c1700e85f1c5678607a762cfe3aa2f47'
$picotool = Join-Path $tools 'picotool\picotool'
$required = @($cmake, (Join-Path $ninjaDir 'ninja.exe'), (Join-Path $armBin 'arm-none-eabi-gcc.exe'), (Join-Path $sdk 'external\pico_sdk_import.cmake'), (Join-Path $tinyusb 'src\tusb.h'), (Join-Path $picotool 'picotoolConfig.cmake'))
$missing = $required | Where-Object { -not (Test-Path -LiteralPath $_) }
if ($missing) { throw "缺少隔离构建依赖：$($missing -join '; ')。请按 firmware/README.md 安装到 firmware/.tools。" }

# Arm GNU Toolchain 13.3.Rel1 的 i686 链接器不能稳定处理 Unicode 源路径；临时联接只用于本次构建。
$junction = Join-Path $env:TEMP "flowdesk-pico-$PID"
$build = Join-Path $env:TEMP "flowdesk-pico-build-$PID"
$savedPath = $env:Path
try {
  New-Item -ItemType Junction -Path $junction -Target $repoRoot | Out-Null
  $firmware = Join-Path $junction 'firmware'
  $buildArmBin = Join-Path $firmware '.tools\arm-gnu-toolchain-13.3.rel1-mingw-w64-i686-arm-none-eabi\bin'
  $output = Join-Path $PSScriptRoot 'build'
  New-Item -ItemType Directory -Force -Path $output | Out-Null
  $env:Path = "$ninjaDir;$buildArmBin;$savedPath"
  & $cmake -S $firmware -B $build -G Ninja -DPICO_BOARD=pico "-DPICO_SDK_PATH=$firmware\.tools\pico-sdk" "-DPICO_TINYUSB_PATH=$firmware\.tools\tinyusb-86ad6e56c1700e85f1c5678607a762cfe3aa2f47" "-Dpicotool_DIR=$firmware\.tools\picotool\picotool"
  if ($LASTEXITCODE -ne 0) { throw "CMake 配置失败（退出码 $LASTEXITCODE）。" }
  & $cmake --build $build --target flowdesk_usb_bridge
  if ($LASTEXITCODE -ne 0) { throw "固件编译失败（退出码 $LASTEXITCODE）。" }
  $uf2 = Join-Path $build 'flowdesk_usb_bridge.uf2'
  if (-not (Test-Path -LiteralPath $uf2)) { throw '编译未产生 flowdesk_usb_bridge.uf2。' }
  Copy-Item -LiteralPath $uf2 -Destination (Join-Path $output 'flowdesk_usb_bridge.uf2') -Force
  Get-FileHash -LiteralPath (Join-Path $output 'flowdesk_usb_bridge.uf2') -Algorithm SHA256
}
finally {
  $env:Path = $savedPath
  if (Test-Path -LiteralPath $build) {
    $resolvedBuild = [IO.Path]::GetFullPath($build)
    $expectedBuild = Join-Path ([IO.Path]::GetFullPath($env:TEMP)) "flowdesk-pico-build-$PID"
    if ($resolvedBuild -ne $expectedBuild) { throw '拒绝清理预期临时目录以外的路径。' }
    Remove-Item -LiteralPath $resolvedBuild -Recurse -Force
  }
  if (Test-Path -LiteralPath $junction) {
    if ((Get-Item -LiteralPath $junction).LinkType -ne 'Junction') { throw '临时路径不是预期联接，保留不清理。' }
    [IO.Directory]::Delete($junction)
  }
}
