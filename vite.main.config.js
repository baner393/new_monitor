import { defineConfig } from 'vite';
import fs from 'fs';

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
    rollupOptions: {
      external: ['electron', 'child_process', 'path', 'fs', 'os'],
    },
  },
  ssr: {
    noExternal: true,
  },
});
