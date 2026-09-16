import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, writeFile, copyFile, stat, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { listPackage, extractFile } from '@electron/asar';
import { createHash } from 'node:crypto';
import { readRuntimeLicenseManifest } from './runtime-licenses.mjs';

const zip = resolve('release/FlowDesk-win32-x64.zip');
await mkdir('artifacts', { recursive: true });
const extracted = await mkdtemp(resolve('artifacts/portable-verify-'));
const extractedResult = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', resolve('scripts/extract-portable.ps1'), '-Source', zip, '-Destination', extracted], { windowsHide: true, timeout: 120000 });
const receipt = { zip, bytes: (await stat(zip)).size, sha256: createHash('sha256').update(await readFile(zip)).digest('hex'), extracted, executable: join(extracted, 'FlowDesk-win32-x64', 'FlowDesk.exe'), signature: extractedResult.stdout.trim() };
const asar = join(dirname(receipt.executable), 'resources', 'app.asar');
receipt.version = JSON.parse(extractFile(asar, 'package.json').toString()).version;
if (receipt.version !== JSON.parse(await readFile('package.json', 'utf8')).version) throw new Error('Packaged version differs from source.');
const desktopFiles = ['main.cjs', 'preload.cjs', 'native-paste.ps1', 'usb-serial.ps1', 'usb-channel.ps1', 'window-identity.ps1', 'cu-native.ps1'];
const licenseFiles = ['react', 'react-dom', 'lucide-react', '@fontsource-variable-dm-sans', '@fontsource-variable-noto-sans-sc'].map(n => `licenses/${n}.txt`);
const runtimeLicenses = await readRuntimeLicenseManifest(process.cwd());
licenseFiles.push(...runtimeLicenses.files.map(name => `licenses/${name}`));
async function filesUnder(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = `${directory}/${entry.name}`;
    if (entry.isDirectory()) result.push(...await filesUnder(name));
    else if (entry.isFile()) result.push(name);
    else throw new Error(`Unexpected build entry: ${name}`);
  }
  return result;
}
const firmwareFiles = (await filesUnder('desktop-build/firmware')).map(file => file.replaceAll('\\', '/'));
const files = [...await filesUnder('dist'), ...desktopFiles.concat(licenseFiles).map(n => `desktop-build/${n}`), ...firmwareFiles];
const allowed = new Set(['package.json']);
for (const file of files) {
  const parts = file.split('/');
  for (let i = 1; i <= parts.length; i++) allowed.add(parts.slice(0, i).join('/'));
  const packaged = extractFile(asar, join(...file.split('/')));
  if (!packaged.equals(await readFile(file))) throw new Error(`Packaged file differs: ${file}`);
}
const entries = listPackage(asar).map(p => p.replaceAll('\\', '/').replace(/^\//, ''));
const unexpected = entries.filter(p => !allowed.has(p));
if (unexpected.length) throw new Error(`Unexpected packaged entries: ${unexpected.join(', ')}`);
const instructions = await readFile(join(dirname(receipt.executable), '使用说明.txt'), 'utf8');
if (instructions !== await readFile('docs/使用说明.txt', 'utf8')) throw new Error('Packaged test instructions are outdated.');
for (const [packaged, source] of [['FlowDesk-Pico-RP2040.uf2', 'firmware/build/flowdesk_usb_bridge.uf2'], ['Pico-到货烧录与测试.md', 'docs/Pico-到货烧录与测试.md']]) {
  if (!(await readFile(join(dirname(receipt.executable), packaged))).equals(await readFile(source))) throw new Error(`Packaged companion file differs: ${packaged}`);
}
const uf2 = await readFile(join(dirname(receipt.executable), 'FlowDesk-Pico-RP2040.uf2'));
if (!uf2.length || uf2.length % 512) throw new Error('Invalid UF2 length.');
for (let offset = 0; offset < uf2.length; offset += 512) {
  if (uf2.readUInt32LE(offset) !== 0x0a324655 || uf2.readUInt32LE(offset + 4) !== 0x9e5d5157 || uf2.readUInt32LE(offset + 508) !== 0x0ab16f30 || !(uf2.readUInt32LE(offset + 8) & 0x2000) || uf2.readUInt32LE(offset + 28) !== 0xe48bff56 || uf2.readUInt32LE(offset + 20) !== offset / 512 || uf2.readUInt32LE(offset + 24) !== uf2.length / 512) throw new Error('Invalid RP2040 UF2 block.');
}
receipt.firmware = { bytes: uf2.length, sha256: createHash('sha256').update(uf2).digest('hex'), family: 'RP2040', blocks: uf2.length / 512 };
if (await readFile(join(dirname(receipt.executable), 'FlowDesk-Pico-RP2040.uf2.sha256'), 'utf8') !== `${receipt.firmware.sha256}  FlowDesk-Pico-RP2040.uf2\n`) throw new Error('Firmware checksum differs.');
const userData = await mkdtemp(join(tmpdir(), 'flowdesk-portable-'));
const env = { ...process.env, FLOWDESK_SMOKE_DIR: userData };
delete env.ELECTRON_RUN_AS_NODE;
const result = await promisify(execFile)(receipt.executable, ['--smoke-test'], { cwd: userData, env, windowsHide: true, timeout: 30000, maxBuffer: 500000 });
if (!result.stdout.includes('FlowDesk renderer loaded successfully. Simulator IPC relay ready; parent access blocked.')) throw new Error('Extracted application did not report readiness.');
const usbUserData = await mkdtemp(join(tmpdir(), 'flowdesk-portable-usb-'));
const usbResult = await promisify(execFile)(receipt.executable, ['--usb-smoke-test'], { cwd: usbUserData, env: { ...env, FLOWDESK_SMOKE_DIR: usbUserData }, windowsHide: true, timeout: 120000, maxBuffer: 500000 });
if (!usbResult.stdout.includes('FlowDesk USB replies smoke passed.')) throw new Error('Extracted USB replies smoke did not pass.');
const computerUseUserData = await mkdtemp(join(tmpdir(), 'flowdesk-portable-cu-'));
const computerUseEnv = { ...process.env, FLOWDESK_SMOKE_DIR: computerUseUserData };
delete computerUseEnv.ELECTRON_RUN_AS_NODE;
const computerUseResult = await promisify(execFile)(receipt.executable, ['--cu-smoke-test'], { cwd: computerUseUserData, env: computerUseEnv, windowsHide: true, timeout: 60000, maxBuffer: 500000 });
if (!computerUseResult.stdout.includes('FlowDesk Computer Use SDK smoke passed.')) throw new Error('Extracted application did not report a Computer Use SDK smoke pass.');
const geminiUserData = await mkdtemp(join(tmpdir(), 'flowdesk-portable-gemini-'));
const geminiResult = await promisify(execFile)(receipt.executable, ['--gemini-smoke-test'], { cwd: geminiUserData, env: { ...env, FLOWDESK_SMOKE_DIR: geminiUserData }, windowsHide: true, timeout: 180000, maxBuffer: 500000 });
if (!geminiResult.stdout.includes('FlowDesk Gemini native smoke passed.')) throw new Error('Extracted Gemini native smoke did not pass.');
const geminiRepliesUserData = await mkdtemp(join(tmpdir(), 'flowdesk-portable-gemini-replies-'));
const geminiRepliesResult = await promisify(execFile)(receipt.executable, ['--gemini-replies-smoke-test'], { cwd: geminiRepliesUserData, env: { ...env, FLOWDESK_SMOKE_DIR: geminiRepliesUserData }, windowsHide: true, timeout: 240000, maxBuffer: 500000 });
if (!geminiRepliesResult.stdout.includes('FlowDesk Gemini persistent replies smoke passed.')) throw new Error('Extracted Gemini persistent replies smoke did not pass.');
const repliesUserData = await mkdtemp(join(tmpdir(), 'flowdesk-portable-replies-'));
const repliesEnv = { ...process.env, FLOWDESK_SMOKE_DIR: repliesUserData };
delete repliesEnv.ELECTRON_RUN_AS_NODE;
const repliesResult = await promisify(execFile)(receipt.executable, ['--replies-smoke-test'], { cwd: repliesUserData, env: repliesEnv, windowsHide: true, timeout: 120000, maxBuffer: 500000 });
if (!repliesResult.stdout.includes('FlowDesk desktop replies smoke passed.')) throw new Error('Extracted persistent desktop replies did not pass.');
receipt.asarEntries = entries.length;
receipt.verifiedRuntimeFiles = files.length;
receipt.freshDirectorySmoke = result.stdout.trim();
receipt.computerUseSmoke = computerUseResult.stdout.trim();
receipt.geminiSmoke = geminiResult.stdout.trim();
receipt.geminiRepliesSmoke = geminiRepliesResult.stdout.trim();
receipt.desktopRepliesSmoke = repliesResult.stdout.trim();
receipt.usbSmoke = usbResult.stdout.trim();
receipt.checkedAt = new Date().toISOString();
await copyFile('artifacts/portable-verification.json', `artifacts/portable-verification.previous-${Date.now()}.json`).catch(error => { if (error.code !== 'ENOENT') throw error; });
await writeFile('artifacts/portable-verification.json', JSON.stringify(receipt, null, 2));
const actualHash = createHash('sha256').update(await readFile(receipt.zip)).digest('hex');
if (actualHash !== receipt.sha256) throw new Error('ZIP changed during verification.');
await writeFile('release/FlowDesk-win32-x64.zip.sha256', `${actualHash}  FlowDesk-win32-x64.zip\n`);
const checksums = JSON.parse(await readFile('release/SHA256.json', 'utf8'));
await copyFile('release/SHA256.json', `release/SHA256.json.previous-${Date.now()}`);
const windows = checksums.find(item => item.name === 'windows');
Object.assign(windows, { bytes: receipt.bytes, sha256: actualHash, verifiedAt: receipt.checkedAt });
const firmware = checksums.find(item => item.name === 'firmware');
Object.assign(firmware, { bytes: receipt.firmware.bytes, sha256: receipt.firmware.sha256, verifiedAt: receipt.checkedAt });
await writeFile('release/SHA256.json', JSON.stringify(checksums, null, 2));
await writeFile('release/FlowDesk-Pico-RP2040.uf2', uf2);
await writeFile('release/FlowDesk-Pico-RP2040.uf2.sha256', `${receipt.firmware.sha256}  FlowDesk-Pico-RP2040.uf2\n`);
await copyFile('docs/Pico-到货烧录与测试.md', 'release/Pico-到货烧录与测试.md');
console.log(JSON.stringify(receipt, null, 2));
