import { spawn } from 'node:child_process';
import path from 'node:path';
const cwd = process.cwd();
const children = [
  spawn(process.execPath, [path.join(cwd, 'node_modules/tsx/dist/cli.mjs'), 'watch', 'server/index.ts'], { stdio: 'inherit', windowsHide: true }),
  spawn(process.execPath, [path.join(cwd, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1'], { stdio: 'inherit', windowsHide: true }),
];
let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; children.forEach(child => child.kill()); setTimeout(() => process.exit(code), 300); }
children.forEach(child => child.on('exit', code => stop(code || 0)));
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
