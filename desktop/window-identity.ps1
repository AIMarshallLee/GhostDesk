param([Parameter(Mandatory=$true)][Int64]$Hwnd)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class FlowDeskWindowIdentity {
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint id);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
'@
$id = 0
[void][FlowDeskWindowIdentity]::GetWindowThreadProcessId([IntPtr]$Hwnd, [ref]$id)
if (!$id) { throw 'Window is unavailable.' }
$title = New-Object System.Text.StringBuilder 1024
[void][FlowDeskWindowIdentity]::GetWindowText([IntPtr]$Hwnd, $title, $title.Capacity)
$process = Get-Process -Id $id -ErrorAction Stop
@{ ProcessName = $process.ProcessName; MainWindowTitle = $title.ToString(); MainWindowHandle = $Hwnd; ProcessId = [Int32]$id; StartedAt = $process.StartTime.ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress
