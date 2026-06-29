import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const _require = createRequire(import.meta.url);

/**
 * Vite plugin that obfuscates JS output after bundle is written.
 * Runs in closeBundle hook — after Vite finishes writing, before Forge packages.
 */
export function obfuscatePlugin() {
  let outDir;

  return {
    name: 'vite-obfuscate-plugin',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      if (!outDir || !fs.existsSync(outDir)) return;

      let obfuscatorConfig;
      try {
        obfuscatorConfig = _require(path.resolve(process.cwd(), 'obfuscator.config.js'));
      } catch {
        console.warn('[vite-obfuscate] No obfuscator.config.js found, skipping');
        return;
      }

      let JavaScriptObfuscator;
      try {
        JavaScriptObfuscator = _require('javascript-obfuscator');
      } catch {
        console.warn('[vite-obfuscate] javascript-obfuscator not installed, skipping');
        return;
      }

      console.log(`[vite-obfuscate] Obfuscating ${outDir}...`);

      let totalOrig = 0;
      let totalNew = 0;
      let count = 0;

      function processDir(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory() && entry.name !== 'node_modules') {
            processDir(fullPath);
          } else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.endsWith('.map')) {
            const code = fs.readFileSync(fullPath, 'utf-8');
            const origSize = Buffer.byteLength(code);
            const result = JavaScriptObfuscator.obfuscate(code, obfuscatorConfig);
            const obfuscated = result.getObfuscatedCode();
            fs.writeFileSync(fullPath, obfuscated, 'utf-8');
            const newSize = Buffer.byteLength(obfuscated);
            totalOrig += origSize;
            totalNew += newSize;
            count++;
            const rel = path.relative(outDir, fullPath);
            const diff = newSize - origSize;
            console.log(`  ${rel}  ${fmt(origSize)} → ${fmt(newSize)} (${diff >= 0 ? '+' : ''}${fmt(diff)})`);
          }
        }
      }

      processDir(outDir);
      console.log(`[vite-obfuscate] Done. ${count} file(s): ${fmt(totalOrig)} → ${fmt(totalNew)} (${totalNew - totalOrig >= 0 ? '+' : ''}${fmt(totalNew - totalOrig)})`);
    }
  };
}

function fmt(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}