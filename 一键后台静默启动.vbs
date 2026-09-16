' ========================================================
' GhostDesk 👻 M5Stack CoreS3 后台静默启动器 (无黑框窗口)
' 双击本文件即可在后台隐形启动对讲机与代码搭子服务，不占屏幕和任务栏。
' ========================================================

Set WshShell = CreateObject("WScript.Shell")

' 检查是否已在运行
Set objWMIService = GetObject("winmgmts:\\.\root\cimv2")
Set colItems = objWMIService.ExecQuery("Select * from Win32_Process Where CommandLine Like '%walkie_talkie.py%'")

If colItems.Count > 0 Then
    WScript.Echo "✨ GhostDesk 对讲机后台服务已经在静默运行中！" & vbCrLf & "直接拿起桌上的 M5Stack CoreS3 说话即可。"
    WScript.Quit
End If

' 查找 pythonw.exe (无控制台黑框运行)
Dim pythonCmd
pythonCmd = "pythonw.exe scripts\walkie_talkie.py"

' 以 0 (完全隐藏窗口) 异步启动
WshShell.Run pythonCmd, 0, False

WScript.Echo "🎉 GhostDesk AI 对讲机后台服务已在后台静默启动！" & vbCrLf & vbCrLf & _
             "• 没有黑框命令行窗口，不占任务栏" & vbCrLf & _
             "• 随时拿起桌上的 M5Stack CoreS3 按住说话" & vbCrLf & _
             "• 如需关闭，双击运行【一键停止后台服务.bat】即可"
