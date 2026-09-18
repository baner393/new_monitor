import { defineConfig } from 'vite';
const __EDITION__ = process.env.VITE_EDITION || 'free';

export default defineConfig({
  define: {
    __IS_SPONSOR__: __EDITION__ === 'sponsor',
    MAIN_WINDOW_VITE_DEV_SERVER_URL: JSON.stringify(''),
    MAIN_WINDOW_VITE_NAME: JSON.stringify('main_window'),
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
      external: ['electron', 'child_process', 'path', 'fs', 'os', 'uiohook-napi'],
    },
    outDir: '.vite/build',
    emptyOutDir: true,
  },
  ssr: {
    noExternal: true,
  },
});
