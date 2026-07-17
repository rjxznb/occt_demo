/**
 * 把 3D 预览产物部署进 CAD 插件的渲染预览目录，结构对齐已有的 cartoon（2D）：
 *
 *   preview3d/
 *     assets/            构建出的 JS/CSS
 *     index.html         入口（由 index-3d.html 重命名而来，与 cartoon/index.html 同名约定）
 *     data/
 *       Drawing2.json    示例户型（3D 渲染只需要它）
 *       templates/       配色模板（点「应用模板」时才用）
 *
 * 刻意不拷 data/parsed_dxf——那是 2D 软装几何，3D 用 footprint 占位盒，不会去 fetch。
 * 也不拷 mx_250804 等未被引用的资源，保持 app 目录精简（cartoon 目录也只有 assets+index.html）。
 *
 * 同时部署到两个位置（和 cartoon 一样两边都有一份）：
 *   1. build_resource —— 插件源码树（随仓库分发/提交）
 *   2. ke_arx_cache   —— WebView2 运行时实际加载的缓存目录（不存在则跳过）
 *
 * 用法：npm run deploy:3d（会先 build:3d 再跑本脚本）
 *   覆盖目标：环境变量 PLUGIN_PREVIEW3D_DIR（源）、CACHE_PREVIEW3D_DIR（运行时缓存）。
 */
import { existsSync, rmSync, mkdirSync, cpSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', 'dist-3d');

const DESTS = [
    process.env.PLUGIN_PREVIEW3D_DIR ||
        'F:\\cad_plugin\\build_resource\\pluginresource\\html\\renderer\\preview3d',
    process.env.CACHE_PREVIEW3D_DIR ||
        'C:\\Users\\User\\AppData\\Local\\ke_arx_cache\\2021\\PluginResource\\html\\renderer\\preview3d',
];

if (!existsSync(join(SRC, 'index-3d.html'))) {
    console.error(`找不到构建产物：${SRC}\\index-3d.html。请先 npm run build:3d`);
    process.exit(1);
}

/** 把精简后的 3D 应用铺到一个目标目录（清空重建，避免残留旧文件） */
function deployTo(dest) {
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(join(dest, 'data'), { recursive: true });
    cpSync(join(SRC, 'assets'), join(dest, 'assets'), { recursive: true });           // 构建资源
    copyFileSync(join(SRC, 'index-3d.html'), join(dest, 'index.html'));               // 入口重命名
    copyFileSync(join(SRC, 'data', 'Drawing2.json'), join(dest, 'data', 'Drawing2.json'));
    cpSync(join(SRC, 'data', 'templates'), join(dest, 'data', 'templates'), { recursive: true });
}

for (const dest of DESTS) {
    // 缓存目录只在其父目录（renderer）存在时才部署——没装插件的机器直接跳过
    const parent = dirname(dest);
    if (!existsSync(parent)) {
        console.log('跳过（目标父目录不存在）:', dest);
        continue;
    }
    deployTo(dest);
    console.log('已部署:', dest);
}
console.log('结构: assets/ + index.html + data/{Drawing2.json, templates/}');
