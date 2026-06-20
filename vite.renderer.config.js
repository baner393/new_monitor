import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  build: {
    rollupOptions: {
      external: ['electron'],
    },
  },
});
