import { defineConfig } from 'vite';

const __EDITION__ = (process.env.VITE_EDITION || 'free');

export default defineConfig({
  define: {
    __IS_SPONSOR__: __EDITION__ === 'sponsor',
  },
  resolve: {
    browserField: false,
    mainFields: ['module', 'jsnext:main', 'jsnext'],
  },
  build: {
    outDir: '.vite/build',
    ssr: 'src/main/index.js',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        format: 'cjs',
        entryFileNames: 'index.js',
      },
      external: ['electron', 'child_process', 'path', 'fs', 'os'],
    },
  },
  ssr: {
    noExternal: true,
  },
});
