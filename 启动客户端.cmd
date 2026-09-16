@echo off
if exist "%~dp0release\FlowDesk-win32-x64\FlowDesk.exe" (
  start "FlowDesk" "%~dp0release\FlowDesk-win32-x64\FlowDesk.exe"
) else (
  echo FlowDesk.exe not found. Run npm run package:win in this folder first.
  pause
)
