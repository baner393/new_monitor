import { defineConfig } from 'vite';

export default defineConfig({
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
