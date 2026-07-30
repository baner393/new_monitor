import { spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = path.join(root, 'native', 'HardwareSensorHost', 'HardwareSensorHost.csproj');
const output = path.join(root, 'resources', 'hardware-sensor');

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

const result = spawnSync('dotnet', [
  'publish', project,
  '--configuration', 'Release',
  '--framework', 'net472',
  '--output', output,
  '--nologo',
  '--verbosity', 'minimal',
], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) process.exit(result.status || 1);

for (const extension of ['.pdb', '.xml']) {
  for (const file of fs.readdirSync(output)) {
    if (file.toLowerCase().endsWith(extension)) fs.rmSync(path.join(output, file));
  }
}

const licenseSource = path.join(root, 'third_party', 'LibreHardwareMonitor');
for (const file of ['LICENSE.txt', 'THIRD-PARTY-LICENSES.txt']) {
  fs.copyFileSync(path.join(licenseSource, file), path.join(output, file));
}

const files = fs.readdirSync(output)
  .filter((file) => file !== 'manifest.json')
  .sort()
  .map((file) => {
    const content = fs.readFileSync(path.join(output, file));
    return {
      file,
      bytes: content.length,
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
    };
  });

fs.writeFileSync(path.join(output, 'manifest.json'), `${JSON.stringify({
  schemaVersion: 1,
  runtime: '.NET Framework 4.7.2 x64',
  library: 'LibreHardwareMonitorLib 0.9.6',
  files,
}, null, 2)}\n`, 'utf8');

console.log(`[SensorHost] Published ${files.length} files to ${path.relative(root, output)}`);
