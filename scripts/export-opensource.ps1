# GhostDesk Open-Source Clean Export & Sync Script
param (
    [string]$TargetDir = "E:\GhostDesk"
)

$ErrorActionPreference = "Stop"
$SourceDir = (Resolve-Path "$PSScriptRoot\..").Path

Write-Host "=== GhostDesk 开源脱敏与同步工具 ===" -ForegroundColor Cyan
Write-Host "源目录 (本地开发): $SourceDir"
Write-Host "目标目录 (开源仓库): $TargetDir"

if (!(Test-Path $TargetDir)) {
    New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
    Write-Host "已创建目标开源目录: $TargetDir" -ForegroundColor Green
}

# 排除目录和文件定义
$ExcludeDirs = @(
    ".git",
    "node_modules",
    "dist",
    "desktop-build",
    "release",
    ".flowdesk",
    ".flowdesk-data",
    "artifacts",
    "build",
    ".tools"
)

$ExcludeFiles = @(
    "*.log",
    "*.tmp",
    ".env",
    "build.err",
    "build-v2.err"
)

# 使用 robocopy 进行高效且纯净的文件同步
$RoboArgs = @(
    $SourceDir,
    $TargetDir,
    "/MIR",
    "/XD",
    $ExcludeDirs,
    "/XF",
    $ExcludeFiles,
    "/NJH",
    "/NJS",
    "/NDL",
    "/NC",
    "/NS",
    "/NP"
)

Write-Host "正在同步代码与资源至开源目录..." -ForegroundColor Yellow
$roboResult = & robocopy @RoboArgs
# Robocopy exit code < 8 means successful copy
if ($LASTEXITCODE -ge 8) {
    Write-Error "Robocopy 同步失败，错误码: $LASTEXITCODE"
} else {
    Write-Host "代码同步完成 (退出代码: $LASTEXITCODE)" -ForegroundColor Green
}

# 复制预编译固件 UF2 到开源目录的 firmware/release/
$Uf2Source = Join-Path $SourceDir "firmware\build\flowdesk_usb_bridge.uf2"
if (Test-Path $Uf2Source) {
    $FirmwareReleaseDir = Join-Path $TargetDir "firmware\release"
    if (!(Test-Path $FirmwareReleaseDir)) {
        New-Item -ItemType Directory -Path $FirmwareReleaseDir -Force | Out-Null
    }
    Copy-Item $Uf2Source (Join-Path $FirmwareReleaseDir "flowdesk_usb_bridge.uf2") -Force
    Write-Host "已同步预编译固件: firmware/release/flowdesk_usb_bridge.uf2" -ForegroundColor Green
}

# 写入 Apache-2.0 LICENSE
$LicensePath = Join-Path $TargetDir "LICENSE"
$LicenseContent = @"
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work.

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to use, reproduce, modify, display, perform,
      sublicense, and distribute the Work and such Derivative Works in
      Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      patent license to make, have made, use, offer to sell, sell, import,
      and otherwise transfer the Work.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      shall any Contributor be liable to You for damages, including any
      direct, indirect, special, incidental, or consequential damages of
      any character arising as a result of this License or out of the
      use or inability to use the Work.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License.

   END OF TERMS AND CONDITIONS
"@
Set-Content -Path $LicensePath -Value $LicenseContent -Encoding utf8
Write-Host "已生成 LICENSE (Apache-2.0)" -ForegroundColor Green

# 写入开源版 .gitignore
$GitIgnorePath = Join-Path $TargetDir ".gitignore"
$GitIgnoreContent = @"
# Dependencies
node_modules/

# Build artifacts
dist/
desktop-build/
release/
*.log
*.tmp
*.err

# Runtime and persistent local data
.flowdesk/
.flowdesk-data/
data/

# Environment and secrets
.env
.env.local

# Firmware build intermediates
firmware/build/
firmware/.tools/

# OS and IDE
.DS_Store
Thumbs.db
.vscode/
.idea/
"@
Set-Content -Path $GitIgnorePath -Value $GitIgnoreContent -Encoding utf8
Write-Host "已配置开源版 .gitignore" -ForegroundColor Green

Write-Host "`n=== 开源同步就绪！ ===" -ForegroundColor Cyan
