# CAD 渲染预览四页面迁移设计

## 1. 目标

在 `occt_demo` 当前 AI 局部示意图任务完整收尾并通过验证后，把最新 Web 产物迁移到 `cad_plugin` 的渲染预览窗口。

迁移后的渲染预览包含四个页面：

1. 现有二维页面：保持现状，不修改页面、页签、入口、资源或交互。
2. `3D 鸟瞰图`：使用 `occt_demo` 最新 `index-3d.html` 构建结果，保留现有默认相机和交互。
3. `全景看房`：替换原 `VR 看房`，使用最新 `index-panorama.html`。
4. `局部示意图`：新增页面，使用最新 `index-ai-concept.html`，承载原 AI 生图能力。

## 2. 项目边界

- `occt_demo` 是 Web 功能的唯一开发源。
- `cad_plugin` 只接收验证通过的构建产物和最小页签配置修改。
- 不修改二维页面目录 `renderer/cartoon/` 及其现有页签配置。
- 不修改 CAD 原生窗口入口、C++ Bridge 方法或 WebView 生命周期协议，除非迁移验证证明现有协议无法满足页面运行。
- 不在 `cad_plugin` 创建 Git 提交，不暂存、不推送。
- 不新增部署脚本；迁移时使用可审计的构建、复制和文件校验步骤。
- 不把 OpenAI API Key 写入浏览器产物、CAD 源码、日志或版本库。

## 3. 页面与目录映射

| CAD 页签 | CAD 目录 | `occt_demo` 构建入口 | 处理方式 |
| --- | --- | --- | --- |
| 现有二维页签 | `cartoon/` | 不适用 | 完全不动 |
| 3D 鸟瞰图 | `preview3d/` | `index-3d.html` | 更新产物并修改页签显示名称 |
| 全景看房 | `preview-panorama/` | `index-panorama.html` | 新建目录并替换原 VR 页签 |
| 局部示意图 | `preview-ai-concept/` | `index-ai-concept.html` | 新建目录并新增第四页签 |

原 `preview-vr/` 在迁移第一阶段保留但不再被页签入口引用，作为本地回退副本。四页签验证完成后再决定是否清理，不在本次迁移中主动删除。

每个新 Web 目录保持独立、可直接由 iframe 加载的结构：

```text
<page-folder>/
  index.html
  assets/
  data/
```

构建入口在复制时重命名为目标目录的 `index.html`。所需公共资源随对应页面一起复制，避免依赖 CAD 外部开发服务器。

## 4. 页签与生命周期

`render_preview.js` 的页签顺序保持“现有二维页签在第一位”，只调整后三项：

```text
现有二维页签 → 3D 鸟瞰图 → 全景看房 → 局部示意图
```

三个 Web 页面继续复用已有 iframe 懒加载机制：首次激活时创建，切换时发送 `activate` / `deactivate`，并接收统一的方案上下文。

页签只负责页面装载和生命周期转发。3D、全景和局部示意图内部状态继续由各自页面管理，避免把业务状态复制到 CAD 外层容器。

## 5. 当前 AI 任务的收尾条件

迁移前必须完成现有 AI 生图计划的剩余工作：

- 前端同源任务客户端；
- 任务轮询、取消与失败单项重试；
- 生成进度页；
- 白模输入与局部示意图结果对比；
- 页面刷新后恢复当前任务；
- 离线端到端测试；
- 可选的真实 `gpt-image-2` 单图冒烟测试说明。

没有真实 API Key 时，不伪造成功结果；离线测试使用受控的假图像客户端验证完整状态流。

## 6. CAD 中的 AI 请求边界

静态 Web 产物可以直接嵌入 CAD，但 `index-ai-concept.html` 的真实生图请求仍需要受信任宿主保护 API Key。

本次迁移先保证页面、白模视角、条件弹窗和任务 UI 能在 CAD WebView 中加载。真实 OpenAI 请求采用现有同源 API 契约 `/api/ai-concept/*`；不把密钥下放到 WebView。若 CAD 环境没有同源 Node 服务，则后续应由 C++ Bridge 实现同等固定业务接口并在宿主侧持有密钥，这属于独立的原生桥接阶段，不在本次静态页面迁移中暗中扩展。

## 7. 脏工作区保护

`cad_plugin` 当前存在未提交修改和未跟踪构建资源。迁移时：

- 先记录目标文件清单和 Git 状态；
- 只写入 `preview3d/`、新建的 `preview-panorama/`、`preview-ai-concept/`，以及 `render_preview.js` 的后三个页签配置；
- 不覆盖 C++、工程文件或二维资源；
- 不使用 Git reset、checkout 或批量清理；
- 复制后再次检查 Git diff，确认没有越界文件。

## 8. 运行缓存

CAD WebView 实际读取：

```text
C:\Users\User\AppData\Local\ke_arx_cache\2021\PluginResource\html\renderer
```

验证前将与源码树相同的四页签配置及三个 Web 页面产物同步到该缓存。复制前解析并核对绝对目标路径，避免误写其他 AutoCAD 版本或工作区。

## 9. 验收

### `occt_demo`

- 完整 Node 测试套件通过；
- `npm.cmd run build:3d` 成功；
- `dist-3d` 包含 3D、全景和局部示意图入口及其资源；
- 页面不包含 API Key 或伪造成功状态。

### `cad_plugin`

- 原二维页签与页面没有内容变化；
- 页签顺序正确，显示 `3D 鸟瞰图`、`全景看房`、`局部示意图`；
- 3D 鸟瞰图保留当前相机和交互；
- 全景页进入白模预设点位流程，不再加载旧 VR 页面；
- 局部示意图可加载全部房间视角、缩略图、小地图和生图条件 UI；
- 切换页签不会重复创建失控 iframe，激活/停用消息正常；
- CAD 源码树与运行缓存加载同一版产物；
- CAD 仓库没有新增提交。

## 10. 回退

若 CAD 验证失败，只回退 `render_preview.js` 的后三项页签配置，并恢复迁移前的 `preview3d/` 引用。由于原 `preview-vr/` 在本阶段保留，旧 VR 页面仍可重新引用。二维页面无需回退，因为从未修改。
