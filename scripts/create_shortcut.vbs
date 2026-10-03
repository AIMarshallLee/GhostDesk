Set oWS = WScript.CreateObject("WScript.Shell")
sLinkFile = "C:\Users\dasea\Desktop\GhostDesk实测.lnk"
Set oLink = oWS.CreateShortcut(sLinkFile)
oLink.TargetPath = "C:\Users\dasea\AppData\Local\Programs\Python\Python312\python.exe"
oLink.Arguments = "scripts\full_car_live_run.py"
oLink.WorkingDirectory = "d:\GhostDesk"
oLink.Save
