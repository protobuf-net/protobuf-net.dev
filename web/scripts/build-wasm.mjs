// Publishes the .NET WASM project and drops its _framework output into public/, where Vite
// copies it verbatim. The .NET boot process resolves its own hashed filenames from within
// _framework, so the folder must be copied whole and left unprocessed by the bundler.

import { spawnSync } from 'node:child_process';
import { cp, rm, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..');
const project = resolve(webRoot, '../src/ProtoGen.Wasm/ProtoGen.Wasm.csproj');
const publishFramework = resolve(
  webRoot,
  '../src/ProtoGen.Wasm/bin/Release/net10.0-browser/publish/wwwroot/_framework',
);
const target = resolve(webRoot, 'public/_framework');

console.log('> dotnet publish ProtoGen.Wasm -c Release');
const result = spawnSync('dotnet', ['publish', project, '-c', 'Release', '--nologo'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (result.status !== 0) {
  console.error('dotnet publish failed');
  process.exit(result.status ?? 1);
}

try {
  await access(publishFramework);
} catch {
  console.error(`expected publish output at ${publishFramework}, but it is not there`);
  process.exit(1);
}

// the runtime filenames are content-hashed, so stale copies accumulate unless we clear first
await rm(target, { recursive: true, force: true });
await cp(publishFramework, target, { recursive: true });
console.log(`> copied _framework -> ${target}`);
