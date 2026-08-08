import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const child = spawn(process.execPath, [path.join(root, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js'), '--win', '--x64', '--config', 'developer-skin-publisher.config.cjs'], { cwd: root, stdio: 'inherit' });
child.once('exit', (code) => { process.exitCode = code || 0; });
