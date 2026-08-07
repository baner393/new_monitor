import { build } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const edition = process.env.VITE_EDITION || 'free';

if (!['free', 'sponsor'].includes(edition)) {
  throw new Error(`Invalid VITE_EDITION: ${edition}`);
}

async function run() {
  console.log(`[Build] Edition: ${edition}`);

  await build({
    configFile: path.join(root, 'vite.main.build.js'),
    build: {
      outDir: path.join(root, '.vite', 'build'),
      ssr: path.join(root, 'src', 'main', 'index.js'),
      emptyOutDir: true,
    },
  });

  await build({
    configFile: path.join(root, 'vite.preload.config.js'),
    build: {
      outDir: path.join(root, '.vite', 'build'),
      ssr: path.join(root, 'src', 'main', 'preload.js'),
      emptyOutDir: false,
    },
  });

  await build({ configFile: path.join(root, 'vite.renderer.config.js') });

  if (edition === 'sponsor') {
    const customSource = path.join(root, 'src', 'custom');
    const customDestination = path.join(root, '.vite', 'build', 'src', 'custom');
    const fontSource = path.join(root, 'public', 'assets', 'fonts');
    const fontDestination = path.join(root, '.vite', 'build', 'assets', 'fonts');
    fs.cpSync(customSource, customDestination, { recursive: true });
    fs.cpSync(fontSource, fontDestination, { recursive: true });
  }

  const publisherSource = path.join(root, 'src', 'publisher');
  const publisherDestination = path.join(root, '.vite', 'build', 'src', 'publisher');
  fs.cpSync(publisherSource, publisherDestination, { recursive: true });

  fs.writeFileSync(
    path.join(root, '.vite', 'build', 'edition.json'),
    `${JSON.stringify({ edition }, null, 2)}\n`,
    'utf8',
  );

  console.log(`[Build] ${edition} edition build complete`);
}

run().catch((error) => {
  console.error('[Build] Failed:', error);
  process.exitCode = 1;
});
