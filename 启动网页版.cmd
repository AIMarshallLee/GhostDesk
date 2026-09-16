@echo off
cd /d "%~dp0"
echo FlowDesk local web: http://127.0.0.1:5178
echo Keep this window open while using the local web workspace.
call npm.cmd run dev
pause
