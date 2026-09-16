@echo off
title GhostDesk - 1-Click Quickstart
echo ========================================================
echo         GhostDesk 👻 Desktop AI Employee Substrate
echo ========================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH!
    echo Please install Node.js v20+ from https://nodejs.org/
    pause
    exit /b 1
)

echo [1/3] Checking dependencies...
if not exist node_modules (
    echo Installing dependencies via npm ci...
    call npm ci
) else (
    echo Dependencies already installed.
)

echo.
echo [2/3] Running substrate unit tests...
call npx tsx --test desktop/hybrid-policy.test.ts desktop/workspace-manager.test.ts desktop/macos-adapter.test.ts desktop/skill-hub.test.ts

echo.
echo [3/3] Launching GhostDesk Desktop Studio...
echo (Running in Developer Software Mode: USB Hardware optional)
set FLOWDESK_DEV_MODE=1
call npm run desktop
