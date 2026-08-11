# 纯白模全景页面实施计划

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Each task follows test-driven development and ends with an independently reviewable commit.

**目标：** 新增独立纯白模全景页面，打开后直接进入合法相机点位，并提供点位浏览、编辑、小地图、列表、热点和本地草稿能力，同时保持现有 3D 页面行为不变。

**架构：** PanoramaApp 组合现有场景渲染能力和新的 src/panorama/ 领域模块。相机点位采用原始层、草稿层和运行层三层状态；持久化通过 Repository 接口隔离。现有 App3D 不承担新页面状态，公共解析逻辑从 CameraPresetMap 中小范围抽取并保持兼容导出。

**技术栈：** JavaScript ES Modules、Three.js、Vite、Node.js 内置测试运行器、浏览器 LocalStorage。

**工作目录：** D:\occt_demo\.worktrees\panorama-white-model-page

**禁止范围：** 不修改 cad_plugin；不接入 AI 生图；不实现服务端离线光追任务。

---

## Task 1：建立全景点位领域模型与首屏选择规则

**Files:**

- Create: src/panorama/PanoramaPointModel.js
- Create: src/panorama/PanoramaDocumentContext.js
- Modify: src/components/CameraPresetMap.js
- Create: tests/panorama-point-model.test.js
- Create: tests/panorama-document-context.test.js
- Modify: tests/camera-preset-map.test.js

### Step 1：先写失败测试

覆盖以下行为：

- CAD camera_list 被规范化为带稳定 id、位置、高度、朝向、FOV、房间信息的点位。
- 已有 TypeId 过滤、Rotation 优先级和 FOV 限制保持不变。
- 点位通过多边形包含关系匹配房间名称。
- 首屏选择顺序为：合法初始点、合法上次访问点、第一个合法点。
- 显式 planId/version 优先；缺失时生成确定性数据指纹。

核心断言示例：

~~~js
const points = normalizePanoramaPoints(cameraList, {
  roomPoints: [room],
  roomNames: ['主卧'],
});
assert.equal(points[0].roomName, '主卧');
assert.equal(selectInitialPanoramaPoint(points, {
  initialPointId: points[1].id,
  lastActivePointId: points[0].id,
}).id, points[1].id);
~~~

### Step 2：运行测试并确认失败

~~~powershell
node --test tests/panorama-point-model.test.js tests/panorama-document-context.test.js
~~~

Expected: FAIL，模块尚不存在。

### Step 3：实现最小领域模型

实现 normalizePanoramaPoints、selectInitialPanoramaPoint、稳定原始点 ID 与新建点 ID、房间关联，以及 resolvePanoramaDocumentContext 和确定性指纹。CameraPresetMap 从新模块导入并重新导出原有 normalizeCameraPresets，保证旧调用方兼容。

### Step 4：运行聚焦测试

~~~powershell
node --test tests/panorama-point-model.test.js tests/panorama-document-context.test.js tests/camera-preset-map.test.js
~~~

Expected: PASS。

### Step 5：提交

~~~powershell
git add src/panorama/PanoramaPointModel.js src/panorama/PanoramaDocumentContext.js src/components/CameraPresetMap.js tests/panorama-point-model.test.js tests/panorama-document-context.test.js tests/camera-preset-map.test.js
git commit -m "feat: add panorama point domain model"
~~~

---

## Task 2：实现本地 Repository 与草稿损坏恢复

**Files:**

- Create: src/panorama/PanoramaPointRepository.js
- Create: tests/panorama-point-repository.test.js

### Step 1：先写失败测试

使用内存 Storage 替身覆盖：

- 存储键包含 schema、planId 和 version。
- save/load/clear 往返一致。
- 不同方案和版本互不污染。
- 非法 JSON 或 schema 不兼容时备份原值并返回空草稿。
- Storage 抛错时返回结构化错误，不让页面无响应。

### Step 2：运行测试并确认失败

~~~powershell
node --test tests/panorama-point-repository.test.js
~~~

Expected: FAIL。

### Step 3：实现 Repository

导出 PanoramaPointRepository 接口约定、LocalPanoramaPointRepository 和 PANORAMA_DRAFT_SCHEMA_VERSION。Storage、时钟和日志器必须可注入，保证 Node 测试不依赖真实浏览器。草稿不能保存 Three.js 对象或 DOM 引用。

### Step 4：运行测试

~~~powershell
node --test tests/panorama-point-repository.test.js
~~~

Expected: PASS。

### Step 5：提交

~~~powershell
git add src/panorama/PanoramaPointRepository.js tests/panorama-point-repository.test.js
git commit -m "feat: persist panorama point drafts locally"
~~~

---

## Task 3：实现三层点位 Store 与可撤销草稿操作

**Files:**

- Create: src/panorama/PanoramaPointStore.js
- Create: tests/panorama-point-store.test.js

### Step 1：先写失败测试

覆盖：

- 原始点位只读，草稿覆盖后生成可渲染点位集合。
- 新增、重命名、删除、位置、高度和初始点修改。
- 删除初始点后自动选择下一个合法点。
- 恢复单点与恢复全部。
- 当前点与每个点的 yaw、pitch、FOV 独立记录。
- subscribe 只在状态真实变化时通知。
- 草稿写入 Repository，刷新后可恢复。

### Step 2：运行测试并确认失败

~~~powershell
node --test tests/panorama-point-store.test.js
~~~

Expected: FAIL。

### Step 3：实现 Store

公开方法至少包括：

~~~js
initialize({ originalPoints, draft, context })
selectPoint(id)
addPoint(input)
renamePoint(id, name)
updatePoint(id, patch)
deletePoint(id)
setInitialPoint(id)
restorePoint(id)
restoreAll()
updateView(id, { yaw, pitch, fov })
getState()
subscribe(listener)
~~~

所有返回状态使用不可变快照，组件不能直接修改内部数组。

### Step 4：运行测试

~~~powershell
node --test tests/panorama-point-store.test.js tests/panorama-point-repository.test.js
~~~

Expected: PASS。

### Step 5：提交

~~~powershell
git add src/panorama/PanoramaPointStore.js tests/panorama-point-store.test.js
git commit -m "feat: manage panorama point draft state"
~~~

---

## Task 4：实现点位合法性与移动边界校验

**Files:**

- Create: src/panorama/PanoramaPointValidator.js
- Create: tests/panorama-point-validator.test.js

### Step 1：先写失败测试

覆盖：

- 点位必须位于某个房间多边形内部。
- 点位距离墙线小于安全距离时非法。
- 位于固定障碍二维包围盒内时非法。
- 合法移动返回房间索引和名称。
- 非法移动返回稳定错误码 OUTSIDE_ROOM、TOO_CLOSE_TO_WALL、BLOCKED。
- 边界、凹多边形和相邻房间行为确定。

### Step 2：运行测试并确认失败

~~~powershell
node --test tests/panorama-point-validator.test.js
~~~

Expected: FAIL。

### Step 3：实现纯函数校验器

实现射线法点包含、点到线段距离和障碍包围盒判断。安全距离、相机半径和容差作为参数传入，不能在 UI 中散落魔法数字。

一期障碍物数据从已渲染场景中带 userData 的固定模型包围盒生成；如果障碍数据尚未加载，至少执行房间与墙边界校验并记录降级状态。

### Step 4：运行测试

~~~powershell
node --test tests/panorama-point-validator.test.js
~~~

Expected: PASS。

### Step 5：提交

~~~powershell
git add src/panorama/PanoramaPointValidator.js tests/panorama-point-validator.test.js
git commit -m "feat: validate panorama point movement"
~~~

---

## Task 5：实现浏览/编辑状态机和输入策略

**Files:**

- Create: src/panorama/PanoramaEditController.js
- Create: src/panorama/PanoramaInputPolicy.js
- Create: tests/panorama-edit-controller.test.js
- Create: tests/panorama-input-policy.test.js

### Step 1：先写失败测试

覆盖：

- 浏览模式忽略 WASD 和方向键的位置编辑意图。
- 编辑模式按固定低速步长移动，并支持按键持续移动。
- 进入编辑保存位置、高度、朝向和 FOV 快照。
- 保存写入 Store；取消完整恢复快照。
- 儿童、标准、加高三个高度预设和微调范围。
- 非法移动不会写入 Store，并返回可展示提示。

### Step 2：运行测试并确认失败

~~~powershell
node --test tests/panorama-edit-controller.test.js tests/panorama-input-policy.test.js
~~~

Expected: FAIL。

### Step 3：实现状态机

只让 PanoramaEditController 决定位置是否变化。DOM 键盘事件先由 PanoramaInputPolicy 归一化为领域命令，再交给控制器。

持续移动使用渲染帧 delta 计算，不依赖系统键盘重复频率；窗口失焦和退出编辑必须清空按键状态。

### Step 4：运行测试

~~~powershell
node --test tests/panorama-edit-controller.test.js tests/panorama-input-policy.test.js tests/panorama-point-store.test.js
~~~

Expected: PASS。

### Step 5：提交

~~~powershell
git add src/panorama/PanoramaEditController.js src/panorama/PanoramaInputPolicy.js tests/panorama-edit-controller.test.js tests/panorama-input-policy.test.js
git commit -m "feat: add panorama browse and edit modes"
~~~

---

## Task 6：补齐固定点位视角 API，保持原 3D 行为

**Files:**

- Modify: src/core/SceneManager.js
- Modify: tests/camera-preset-view.test.js
- Create: tests/panorama-scene-view.test.js

### Step 1：先写失败测试

覆盖：

- 可读取当前固定点位的 x、y、z、yaw、pitch、FOV。
- 更新点位位置时保持原地环视语义，不能恢复 OrbitControls。
- 切换点位前可以保存当前点独立朝向。
- 视角复位恢复该点预设朝向和 FOV。
- 浏览模式左键旋转不改变相机位置。
- 全景页面销毁后事件监听器被移除。
- 既有退出点位恢复鸟瞰相机测试继续通过。

### Step 2：运行测试并确认新增断言失败

~~~powershell
node --test tests/camera-preset-view.test.js tests/panorama-scene-view.test.js
~~~

Expected: 新 API 断言 FAIL，现有断言仍 PASS。

### Step 3：最小扩展 SceneManager

新增窄接口：

~~~js
getCameraPresetPose()
updateCameraPresetPose(point, { resetView = false })
resetCameraPresetOrientation(point)
~~~

不得把点位列表、草稿或 UI 状态放入 SceneManager。SceneManager 只处理相机与 Three.js 状态。

### Step 4：运行测试

~~~powershell
node --test tests/camera-preset-view.test.js tests/panorama-scene-view.test.js tests/outdoor-panorama.test.js tests/material-restoration-mode.test.js
~~~

Expected: PASS。

### Step 5：提交

~~~powershell
git add src/core/SceneManager.js tests/camera-preset-view.test.js tests/panorama-scene-view.test.js
git commit -m "feat: expose panorama camera pose controls"
~~~

---

## Task 7：实现小地图、点位列表和全景热点组件

**Files:**

- Create: src/panorama/PanoramaMiniMap.js
- Create: src/panorama/PanoramaPointList.js
- Create: src/panorama/PanoramaHotspots.js
- Create: tests/panorama-minimap.test.js
- Create: tests/panorama-point-list.test.js
- Create: tests/panorama-hotspots.test.js

### Step 1：先写失败测试

使用轻量 DOM 替身测试：

- 小地图当前点蓝色、其他点黄色、脏点橙色。
- 小地图选择、新建位置意图和折叠事件只通过回调上报。
- 点位列表展示名称、房间、高度、初始点和修改状态。
- 删除需要确认回调，组件不能直接删除数据。
- 热点按相机朝向区分视野内与视野外，并输出方向提示。
- 隐藏热点后不再参与点击，但仍保留 Store 状态。

### Step 2：运行测试并确认失败

~~~powershell
node --test tests/panorama-minimap.test.js tests/panorama-point-list.test.js tests/panorama-hotspots.test.js
~~~

Expected: FAIL。

### Step 3：实现无业务状态组件

组件接收状态快照并渲染，所有操作通过回调交给 PanoramaApp。共用户型布局计算可复用 calculateMiniMapLayout，但不得修改现有 3D 小地图默认行为。

热点每帧只更新位置和可见性，不重复创建 DOM；点位集合变化时才重建节点。

### Step 4：运行测试

~~~powershell
node --test tests/panorama-minimap.test.js tests/panorama-point-list.test.js tests/panorama-hotspots.test.js tests/camera-preset-map.test.js
~~~

Expected: PASS。

### Step 5：提交

~~~powershell
git add src/panorama/PanoramaMiniMap.js src/panorama/PanoramaPointList.js src/panorama/PanoramaHotspots.js tests/panorama-minimap.test.js tests/panorama-point-list.test.js tests/panorama-hotspots.test.js
git commit -m "feat: add panorama navigation components"
~~~

---

## Task 8：创建独立全景页面与可访问 UI

**Files:**

- Create: index-panorama.html
- Create: src/panorama/panorama.css
- Create: tests/panorama-page-contract.test.js

### Step 1：先写失败契约测试

读取 HTML/CSS 并断言：

- 页面包含 canvas、顶部栏、小地图、点位列表、热点层、底部控制条、加载、空状态和错误状态容器。
- 不包含资源库、材质编辑、模型创建或旧 3D 编辑快捷键。
- 浏览和编辑控件有明确 label、aria 状态和键盘焦点样式。
- Liquid Glass 有不支持 backdrop-filter 时的降级样式。
- 移动端窄屏不会遮挡主要视区。

### Step 2：运行测试并确认失败

~~~powershell
node --test tests/panorama-page-contract.test.js
~~~

Expected: FAIL。

### Step 3：实现 HTML 与 CSS

先完成静态状态和响应式布局，不在 HTML 内写业务脚本。后续“生成全景图”仅显示禁用或明确的后续阶段状态，不能伪造服务端任务。

### Step 4：运行测试

~~~powershell
node --test tests/panorama-page-contract.test.js tests/3d-viewer-liquid-glass-style.test.js
~~~

Expected: PASS，且原 3D Liquid Glass 契约继续通过。

### Step 5：提交

~~~powershell
git add index-panorama.html src/panorama/panorama.css tests/panorama-page-contract.test.js
git commit -m "feat: add standalone panorama page shell"
~~~

---

## Task 9：组装 PanoramaApp、首屏白模和点位联动

**Files:**

- Create: src/PanoramaApp.js
- Create: tests/panorama-app-startup.test.js
- Create: tests/panorama-app-state.test.js
- Modify: src/core/DataSource.js
- Modify: src/dev/SceneFixtures.js
- Modify: tests/scene-fixtures.test.js

### Step 1：先写失败测试

通过依赖注入的场景、数据源和组件替身覆盖：

- 初始化顺序为加载数据、渲染场景、关闭材质还原、选择点位、显示吊顶、进入点位。
- 初始点优先级正确，不出现鸟瞰回退。
- 没有点位时进入创建引导且不调用 setCameraPreset。
- 小地图、列表和热点选择统一流向 Store，再同步到场景。
- 切换前保存当前点 yaw、pitch、FOV。
- 编辑保存、取消、删除和恢复正确驱动 Store 与场景。
- 初始化失败显示错误状态，重试不会产生重复渲染循环或事件监听器。
- dispose 释放 Store 订阅、键盘事件、组件、RoomRenderer 和 SceneManager。

### Step 2：运行测试并确认失败

~~~powershell
node --test tests/panorama-app-startup.test.js tests/panorama-app-state.test.js
~~~

Expected: FAIL。

### Step 3：实现 PanoramaApp

实施顺序：

1. 绑定专用页面 DOM。
2. 初始化 SceneManager、RoomRenderer 和全景领域服务。
3. 使用与 3D 页面一致的数据源和 fixture 机制加载场景。
4. 生成方案上下文并加载本地草稿。
5. 强制 setMaterialRestorationEnabled(false)。
6. 选择首屏点位，显示吊顶并调用 setCameraPreset。
7. 订阅 Store，统一刷新地图、列表、热点和顶部状态。
8. 在渲染帧内处理持续移动和热点投影。
9. 实现加载、空状态、部分资源失败和致命错误 UI。

为 cameras fixture 保留稳定点位用于独立页面验证；新增 panorama-empty fixture，将 camera_list 显式设为空数组，用于验证首点创建引导。同步更新 DataSource 的 fixture 白名单，不得把测试点注入普通 Drawing2 数据。

### Step 4：运行聚焦测试

~~~powershell
node --test tests/panorama-app-startup.test.js tests/panorama-app-state.test.js tests/scene-fixtures.test.js
~~~

Expected: PASS。

### Step 5：提交

~~~powershell
git add src/PanoramaApp.js src/core/DataSource.js src/dev/SceneFixtures.js tests/panorama-app-startup.test.js tests/panorama-app-state.test.js tests/scene-fixtures.test.js
git commit -m "feat: orchestrate the white-model panorama experience"
~~~

---

## Task 10：加入构建入口并完成自动化回归

**Files:**

- Modify: vite.config.3d.js
- Modify: README.md
- Create: tests/panorama-build-contract.test.js

### Step 1：先写失败测试

断言 Vite 多入口包含 index-3d.html、index-vr.html 和 index-panorama.html，并断言 README 记录本地验证 URL、planId/version 参数、fixture=cameras 和本期边界。

### Step 2：运行测试并确认失败

~~~powershell
node --test tests/panorama-build-contract.test.js
~~~

Expected: FAIL。

### Step 3：更新构建与文档

在 vite.config.3d.js 增加 panorama 入口。README 示例：

~~~text
http://127.0.0.1:3030/index-panorama.html?fixture=cameras&planId=demo&version=1#debug
~~~

### Step 4：运行完整测试与构建

~~~powershell
npm.cmd test
npm.cmd run build:3d
~~~

Expected:

- 所有自动化测试通过，仅保留既有 CAD 环境相关 skip。
- dist-3d/index-panorama.html、dist-3d/index-3d.html 和 dist-3d/index-vr.html 均存在。
- 构建无新增 warning/error。

### Step 5：提交

~~~powershell
git add vite.config.3d.js README.md tests/panorama-build-contract.test.js
git commit -m "build: bundle the standalone panorama page"
~~~

---

## Task 11：浏览器人工验收与最终回归

**Files:**

- Modify only if a verified defect requires a focused fix and regression test.

### Step 1：启动独立前端

~~~powershell
npm.cmd run dev:3d -- --port 4179
~~~

打开：

~~~text
http://127.0.0.1:4179/index-panorama.html?fixture=cameras&planId=demo&version=1#debug
~~~

### Step 2：按验收清单验证

- 首屏直接进入白模相机点位，不短暂显示鸟瞰视角。
- 吊顶封闭，窗外景色只在全景页面出现。
- 左键原地 360° 环视，滚轮仅改变 FOV。
- 地图、列表、热点切换一致。
- 浏览模式按键不会移动点位。
- 编辑模式位置、高度、保存和取消正确。
- 越界移动被拒绝并有提示。
- 新增、删除、重命名、初始点和恢复正确。
- 刷新后草稿保留；更换 version 后不加载旧草稿。
- 使用 fixture=panorama-empty 时显示首点创建引导。
- 返回 index-3d.html 后原页面行为保持不变。

### Step 3：仅对真实缺陷执行红—绿修复

每个问题先添加能够复现的测试，再做最小代码修改。不要在人工验收阶段顺手重构无关模块。

### Step 4：最终验证

~~~powershell
npm.cmd test
npm.cmd run build:3d
git diff --check
git status -sb
~~~

Expected: 测试和构建通过，工作区只包含计划内变更或完全干净。

### Step 5：提交验收修复（如有）

~~~powershell
git add <verified-files>
git commit -m "fix: address panorama page acceptance findings"
~~~

如果没有缺陷修复，则不创建空提交。

---

## 实施完成定义

- 独立全景页面满足设计文档第 10.4 节全部验收标准。
- 原 3D、VR 和全景入口均可构建。
- 所有新增领域逻辑均有自动化测试。
- npm.cmd test 与 npm.cmd run build:3d 通过。
- 未修改任何 CAD Plugin 文件。
- 未加入 AI 生图或服务端离线光追占位业务逻辑。
