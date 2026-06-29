import { defineConfig } from 'vite';
import fs from 'fs';

const __EDITION__ = fs.existsSync('.build-edition')
  ? fs.readFileSync('.build-edition', 'utf-8').trim()
  : (process.env.VITE_EDITION || 'free');

export default defineConfig({
  define: {
    __IS_SPONSOR__: __EDITION__ === 'sponsor',
  },
  resolve: {
    browserField: false,
    mainFields: ['module', 'jsnext:main', 'jsnext'],
  },
  build: {
    lib: {
      entry: 'src/main/index.js',
      formats: ['cjs'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: ['electron', 'child_process', 'path', 'fs', 'os'],
    },
    outDir: '.vite/build',
    emptyOutDir: true,
  },
  ssr: {
    noExternal: true,
  },
});