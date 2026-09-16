param([Parameter(Mandatory=$true)][string]$Source, [Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
Expand-Archive -LiteralPath $Source -DestinationPath $Destination
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -Force
(Get-AuthenticodeSignature -LiteralPath (Join-Path $Destination 'FlowDesk-win32-x64/FlowDesk.exe')).Status.ToString()
