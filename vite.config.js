import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  // opencascade.js 内部以 `import wasm from "./opencascade.full.wasm"` 的形式
  // 引用 wasm。把 .wasm 当作静态资源，import 才会拿到 URL 字符串——
  // 这正是 initOpenCascade 的 locateFile 所需要的。
  assetsInclude: ['**/*.wasm'],

  optimizeDeps: {
    // 50MB 的 wasm 加上 Emscripten 胶水代码，不适合走 esbuild 预打包
    exclude: ['opencascade.js']
  },

  server: {
    port: 3000,
    host: '0.0.0.0'
  },

  build: {
    outDir: 'dist',
    sourcemap: true
  }
});
