import { defineConfig } from 'vite';
import { resolve } from 'path';

/**
 * 3D 预览的独立构建配置。
 *
 * 产物要作为 CAD 插件渲染预览「页面二」的 iframe 页面（WebView2）加载，
 * 因此：
 * - base:'./' —— 资源用相对路径，才能在 iframe 的任意子目录下正确加载；
 * - 入口是 index-3d.html（→ src/App3D.js），只含 3D，不打包 2D 代码；
 * - 输出到 dist-3d，与完整版 dist 分开。
 *
 * public/ 下的 data 等资源会被 Vite 原样拷到产物根目录（同样以相对路径引用）。
 */
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist-3d',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: resolve(__dirname, 'index-3d.html'),
    },
  },
});
