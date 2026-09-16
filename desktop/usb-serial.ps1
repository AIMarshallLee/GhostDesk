param([Parameter(Mandatory=$true)][string]$Port, [Parameter(Mandatory=$true)][string]$Frame)
$ErrorActionPreference = 'Stop'
if ($Port -notmatch '^COM[1-9][0-9]*$' -or $Frame.Length -gt 128 -or $Frame -notmatch '^[ -~\t]+$') { throw 'Invalid USB bridge request.' }
$serial = [System.IO.Ports.SerialPort]::new($Port, 115200, [System.IO.Ports.Parity]::None, 8, [System.IO.Ports.StopBits]::One)
$serial.DtrEnable = $false; $serial.RtsEnable = $false; $serial.NewLine = "`n"; $serial.ReadTimeout = 1500; $serial.WriteTimeout = 1500
try { $serial.Open(); $serial.WriteLine($Frame); $reply = $serial.ReadLine().Trim(); if (!$reply) { throw 'USB bridge returned no reply.' }; $reply } finally { if ($serial.IsOpen) { $serial.Close() }; $serial.Dispose() }
