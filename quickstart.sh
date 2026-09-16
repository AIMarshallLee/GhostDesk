#!/usr/bin/env bash
set -e

echo "========================================================"
echo "        GhostDesk 👻 Desktop AI Employee Substrate      "
echo "                 (macOS & Linux Edition)                "
echo "========================================================"
echo ""

if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not installed or not in PATH!"
    echo "Please install Node.js v20+ from https://nodejs.org/"
    exit 1
fi

echo "[1/3] Checking dependencies..."
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies via npm ci..."
    npm ci
else
    echo "Dependencies already installed."
fi

echo ""
echo "[2/3] Running substrate unit tests..."
npx tsx --test desktop/hybrid-policy.test.ts desktop/workspace-manager.test.ts desktop/macos-adapter.test.ts desktop/skill-hub.test.ts

echo ""
echo "[3/3] Launching GhostDesk Desktop Studio..."
echo "(Running in Developer Software Mode: USB Hardware optional)"
export FLOWDESK_DEV_MODE=1
npm run desktop
