import { defineConfig } from 'vite';
import fs from 'fs';

const __EDITION__ = (process.env.VITE_EDITION || 'free');

export default defineConfig({
  define: {
    __IS_SPONSOR__: __EDITION__ === 'sponsor',
  },
  build: {
    rollupOptions: {
      external: ['electron'],
    },
  },
});
