import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts', script), ...args], {
      cwd: root,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${script} exited with ${code}`)));
  });
}

await run('clean.mjs');
await run('package.mjs', ['free']);
await run('package.mjs', ['sponsor']);
await run('verify-artifacts.mjs');
console.log('[Package] Both editions passed artifact verification');
