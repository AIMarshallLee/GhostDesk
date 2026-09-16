param([switch]$Server)
$ErrorActionPreference = 'Stop'
$utf8 = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8

$source = @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

public static class FlowDeskCuNative {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION U; }
  [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public UIntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public UIntPtr dwExtraInfo; }
  [DllImport("user32.dll", SetLastError=true)] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", SetLastError=true)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int maxCount);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, UIntPtr wParam, IntPtr lParam, uint flags, uint timeout, out UIntPtr result);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool ShowWindow(IntPtr hWnd, int command);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint count, INPUT[] inputs, int size);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll", SetLastError=true)] public static extern int GetSystemMetrics(int index);
  public static string Title(IntPtr hwnd) { var b = new System.Text.StringBuilder(2048); GetWindowText(hwnd,b,b.Capacity); return b.ToString(); }
  public static bool WaitForActivation(IntPtr hwnd) { UIntPtr result; return SendMessageTimeout(hwnd,0,UIntPtr.Zero,IntPtr.Zero,2,1500,out result) != IntPtr.Zero; }
  public static bool Key(ushort key, bool down) { var i = new INPUT { type=1, U=new INPUTUNION { ki=new KEYBDINPUT { wVk=key, dwFlags=down ? 0U : 2U } } }; return SendInput(1,new [] { i },Marshal.SizeOf(typeof(INPUT))) == 1; }
  public static bool KeyTap(ushort key) { var a=new [] { new INPUT { type=1,U=new INPUTUNION {ki=new KEYBDINPUT {wVk=key}}}, new INPUT { type=1,U=new INPUTUNION {ki=new KEYBDINPUT {wVk=key,dwFlags=2}}} }; return SendInput(2,a,Marshal.SizeOf(typeof(INPUT))) == 2; }
  public static bool CtrlA() { var a=new [] { new INPUT { type=1,U=new INPUTUNION {ki=new KEYBDINPUT {wVk=17}}}, new INPUT { type=1,U=new INPUTUNION {ki=new KEYBDINPUT {wVk=65}}}, new INPUT { type=1,U=new INPUTUNION {ki=new KEYBDINPUT {wVk=65,dwFlags=2}}}, new INPUT { type=1,U=new INPUTUNION {ki=new KEYBDINPUT {wVk=17,dwFlags=2}}} }; if (SendInput(4,a,Marshal.SizeOf(typeof(INPUT))) == 4) return true; Key(17,false); return false; }
  public static bool UnicodeChar(char c) { var a=new [] { new INPUT { type=1,U=new INPUTUNION {ki=new KEYBDINPUT {wScan=c,dwFlags=4}}}, new INPUT { type=1,U=new INPUTUNION {ki=new KEYBDINPUT {wScan=c,dwFlags=6}}} }; return SendInput(2,a,Marshal.SizeOf(typeof(INPUT))) == 2; }
  public static bool MousePair(uint down, uint up) { var a=new [] { new INPUT { type=0,U=new INPUTUNION {mi=new MOUSEINPUT {dwFlags=down}}}, new INPUT { type=0,U=new INPUTUNION {mi=new MOUSEINPUT {dwFlags=up}}} }; return SendInput(2,a,Marshal.SizeOf(typeof(INPUT))) == 2; }
  public static bool Wheel(int delta) { var i = new INPUT { type=0,U=new INPUTUNION {mi=new MOUSEINPUT {dwFlags=2048,mouseData=unchecked((uint)delta)}}}; return SendInput(1,new [] {i},Marshal.SizeOf(typeof(INPUT))) == 1; }
  public static string Capture(IntPtr hwnd, int width, int height) { using(var b=new Bitmap(width,height,PixelFormat.Format32bppArgb)) using(var g=Graphics.FromImage(b)) { var h=g.GetHdc(); try { if(!PrintWindow(hwnd,h,2)) throw new InvalidOperationException("PrintWindow failed"); } finally { g.ReleaseHdc(h); } int lit=0; for(int y=0;y<height;y+=Math.Max(1,height/32)) for(int x=0;x<width;x+=Math.Max(1,width/32)) { var p=b.GetPixel(x,y); if(p.A>0 && (p.R>3 || p.G>3 || p.B>3)) lit++; } if(lit==0) throw new InvalidOperationException("PrintWindow returned an empty or black image"); using(var m=new MemoryStream()) { b.Save(m,ImageFormat.Png); return Convert.ToBase64String(m.ToArray()); } } }
  // Returns source x/y/width/height plus destination x/y in the full selected-window bitmap. Pure for compile-only tests.
  public static int[] CapturePlan(RECT rect, int desktopLeft, int desktopTop, int desktopWidth, int desktopHeight) { int desktopRight=desktopLeft+desktopWidth, desktopBottom=desktopTop+desktopHeight; int left=Math.Max(rect.Left,desktopLeft), top=Math.Max(rect.Top,desktopTop), right=Math.Min(rect.Right,desktopRight), bottom=Math.Min(rect.Bottom,desktopBottom); if(right<=left || bottom<=top) return new int[0]; return new [] { left, top, right-left, bottom-top, left-rect.Left, top-rect.Top }; }
  public static string CaptureInput(RECT rect, int width, int height) { int left=GetSystemMetrics(76), top=GetSystemMetrics(77), desktopWidth=GetSystemMetrics(78), desktopHeight=GetSystemMetrics(79); var plan=CapturePlan(rect,left,top,desktopWidth,desktopHeight); if(plan.Length==0) throw new InvalidOperationException("selected window is outside the visible desktop"); using(var b=new Bitmap(width,height,PixelFormat.Format32bppArgb)) using(var g=Graphics.FromImage(b)) { g.Clear(Color.FromArgb(255,238,242,245)); g.CopyFromScreen(plan[0],plan[1],plan[4],plan[5],new Size(plan[2],plan[3]),CopyPixelOperation.SourceCopy); int lit=0; for(int y=0;y<plan[3];y+=Math.Max(1,plan[3]/32)) for(int x=0;x<plan[2];x+=Math.Max(1,plan[2]/32)) { var p=b.GetPixel(plan[4]+x,plan[5]+y); if(p.A>0 && (p.R>3 || p.G>3 || p.B>3)) lit++; } if(lit==0) throw new InvalidOperationException("input capture returned an empty or black image"); using(var m=new MemoryStream()) { b.Save(m,ImageFormat.Png); return Convert.ToBase64String(m.ToArray()); } } }
}
'@

function Reply([hashtable]$Value) { $json = $Value | ConvertTo-Json -Compress -Depth 6; if ($Server) { [Console]::Out.WriteLine($json) } else { [Console]::Out.Write($json) } }
function Fail([string]$Message) { Reply @{ ok = $false; error = $Message }; exit 1 }
function Assert-ActiveBound($hwnd, $bound) {
  if ([FlowDeskCuNative]::GetForegroundWindow() -ne $hwnd) { throw 'selected window lost focus; action cancelled' }
  [uint32]$currentPid = 0; [void][FlowDeskCuNative]::GetWindowThreadProcessId($hwnd, [ref]$currentPid)
  $current = Get-Process -Id $currentPid -ErrorAction Stop
  [FlowDeskCuNative+RECT]$currentRect = New-Object 'FlowDeskCuNative+RECT'
  if (-not [FlowDeskCuNative]::GetWindowRect($hwnd, [ref]$currentRect)) { throw 'unable to recheck selected window' }
  if ($bound.pid -ne [int]$currentPid -or $bound.process -ne $current.ProcessName -or $bound.processStart -ne $current.StartTime.ToUniversalTime().ToString('O') -or $bound.title -ne [FlowDeskCuNative]::Title($hwnd) -or $bound.width -ne ($currentRect.Right - $currentRect.Left) -or $bound.height -ne ($currentRect.Bottom - $currentRect.Top)) { throw 'selected window identity or size changed' }
}

try { Add-Type -TypeDefinition $source -ReferencedAssemblies System.Drawing -ErrorAction Stop } catch { Fail 'native helper compilation failed' }
function Invoke-NativeRequest($request) {
try {
  if ($request.operation -eq 'compile') { $result = @{ ok = $true; marker = if ($request.marker -is [string]) { $request.marker } else { '' } }; if ($null -ne $request.rect -or $null -ne $request.desktop) { if ($null -eq $request.rect -or $null -eq $request.desktop) { throw 'compile capture plan requires rect and desktop' }; $rect = New-Object 'FlowDeskCuNative+RECT'; $rect.Left=[int]$request.rect.left; $rect.Top=[int]$request.rect.top; $rect.Right=[int]$request.rect.right; $rect.Bottom=[int]$request.rect.bottom; $result.plan=[FlowDeskCuNative]::CapturePlan($rect,[int]$request.desktop.left,[int]$request.desktop.top,[int]$request.desktop.width,[int]$request.desktop.height) }; Reply $result; return }
  [void][FlowDeskCuNative]::SetThreadDpiAwarenessContext([IntPtr](-4)) # DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
  if ($request.operation -notin @('inspect','capture','capture-input','activate','execute','check','pointer')) { throw 'unsupported operation' }
  if ($request.operation -eq 'inspect') { $hwndText = [string]$request.hwnd } else { $hwndText = [string]$request.bound.hwnd }
  if ($hwndText -notmatch '^\d{1,16}$') { throw 'invalid window handle' }
  $hwnd = [IntPtr]([Int64]::Parse($hwndText, [Globalization.CultureInfo]::InvariantCulture))
  if (-not [FlowDeskCuNative]::IsWindow($hwnd) -or -not [FlowDeskCuNative]::IsWindowVisible($hwnd)) { throw 'selected window is unavailable' }
  [uint32]$windowProcessId = 0; [void][FlowDeskCuNative]::GetWindowThreadProcessId($hwnd, [ref]$windowProcessId)
  $process = Get-Process -Id $windowProcessId -ErrorAction Stop
  $title = [FlowDeskCuNative]::Title($hwnd)
  [FlowDeskCuNative+RECT]$rect = New-Object 'FlowDeskCuNative+RECT'; if (-not [FlowDeskCuNative]::GetWindowRect($hwnd, [ref]$rect)) { throw 'unable to read window size' }
  $width = $rect.Right - $rect.Left; $height = $rect.Bottom - $rect.Top
  if ($width -lt 1 -or $height -lt 1 -or [string]::IsNullOrWhiteSpace($title)) { throw 'selected window has no usable bounds or title' }
  $identity = @{ hwnd = $hwndText; pid = [int]$windowProcessId; process = $process.ProcessName; processStart = $process.StartTime.ToUniversalTime().ToString('O'); title = $title; width = $width; height = $height }
  if ($request.operation -eq 'inspect') { Reply @{ ok = $true; identity = $identity }; return }
  $bound = $request.bound
  if ($bound.pid -ne $identity.pid -or $bound.process -ne $identity.process -or $bound.processStart -ne $identity.processStart -or $bound.title -ne $identity.title -or $bound.width -ne $identity.width -or $bound.height -ne $identity.height) { throw 'selected window identity or size changed' }
  if ($request.operation -eq 'capture') { Reply @{ ok = $true; base64 = [FlowDeskCuNative]::Capture($hwnd,$width,$height); width = $width; height = $height }; return }
  if ($request.operation -eq 'capture-input') { Assert-ActiveBound $hwnd $bound; Reply @{ ok = $true; base64 = [FlowDeskCuNative]::CaptureInput($rect,$width,$height); width = $width; height = $height }; return }
  if ($request.operation -eq 'activate') {
    if ([FlowDeskCuNative]::GetForegroundWindow() -ne $hwnd) { [void][FlowDeskCuNative]::ShowWindow($hwnd,9); [void][FlowDeskCuNative]::SetForegroundWindow($hwnd) }
    # Cross-process activation is asynchronous. WM_NULL waits for the selected window to process it without typing or clicking.
    if (-not [FlowDeskCuNative]::WaitForActivation($hwnd) -or [FlowDeskCuNative]::GetForegroundWindow() -ne $hwnd) { throw 'could not activate selected window; keep the selected window in the foreground and retry' }
    Reply @{ ok = $true }; return
  }
  Assert-ActiveBound $hwnd $bound
  if ($request.operation -eq 'check') { Reply @{ ok = $true }; return }
  if ($request.operation -eq 'pointer') {
    $x = [double]$request.x; $y = [double]$request.y
    if ([double]::IsNaN($x) -or [double]::IsNaN($y) -or $x -lt 0 -or $x -gt 1 -or $y -lt 0 -or $y -gt 1) { throw 'invalid pointer coordinates' }
    $cursor = New-Object 'FlowDeskCuNative+POINT'
    if (-not [FlowDeskCuNative]::GetCursorPos([ref]$cursor)) { throw 'unable to read cursor position' }
    $point = New-Object 'FlowDeskCuNative+POINT'; $point.X = $rect.Left + [Math]::Floor($x * ($width - 1)); $point.Y = $rect.Top + [Math]::Floor($y * ($height - 1))
    Reply @{ ok = $true; pointer = @{ x = $cursor.X; y = $cursor.Y; targetX = $point.X; targetY = $point.Y; inside = [FlowDeskCuNative]::GetAncestor([FlowDeskCuNative]::WindowFromPoint($point),2) -eq $hwnd } }; return
  }
  $action = $request.action; if ($null -eq $action) { throw 'missing action' }
  if ($action.kind -in @('move','click','scroll')) { $x=[double]$action.x; $y=[double]$action.y; if ($x -lt 0 -or $x -gt 1 -or $y -lt 0 -or $y -gt 1) { throw 'invalid normalized coordinates' }; $px=$rect.Left + [Math]::Floor($x * ($width - 1)); $py=$rect.Top + [Math]::Floor($y * ($height - 1)); $point=New-Object 'FlowDeskCuNative+POINT'; $point.X=$px; $point.Y=$py; if ([FlowDeskCuNative]::GetAncestor([FlowDeskCuNative]::WindowFromPoint($point),2) -ne $hwnd) { throw 'target coordinate is not inside selected root window' }; if (-not [FlowDeskCuNative]::SetCursorPos($px,$py)) { throw 'could not position cursor' } }
  switch ($action.kind) {
    'move' { }
    'click' { if([int]$action.count -notin @(1,2)) { throw 'invalid click count' }; $flags = if ($action.button -eq 'right') { @(8,16) } elseif ($action.button -eq 'left') { @(2,4) } else { throw 'invalid mouse button' }; for($i=0;$i -lt [int]$action.count;$i++) { Assert-ActiveBound $hwnd $bound; if(-not [FlowDeskCuNative]::MousePair($flags[0],$flags[1])) { throw 'mouse input delivery uncertain' } } }
    'type' { $text=[string]$action.text; if($text.Length -lt 1 -or $text.Length -gt 4096) { throw 'invalid text length' }; foreach($char in $text.ToCharArray()) { Assert-ActiveBound $hwnd $bound; if(-not [FlowDeskCuNative]::UnicodeChar($char)) { throw 'Unicode input delivery uncertain' } } }
    'scroll' { $amount=[int]$action.amount; if($amount -lt 1 -or $amount -gt 20) { throw 'invalid scroll amount' }; $delta = if($action.direction -eq 'up'){ 120*$amount } elseif($action.direction -eq 'down'){ -120*$amount } else { throw 'invalid scroll direction' }; Assert-ActiveBound $hwnd $bound; if(-not [FlowDeskCuNative]::Wheel($delta)) { throw 'scroll delivery uncertain' } }
    'key' { $map=@{ enter=13; tab=9; backspace=8; delete=46; left=37; right=39; up=38; down=40; home=36; end=35 }; $key=[string]$action.key; if($key -eq 'ctrl+a') { Assert-ActiveBound $hwnd $bound; if(-not [FlowDeskCuNative]::CtrlA()) { throw 'keyboard input delivery uncertain' } } elseif($map.ContainsKey($key)) { Assert-ActiveBound $hwnd $bound; $code=[uint16]$map[$key]; if(-not [FlowDeskCuNative]::KeyTap($code)) { throw 'keyboard input delivery uncertain' } } else { throw 'key is not permitted' } }
    default { throw 'unsupported action' }
  }
  Reply @{ ok = $true }
} catch { Reply @{ ok = $false; error = $_.Exception.Message } }
}
if ($Server) {
  while ($null -ne ($line = [Console]::In.ReadLine())) {
    try { Invoke-NativeRequest ($line | ConvertFrom-Json -ErrorAction Stop) }
    catch { Reply @{ ok = $false; error = 'invalid native request' } }
  }
} else {
  try { Invoke-NativeRequest ([Console]::In.ReadToEnd() | ConvertFrom-Json -ErrorAction Stop) }
  catch { Fail 'invalid native request' }
}
