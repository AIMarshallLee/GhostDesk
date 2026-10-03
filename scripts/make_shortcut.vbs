Set ws = CreateObject("WScript.Shell")
Set s = ws.CreateShortcut("C:\Users\dasea\Desktop\GhostDesk_Console.lnk")
s.TargetPath = "C:\Users\dasea\AppData\Local\Programs\Python\Python312\pythonw.exe"
s.Arguments = "d:\GhostDesk\desktop\mcp_gui_dashboard.py"
s.WorkingDirectory = "d:\GhostDesk"
s.IconLocation = "C:\Users\dasea\AppData\Local\Programs\Python\Python312\python.exe,0"
s.Description = "GhostDesk AI Console"
s.Save
