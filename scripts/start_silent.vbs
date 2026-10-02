Set WshShell = CreateObject("WScript.Shell")
' 0 表示完全隐藏窗口静默运行，无需黑色控制台弹窗打扰
WshShell.Run "python """ & WshShell.CurrentDirectory & "\scripts\walkie_talkie.py""", 0, False
