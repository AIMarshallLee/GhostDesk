import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

console.log('=== FlowDesk Dual-Mode One-Click Patch Script ===');

const targetArgs = process.argv.slice(2);
let flowDeskDir = targetArgs[0];

if (!flowDeskDir) {
  const candidates = [
    'D:/FlowDesk/FlowDesk-win32-x64',
    'D:/GhostDesk/FlowDesk-win32-x64/FlowDesk-win32-x64',
    './FlowDesk-win32-x64',
    '../FlowDesk-win32-x64',
    'C:/FlowDesk/FlowDesk-win32-x64'
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'resources', 'app.asar'))) {
      flowDeskDir = path.resolve(c);
      break;
    }
  }
}

if (!flowDeskDir || !fs.existsSync(path.join(flowDeskDir, 'resources', 'app.asar'))) {
  console.error('Error: resources/app.asar not found. Usage: node scripts/patch_flowdesk.mjs <path-to-FlowDesk-win32-x64>');
  process.exit(1);
}

console.log(`[1/4] Found FlowDesk at: ${flowDeskDir}`);

try {
  if (process.platform === 'win32') {
    execSync('powershell -Command "Get-Process FlowDesk -ErrorAction SilentlyContinue | Stop-Process -Force"');
  }
} catch {}

const resourcesDir = path.join(flowDeskDir, 'resources');
const asarPath = path.join(resourcesDir, 'app.asar');
const backupPath = path.join(resourcesDir, 'app.asar.orig');
const extractDir = path.join(resourcesDir, 'app_extracted');

if (!fs.existsSync(backupPath)) {
  console.log('Creating backup: app.asar.orig');
  fs.copyFileSync(asarPath, backupPath);
}

console.log('[2/4] Extracting app.asar...');
if (fs.existsSync(extractDir)) {
  fs.rmSync(extractDir, { recursive: true, force: true });
}
execSync(`npx --yes @electron/asar extract "${asarPath}" "${extractDir}"`, { stdio: 'inherit' });

console.log('[3/4] Patching dual-mode logic into desktop-build/main.cjs...');
const mainCjsPath = path.join(extractDir, 'desktop-build', 'main.cjs');
let code = fs.readFileSync(mainCjsPath, 'utf8');

// 1. requireHealthy virtual fallback
code = code.replace(
  /const requireHealthy = async \(\) => \{[\s\S]*?if \(!channel\) throw new Error\([^;]*?\);/,
  "const requireHealthy = async () => {\n    if (!channel) return { connected: true, armed: true, device: 'FlowDesk CyberDeck / Native Automation', firmware: '1.0.0', board: 'native', protocol: 4, message: '' };"
);

// 2. device hasHardware and state fallback
code = code.replace(
  /const device = \{[\s\S]*?state: stateCopy,/,
  "const device = {\n    hasHardware: () => !!channel,\n    state: () => { const copy = stateCopy(); if (!channel) return { connected: true, armed: true, device: 'FlowDesk CyberDeck / Native Automation', firmware: '1.0.0', board: 'native', protocol: 4, message: '' }; return copy; },"
);

// 3. virtual begin session when !channel
code = code.replace(
  /(async begin\(signal\) \{[\s\S]*?signal\?\.throwIfAborted\(\);)/,
  "$1\n      if (!channel) { let stopped = false; const vSession = { check() { signal?.throwIfAborted(); if (stopped) throw new Error('虚拟会话已停止。'); }, async command() {}, async stop() { stopped = true; if (owner === vSession) owner = void 0; } }; owner = vSession; return vSession; }"
);

// 4. status virtual return
code = code.replace(
  /(async status\(\) \{[\s\S]*?if \(channel\) \{[\s\S]*?\}\s*\})([\s\S]*?return stateCopy\(\);)/,
  "$1\n        return stateCopy();\n      }\n      return { connected: true, armed: true, device: 'FlowDesk CyberDeck / Native Automation', firmware: '1.0.0', board: 'native', protocol: 4, message: '' };"
);

// 5. createUsbWindowsDriver observer fallback
code = code.replace(
  /(async function createUsbWindowsDriver\(target, scriptPath, device, signal, readIme\) \{[\s\S]*?const observer = await createWindowsComputerUseDriver\(target, scriptPath, signal, true\);)/,
  "$1\n  if (device.hasHardware && !device.hasHardware()) { return { target: observer.target, check: observer.check, close: observer.close, activate: observer.activate, focus: observer.focus, observe: observer.observe, observeInput: observer.observeInput, async execute(action) { await observer.activate(); await observer.execute(action); } }; }"
);

// 6. pasteTask remove requireUsbHardware and complete
code = code.replace(
  /await requireUsbHardware\(usbDevice\);/,
  "/* dual-mode bypass hardware requirement */"
);

// 7. software paste enablement
code = code.replace(
  /throw new Error\("\\u8F6F\\u4EF6\\u7C98\\u8D34\\u5DF2\\u7981\\u7528[^\"]*?"\);/,
  "return { ok: true, message: '已填入目标窗口' };"
);

// 8. continuous replies inputBackend constraint
code = code.replace(
  /if \(controller\.state\(\)\.config\.inputBackend !== "usb"\) throw new Error\([^)]*?\);/,
  "/* dual-mode backend */"
);

fs.writeFileSync(mainCjsPath, code, 'utf8');

// Patch cu-native.ps1 tolerance
const cuNativePath = path.join(extractDir, 'desktop-build', 'cu-native.ps1');
if (fs.existsSync(cuNativePath)) {
  let cuCode = fs.readFileSync(cuNativePath, 'utf8');
  cuCode = cuCode.replace(
    /\(-not \[FlowDeskCuNative\]::GetWindowRect\(\$hwnd, \[ref\]\$currentRect\)\) \{ throw 'unable to recheck selected window' \}/,
    "(-not [FlowDeskCuNative]::GetWindowRect($hwnd, [ref]$currentRect)) { throw 'unable to recheck selected window' }\n  $actualTitle = [FlowDeskCuNative]::Title($hwnd)\n  $titleOk = ($bound.title -eq $actualTitle) -or ($actualTitle -like \"*$($bound.title)*\") -or ($bound.title -like \"*$($actualTitle)*\") -or ($current.ProcessName -eq 'Weixin')"
  );
  cuCode = cuCode.replace(
    /if \(\$bound\.pid -ne \[int\]\$currentPid -or \$bound\.process -ne \$current\.ProcessName -or \$bound\.processStart -ne \$current\.StartTime\.ToUniversalTime\(\)\.ToString\('O'\) -or \$bound\.title -ne \[FlowDeskCuNative\]::Title\(\$hwnd\) -or \$bound\.width -ne \(\$currentRect\.Right - \$currentRect\.Left\) -or \$bound\.height -ne \(\$currentRect\.Bottom - \$currentRect\.Top\)\) \{ throw 'selected window identity or size changed' \}/,
    "if ($bound.pid -ne [int]$currentPid -or $bound.process -ne $current.ProcessName -or (-not $titleOk)) { throw 'selected window identity or size changed' }"
  );
  fs.writeFileSync(cuNativePath, cuCode, 'utf8');
}

console.log('[4/4] Repacking app.asar...');
execSync(`npx --yes @electron/asar pack "${extractDir}" "${asarPath}"`, { stdio: 'inherit' });
fs.rmSync(extractDir, { recursive: true, force: true });

console.log('=== FlowDesk Dual-Mode Patch Successful! ===');
