import { build } from 'esbuild';
import { mkdir, copyFile, cp } from 'node:fs/promises';
import { computerUseRuntimeRoots, copyRuntimeLicenses } from './runtime-licenses.mjs';

await mkdir('desktop-build', { recursive: true });
await Promise.all([
  build({ entryPoints: ['desktop/main.ts'], outfile: 'desktop-build/main.cjs', bundle: true, platform: 'node', target: 'node20', format: 'cjs', external: ['electron'] }),
  build({ entryPoints: ['desktop/preload.ts'], outfile: 'desktop-build/preload.cjs', bundle: true, platform: 'node', target: 'node20', format: 'cjs', external: ['electron'] })
]);
await Promise.all(['native-paste.ps1', 'usb-serial.ps1', 'usb-channel.ps1', 'window-identity.ps1', 'cu-native.ps1'].map((name) => copyFile(`desktop/${name}`, `desktop-build/${name}`)));
await mkdir('desktop-build/firmware', { recursive: true });
await copyFile('firmware/build/flowdesk_usb_bridge.uf2', 'desktop-build/firmware/flowdesk_usb.uf2');
await cp('firmware/licenses', 'desktop-build/firmware/licenses', { recursive: true });
await mkdir('desktop-build/licenses', { recursive: true });
for (const name of ['react', 'react-dom', 'lucide-react', '@fontsource-variable/dm-sans', '@fontsource-variable/noto-sans-sc']) {
  await copyFile(`node_modules/${name}/LICENSE`, `desktop-build/licenses/${name.replaceAll('/', '-')}.txt`);
}
await copyRuntimeLicenses({ roots: computerUseRuntimeRoots });
