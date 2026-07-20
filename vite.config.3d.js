import { defineConfig } from 'vite';
import { resolve } from 'path';

/**
 * CAD 插件渲染预览的内嵌页面构建配置（页面二 3D 预览、页面三 VR 看房）。
 *
 * - base:'./' —— 资源用相对路径，才能在 iframe 的任意子目录下正确加载；
 * - 两个入口 index-3d.html / index-vr.html 一起构建，共享 three 等公共 chunk；
 * - 只含 3D/VR，不打包 2D 代码；输出到 dist-3d，与完整版 dist 分开。
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
      input: {
        preview: resolve(__dirname, 'index-3d.html'),
        vr: resolve(__dirname, 'index-vr.html'),
      },
    },
  },
});
