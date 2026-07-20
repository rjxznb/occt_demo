/**
 * 把内嵌页面产物部署进 CAD 插件的渲染预览目录，结构对齐已有的 cartoon（2D）：
 *
 *   <app>/
 *     assets/            构建出的 JS/CSS（两个入口共享 three 等公共 chunk）
 *     index.html         入口（由 index-3d.html / index-vr.html 重命名而来）
 *     data/
 *       Drawing2.json    示例户型（渲染只需要它）
 *       templates/       配色模板（3D 预览点「应用模板」时才用）
 *
 * 部署两个 app：
 *   preview3d  ← index-3d.html （页面二·3D 预览）
 *   preview-vr ← index-vr.html （页面三·VR 看房）
 *
 * 刻意不拷 data/parsed_dxf（2D 软装几何，3D/VR 用 footprint 占位盒，不 fetch）
 * 和 mx_250804 等未引用资源，保持 app 目录精简。
 *
 * 每个 app 同时铺到两处（和 cartoon 一样两边各一份）：
 *   1. build_resource —— 插件源码树（随仓库分发/提交）
 *   2. ke_arx_cache   —— WebView2 运行时实际加载的缓存目录（不存在则跳过）
 *
 * 用法：npm run deploy:3d（会先 build:3d 再跑本脚本）
 */
import { existsSync, rmSync, mkdirSync, cpSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', 'dist-3d');

// 目标 renderer 根目录（其下再放 preview3d / preview-vr）
const RENDERER_DIRS = [
    'F:\\cad_plugin\\build_resource\\pluginresource\\html\\renderer',
    'C:\\Users\\User\\AppData\\Local\\ke_arx_cache\\2021\\PluginResource\\html\\renderer',
];

// 每个内嵌 app：产物入口 → 部署文件夹
const APPS = [
    { entry: 'index-3d.html', folder: 'preview3d' },
    { entry: 'index-vr.html', folder: 'preview-vr' },
];

for (const app of APPS) {
    if (!existsSync(join(SRC, app.entry))) {
        console.error(`找不到构建产物：${SRC}\\${app.entry}。请先 npm run build:3d`);
        process.exit(1);
    }
}

/** 把一个 app 铺到 <rendererDir>/<folder>（清空重建，避免残留旧文件） */
function deployApp(rendererDir, app) {
    const dest = join(rendererDir, app.folder);
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(join(dest, 'data'), { recursive: true });
    cpSync(join(SRC, 'assets'), join(dest, 'assets'), { recursive: true });      // 构建资源
    copyFileSync(join(SRC, app.entry), join(dest, 'index.html'));                 // 入口重命名
    copyFileSync(join(SRC, 'data', 'Drawing2.json'), join(dest, 'data', 'Drawing2.json'));
    cpSync(join(SRC, 'data', 'templates'), join(dest, 'data', 'templates'), { recursive: true });
}

for (const rendererDir of RENDERER_DIRS) {
    if (!existsSync(rendererDir)) {
        console.log('跳过（renderer 目录不存在）:', rendererDir);
        continue;
    }
    for (const app of APPS) {
        deployApp(rendererDir, app);
        console.log('已部署:', join(rendererDir, app.folder));
    }
}
console.log('每个 app 结构: assets/ + index.html + data/{Drawing2.json, templates/}');
