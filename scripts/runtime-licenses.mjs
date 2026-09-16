import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

export const computerUseRuntimeRoots = ['@ui-tars/sdk', 'uuid', 'pinyin-pro', '@google/genai'];
const legalFile = /^(license|licence|copying|notice)(?:[._-].*)?$/i;
const safeRelativeFile = /^(?:runtime\/[A-Za-z0-9@._-]+\/[A-Za-z0-9@._-]+|runtime-manifest\.json)$/;
const vendoredNotices = {
  '@tokenizer/token@0.3.0': {
    file: 'licenses/third-party/tokenizer-token-0.3.0.txt',
    sourceUrl: 'https://raw.githubusercontent.com/Borewit/tokenizer-token/e068a455370090f44c757946b8571bb3fb1f117e/README.md',
    sourceSha: 'e068a455370090f44c757946b8571bb3fb1f117e'
  },
  'readable-web-to-node-stream@3.0.4': {
    file: 'licenses/third-party/readable-web-to-node-stream-3.0.4.txt',
    sourceUrl: 'https://raw.githubusercontent.com/Borewit/readable-web-to-node-stream/dcaea1e302f51bcb7d401fbd67374bb4c22bf788/README.md',
    sourceSha: 'dcaea1e302f51bcb7d401fbd67374bb4c22bf788'
  },
  'omggif@1.0.10': {
    file: 'licenses/third-party/omggif-1.0.10.txt',
    sourceUrl: 'https://raw.githubusercontent.com/deanm/omggif/334a0c0b6aa2eb5e63fae64ba7911ee647655ab2/README',
    sourceSha: '334a0c0b6aa2eb5e63fae64ba7911ee647655ab2'
  },
  'parse-bmfont-ascii@1.0.6': {
    file: 'licenses/third-party/parse-bmfont-ascii-1.0.6.txt',
    sourceUrl: 'https://raw.githubusercontent.com/mattdesl/parse-bmfont-ascii/5f22b037ae7460f629dd681db23cd9b543a76b06/LICENSE.md',
    sourceSha: '5f22b037ae7460f629dd681db23cd9b543a76b06'
  },
  'data-uri-to-buffer@4.0.1': {
    file: 'licenses/third-party/data-uri-to-buffer-4.0.1.txt',
    sourceUrl: 'https://raw.githubusercontent.com/TooTallNate/node-data-uri-to-buffer/85cd8c854aefbf1bb636789d80364cfac8ea1583/README.md',
    sourceSha: '85cd8c854aefbf1bb636789d80364cfac8ea1583'
  }
};

async function existingFile(path) {
  return await stat(path).then(entry => entry.isFile()).catch(() => false);
}

async function packageJsonPath(packageName, fromDirectory) {
  for (let directory = resolve(fromDirectory);;) {
    const candidate = join(directory, 'node_modules', packageName, 'package.json');
    if (await existingFile(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Runtime dependency is missing: ${packageName}`);
    directory = parent;
  }
}

async function licenseNames(packageDirectory) {
  const entries = await readdir(packageDirectory, { withFileTypes: true });
  return entries.filter(entry => entry.isFile() && legalFile.test(entry.name)).map(entry => entry.name).sort();
}

function packageDirectoryName(name, version) {
  return `${name.replaceAll('/', '__')}@${version}`.replace(/[^A-Za-z0-9@._-]/g, '_');
}

export async function copyRuntimeLicenses({ root = process.cwd(), outputDirectory = 'desktop-build/licenses', roots = computerUseRuntimeRoots } = {}) {
  const absoluteRoot = resolve(root);
  const absoluteOutput = resolve(absoluteRoot, outputDirectory);
  const runtimeOutput = join(absoluteOutput, 'runtime');
  const relativeOutput = relative(absoluteRoot, runtimeOutput);
  if (!relativeOutput || isAbsolute(relativeOutput) || relativeOutput === '..' || relativeOutput.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) throw new Error('Runtime license output must stay inside the project.');
  await rm(runtimeOutput, { recursive: true, force: true });

  const pending = roots.map(name => ({ name, fromDirectory: absoluteRoot }));
  const visited = new Set();
  const packages = [];
  while (pending.length) {
    const { name, fromDirectory } = pending.shift();
    const jsonPath = await packageJsonPath(name, fromDirectory);
    const packageDirectory = dirname(jsonPath);
    const metadata = JSON.parse(await readFile(jsonPath, 'utf8'));
    if (!metadata.name || !metadata.version) throw new Error(`Invalid package metadata: ${jsonPath}`);
    const identity = `${metadata.name}@${metadata.version}`;
    if (visited.has(identity)) continue;
    visited.add(identity);
    const names = await licenseNames(packageDirectory);
    const licenses = [];
    const destinationDirectory = join(runtimeOutput, packageDirectoryName(metadata.name, metadata.version));
    await mkdir(destinationDirectory, { recursive: true });
    if (!names.length) {
      const vendored = vendoredNotices[identity];
      if (!vendored || !await existingFile(join(absoluteRoot, vendored.file))) throw new Error(`No LICENSE, COPYING, or NOTICE file found for ${identity}`);
      const output = join(destinationDirectory, 'NOTICE.txt');
      await cp(join(absoluteRoot, vendored.file), output, { force: true });
      licenses.push(relative(absoluteOutput, output).replaceAll('\\', '/'));
      packages.push({ name: metadata.name, version: metadata.version, license: metadata.license ?? null, licenses, vendoredSource: { sourceUrl: vendored.sourceUrl, sourceSha: vendored.sourceSha, sourceFile: vendored.file } });
    } else {
      for (const name of names) {
        const output = join(destinationDirectory, name);
        await cp(join(packageDirectory, name), output, { force: true });
        licenses.push(relative(absoluteOutput, output).replaceAll('\\', '/'));
      }
      packages.push({ name: metadata.name, version: metadata.version, license: metadata.license ?? null, licenses });
    }
    for (const dependency of Object.keys({ ...metadata.dependencies, ...metadata.optionalDependencies }).sort()) {
      pending.push({ name: dependency, fromDirectory: packageDirectory });
    }
  }
  packages.sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));
  const files = packages.flatMap(entry => entry.licenses).sort();
  const manifest = { version: 1, roots: [...roots], packages, files };
  await mkdir(absoluteOutput, { recursive: true });
  await writeFile(join(absoluteOutput, 'runtime-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export async function readRuntimeLicenseManifest(root = process.cwd()) {
  const licensesDirectory = resolve(root, 'desktop-build/licenses');
  const manifestPath = join(licensesDirectory, 'runtime-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.version !== 1 || !Array.isArray(manifest.files) || !manifest.files.every(file => typeof file === 'string' && safeRelativeFile.test(file))) {
    throw new Error('Runtime license manifest is invalid. Rebuild desktop artifacts.');
  }
  for (const file of manifest.files) {
    if (!await existingFile(join(licensesDirectory, file))) throw new Error(`Runtime license file is missing: ${file}`);
  }
  return { directory: licensesDirectory, files: ['runtime-manifest.json', ...manifest.files], manifest };
}
