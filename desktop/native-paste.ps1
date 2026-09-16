param([Parameter(Mandatory=$true)][Int64]$Hwnd, [Parameter(Mandatory=$true)][string]$ExpectedTitle, [Parameter(Mandatory=$true)][UInt32]$ExpectedPid, [Parameter(Mandatory=$true)][string]$ExpectedStartedAt, [Parameter(Mandatory=$true)][string]$Text, [string]$UsbPort, [string]$UsbFrameId)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class FlowDeskNative {
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
}
'@
function Assert-Target {
  $foreground = [FlowDeskNative]::GetForegroundWindow().ToInt64()
  if ($foreground -ne $Hwnd) { throw 'Target window is no longer foreground; clipboard was not changed.' }
  [UInt32]$targetProcessId = 0
  [void][FlowDeskNative]::GetWindowThreadProcessId([IntPtr]$Hwnd, [ref]$targetProcessId)
  if ($targetProcessId -ne $ExpectedPid) { throw 'Target process identity changed; clipboard was not changed.' }
  $startedAt = (Get-Process -Id $targetProcessId -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')
  if ($startedAt -ne $ExpectedStartedAt) { throw 'Target process instance changed; clipboard was not changed.' }
  $buffer = New-Object System.Text.StringBuilder 1024
  [void][FlowDeskNative]::GetWindowText([IntPtr]$Hwnd, $buffer, $buffer.Capacity)
  if ($buffer.ToString() -ne $ExpectedTitle) { throw 'Target window identity changed; clipboard was not changed.' }
}
[void][FlowDeskNative]::ShowWindow([IntPtr]$Hwnd, 9)
if (-not [FlowDeskNative]::SetForegroundWindow([IntPtr]$Hwnd)) { throw 'Unable to focus selected window; clipboard was not changed.' }
Assert-Target
Add-Type -AssemblyName System.Windows.Forms
$original = [System.Windows.Forms.Clipboard]::GetDataObject()
$changed = $false
$marker = [Guid]::NewGuid().ToString('N')
$markerFormat = 'FlowDesk.PasteMarker'
try {
  $data = New-Object System.Windows.Forms.DataObject
  $data.SetText($Text)
  $data.SetData($markerFormat, $marker)
  [System.Windows.Forms.Clipboard]::SetDataObject($data, $true)
  $changed = $true
  Assert-Target
  if ($UsbPort) {
    if ($UsbPort -notmatch '^COM[1-9][0-9]*$') { throw 'Invalid USB bridge port.' }
    $serial = [System.IO.Ports.SerialPort]::new($UsbPort, 115200, [System.IO.Ports.Parity]::None, 8, [System.IO.Ports.StopBits]::One)
    try { if ($UsbFrameId -notmatch '^[1-9][0-9]*$') { throw 'Invalid USB bridge frame.' }; $serial.DtrEnable = $false; $serial.RtsEnable = $false; $serial.NewLine = "`n"; $serial.ReadTimeout = 1500; $serial.WriteTimeout = 1500; $serial.Open(); Assert-Target; $serial.WriteLine($UsbFrameId + "`t" + 'paste'); $reply = $serial.ReadLine().Trim() | ConvertFrom-Json; if (-not $reply.ok -or $reply.protocol -ne 1 -or $reply.device -ne 'FlowDesk USB Bridge' -or [string]$reply.id -ne $UsbFrameId) { throw 'USB bridge rejected or returned stale paste.' } } finally { if ($serial.IsOpen) { $serial.Close() }; $serial.Dispose() }
  } else { [System.Windows.Forms.SendKeys]::SendWait('^v') }
} finally {
  if ($changed) {
    $current = [System.Windows.Forms.Clipboard]::GetDataObject()
    if ($null -ne $current -and $current.GetData($markerFormat) -eq $marker) {
      if ($null -eq $original) { [System.Windows.Forms.Clipboard]::Clear() }
      else { [System.Windows.Forms.Clipboard]::SetDataObject($original, $true) }
    }
  }
}
