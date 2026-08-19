import { defineConfig } from 'vite';
import { resolve } from 'path';

/**
 * CAD 插件渲染预览的内嵌页面构建配置（3D 预览、全景看房、局部示意图）。
 *
 * - base:'./' —— 资源用相对路径，才能在 iframe 的任意子目录下正确加载；
 * - 只构建三个实际嵌入 CAD 的页面，共享 three 等公共 chunk；
 * - 不打包 2D 或 VR 页面；输出到 dist-3d，与完整版 dist 分开。
 *
 * public/ 下的 data 等资源会被 Vite 原样拷到产物根目录（同样以相对路径引用）。
 */
export default defineConfig({
  base: './',
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
  build: {
    outDir: 'dist-3d',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        preview: resolve(__dirname, 'index-3d.html'),
        panorama: resolve(__dirname, 'index-panorama.html'),
        aiConcept: resolve(__dirname, 'index-ai-concept.html'),
      },
    },
  },
});
