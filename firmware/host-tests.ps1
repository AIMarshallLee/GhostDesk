$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$zig = Join-Path $PSScriptRoot '.tools\zig\zig.exe'
$lib = Join-Path $PSScriptRoot '.tools\zig\lib'
if (!(Test-Path -LiteralPath $zig) -or !(Test-Path -LiteralPath (Join-Path $lib 'std\std.zig'))) { throw '缺少 firmware/.tools/zig 的完整 Zig 0.14.1。' }
$junction = Join-Path $env:TEMP "flowdesk-host-tests-$PID"
$savedZigLib = $env:ZIG_LIB_DIR
New-Item -ItemType Junction -Path $junction -Target $root | Out-Null
try {
  $env:ZIG_LIB_DIR = $lib
  $base = Join-Path $junction 'firmware'
  & (Join-Path $base '.tools\zig\zig.exe') cc -std=c11 -I(Join-Path $base 'include') (Join-Path $base 'tests\protocol_tests.c') (Join-Path $base 'src\protocol.c') -o (Join-Path $base 'build\protocol_tests.exe')
  if ($LASTEXITCODE -ne 0) { throw "protocol_tests 编译失败（$LASTEXITCODE）。" }
  & (Join-Path $base 'build\protocol_tests.exe')
  if ($LASTEXITCODE -ne 0) { throw "protocol_tests 失败（$LASTEXITCODE）。" }
  & (Join-Path $base '.tools\zig\zig.exe') cc -std=c11 -I(Join-Path $base 'include') (Join-Path $base 'tests\state_tests.c') (Join-Path $base 'src\bridge_state.c') -o (Join-Path $base 'build\state_tests.exe')
  if ($LASTEXITCODE -ne 0) { throw "state_tests 编译失败（$LASTEXITCODE）。" }
  & (Join-Path $base 'build\state_tests.exe')
  if ($LASTEXITCODE -ne 0) { throw "state_tests 失败（$LASTEXITCODE）。" }
  & (Join-Path $base '.tools\zig\zig.exe') cc -std=c11 -I(Join-Path $base 'tests\fake') -I(Join-Path $base 'include') (Join-Path $base 'tests\main_harness.c') (Join-Path $base 'src\protocol.c') (Join-Path $base 'src\bridge_state.c') -o (Join-Path $base 'build\main_harness.exe')
  if ($LASTEXITCODE -ne 0) { throw "main_harness 编译失败（$LASTEXITCODE）。" }
  & (Join-Path $base 'build\main_harness.exe')
  if ($LASTEXITCODE -ne 0) { throw "main_harness 失败（$LASTEXITCODE）。" }
  'host tests passed'
} finally {
  $env:ZIG_LIB_DIR = $savedZigLib
  if (Test-Path -LiteralPath $junction) {
    if ((Get-Item -LiteralPath $junction).LinkType -ne 'Junction') { throw '临时路径不是预期联接，保留不清理。' }
    [IO.Directory]::Delete($junction)
  }
}
