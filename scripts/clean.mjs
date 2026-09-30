import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const name of ['.vite', 'out']) {
  const target = path.resolve(root, name);
  if (path.dirname(target) !== root) throw new Error(`Unsafe clean target: ${target}`);
  fs.rmSync(target, { recursive: true, force: true });
  console.log(`[Clean] Removed ${name}`);
}
