import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },

  build: {
    outDir: 'dist',
    sourcemap: true
  }
});
