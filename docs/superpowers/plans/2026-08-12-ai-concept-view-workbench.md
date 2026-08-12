# AI 方向示意图候选视角工作台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增独立的 AI 方向示意图候选视角页面，基于真实户型白模稳定生成各房间候选视角，并支持浏览、多选、微调、排除、恢复、自定义点位和进入真实生图条件阶段。

**Architecture:** 新入口 `index-ai-concept.html` 由 `AiConceptApp` 统一协调场景、候选生成、Store、Repository、胶片栏和编辑控制器。AI 点位使用独立数据模型和本地草稿键；只复用 SceneManager、RoomRenderer、方案上下文思想以及抽取后的共享障碍物校验能力，不读取或写入 `camera_list` 草稿。

**Tech Stack:** 原生 ES Modules、Three.js 0.178、Vite 6、Node.js `node:test`、浏览器 LocalStorage、现有 GeometryService/RoomRenderer/SceneManager。

## Global Constraints

- 只修改 `D:/occt_demo/.worktrees/panorama-white-model-page`，不得修改 CAD Plugin。
- AI 点位不得复用、覆盖或写回全景 `camera_list` 和 `occt.panorama.points` 草稿。
- 候选生成必须确定性、无随机数，相同方案与版本产生稳定 ID 和排序。
- FOV 一律采用水平视场角；默认 86 度，自动候选上限 100 度。
- 小房间最多 2 个、普通房间最多 3 个、大空间或异形房间最多 4 个；合法候选不足时不得强行补满。
- 主要房间仅默认选择最高分候选；卫生间、过道和阳台候选默认不选。
- 第一阶段不伪造 AI 任务、任务成功或生成结果。
- 新行为遵循 TDD：每个生产行为必须先有失败测试并观察预期失败。

---

## File Structure

- `index-ai-concept.html`：独立页面的可访问 DOM 结构。
- `src/AiConceptApp.js`：启动、场景生命周期、状态协调和页面事件。
- `src/ai-concept/ai-concept.css`：浅色 Liquid Glass、胶片栏、编辑光晕和响应式布局。
- `src/ai-concept/AiDocumentContext.js`：AI 草稿的方案/版本上下文与稳定指纹。
- `src/ai-concept/AiViewModel.js`：候选规范化、稳定 ID、房间业务分类和数据克隆。
- `src/ai-concept/AiViewCandidateGenerator.js`：房间分析、站位/朝向枚举、校验、评分、去重和候选截取。
- `src/ai-concept/AiViewRepository.js`：独立 LocalStorage schema、损坏备份和版本隔离。
- `src/ai-concept/AiViewStore.js`：当前查看、参与生图选择、排除/恢复、调整和自定义点位状态。
- `src/ai-concept/AiViewFilmstrip.js`：房间筛选、缩略图、微调、垃圾桶、恢复和自定义入口。
- `src/ai-concept/AiViewEditController.js`：编辑快照、移动/视角更新、校验、保存和取消。
- `src/shared/ContentObstacleBounds.js`：从场景内容模型收集三维包围盒，供全景和 AI 页面共享。
- `tests/helpers/ai-concept-app-harness.js`：AiConceptApp 的假 DOM/场景测试夹具。
- `tests/ai-*.test.js`：各纯模块、页面契约、应用状态和构建回归测试。

---

### Task 1: 抽取共享障碍物包围盒服务

**Files:**
- Create: `src/shared/ContentObstacleBounds.js`
- Modify: `src/PanoramaApp.js`
- Test: `tests/content-obstacle-bounds.test.js`
- Test: `tests/panorama-app-startup.test.js`

**Interfaces:**
- Consumes: Three.js `Box3` 和带 `userData.contentModelRoot === true` 的场景节点。
- Produces: `collectContentObstacleBounds(sceneGroup): Array<ObstacleBounds> | null`，其中 `ObstacleBounds` 包含 `id/minX/minY/minZ/maxX/maxY/maxZ`。

- [ ] **Step 1: 写共享服务失败测试**

```js
test('collects only content model roots with three-dimensional bounds', () => {
    const root = new THREE.Group();
    const content = new THREE.Mesh(new THREE.BoxGeometry(100, 200, 300));
    content.userData = { contentModelRoot: true, instanceId: 'chair-1' };
    content.position.set(500, 600, 150);
    root.add(content, new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10)));

    assert.deepEqual(collectContentObstacleBounds(root), [{
        id: 'chair-1', minX: 450, minY: 500, minZ: 0,
        maxX: 550, maxY: 700, maxZ: 300,
    }]);
});
```

- [ ] **Step 2: 运行测试并确认因模块缺失而失败**

Run: `node --test tests/content-obstacle-bounds.test.js`

Expected: FAIL，提示无法导入 `src/shared/ContentObstacleBounds.js`。

- [ ] **Step 3: 实现共享服务并替换 PanoramaApp 内部定义**

```js
// src/shared/ContentObstacleBounds.js
import * as THREE from 'three';

export function collectContentObstacleBounds(sceneGroup) {
    if (!sceneGroup?.traverse) return null;
    const obstacles = [];
    sceneGroup.updateMatrixWorld?.(true);
    sceneGroup.traverse(object => {
        if (object?.userData?.contentModelRoot !== true) return;
        const box = new THREE.Box3().setFromObject(object);
        if (box.isEmpty()) return;
        obstacles.push({
            id: String(object.userData.instanceId ?? object.userData.sourceIndex ?? object.uuid ?? obstacles.length),
            minX: box.min.x, minY: box.min.y, minZ: box.min.z,
            maxX: box.max.x, maxY: box.max.y, maxZ: box.max.z,
        });
    });
    return obstacles;
}
```

删除 `PanoramaApp.js` 中原函数实现，改为从共享模块导入并继续具名导出，保持现有调用兼容。

- [ ] **Step 4: 运行共享服务和全景启动回归测试**

Run: `node --test tests/content-obstacle-bounds.test.js tests/panorama-app-startup.test.js`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/shared/ContentObstacleBounds.js src/PanoramaApp.js tests/content-obstacle-bounds.test.js
git commit -m "refactor: share content obstacle bounds"
```

---

### Task 2: 建立 AI 点位模型、文档上下文和独立 Repository

**Files:**
- Create: `src/ai-concept/AiViewModel.js`
- Create: `src/ai-concept/AiDocumentContext.js`
- Create: `src/ai-concept/AiViewRepository.js`
- Test: `tests/ai-view-model.test.js`
- Test: `tests/ai-document-context.test.js`
- Test: `tests/ai-view-repository.test.js`

**Interfaces:**
- Produces: `createAiViewId({ planId, version, roomId, rule, x, y, z, yaw }): string`。
- Produces: `normalizeAiView(candidate, context): AiView`。
- Produces: `classifyAiRoom(roomName): 'primary' | 'secondary'`。
- Produces: `resolveAiDocumentContext(options): { planId, version, planIdSource, versionSource }`。
- Produces: `LocalAiViewRepository.load/save/clear(planId, version)`，存储前缀 `occt.ai-concept.views.v1`。

- [ ] **Step 1: 写模型稳定性和房间分类失败测试**

```js
test('candidate ids are stable after coordinate normalization', () => {
    const base = { planId: 'p', version: '1', roomId: 'r0', rule: 'entrance', z: 1500, yaw: 90 };
    assert.equal(
        createAiViewId({ ...base, x: 1000.004, y: 999.996 }),
        createAiViewId({ ...base, x: 1000, y: 1000 }),
    );
});

test('bathrooms corridors and balconies are secondary rooms', () => {
    for (const name of ['卫生间', '过道', '阳台']) assert.equal(classifyAiRoom(name), 'secondary');
    assert.equal(classifyAiRoom('主卧'), 'primary');
});
```

- [ ] **Step 2: 运行模型测试并确认预期失败**

Run: `node --test tests/ai-view-model.test.js`

Expected: FAIL，模块尚不存在。

- [ ] **Step 3: 最小实现稳定哈希、规范化和分类**

`normalizeAiView()` 固定输出设计稿第 7 节字段，将非有限数值拒绝或回退，FOV clamp 到 `[55, 100]`，`source/status/selected` 使用允许枚举。

- [ ] **Step 4: 写上下文与独立存储失败测试**

```js
test('ai context fingerprints rooms and content without camera_list', () => {
    const a = resolveAiDocumentContext({ roomPoints, contentModels: [], cameraList: [{ id: 1 }] });
    const b = resolveAiDocumentContext({ roomPoints, contentModels: [], cameraList: [{ id: 2 }] });
    assert.equal(a.version, b.version);
});

test('AI draft key never uses panorama storage prefix', async () => {
    const repo = new LocalAiViewRepository({ storage });
    await repo.save('plan', 'v1', { views: [] });
    assert.match([...storage.keys()][0], /^occt\.ai-concept\.views\.v1:/);
    assert.doesNotMatch([...storage.keys()][0], /panorama/);
});
```

- [ ] **Step 5: 运行上下文和 Repository 测试并确认预期失败**

Run: `node --test tests/ai-document-context.test.js tests/ai-view-repository.test.js`

Expected: FAIL，两个模块尚不存在。

- [ ] **Step 6: 实现上下文、版本隔离、损坏草稿备份**

`resolveAiDocumentContext()` 接受 `search/dataSourceId/dataSourceName/roomPoints/roomNames/contentModels`，query 中 `planId/version` 优先；无 query version 时对房间和内容稳定序列化后生成 `drawing-<hash>`。Repository envelope 保存 `schemaVersion/planId/version/savedAt/draft`，解析失败时备份到 `:corrupted:<timestamp>` 并删除活动键。

- [ ] **Step 7: 运行三组测试**

Run: `node --test tests/ai-view-model.test.js tests/ai-document-context.test.js tests/ai-view-repository.test.js`

Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add src/ai-concept/AiViewModel.js src/ai-concept/AiDocumentContext.js src/ai-concept/AiViewRepository.js tests/ai-view-model.test.js tests/ai-document-context.test.js tests/ai-view-repository.test.js
git commit -m "feat: add AI view draft foundation"
```

---

### Task 3: 实现确定性的候选视角生成器

**Files:**
- Create: `src/ai-concept/AiViewCandidateGenerator.js`
- Test: `tests/ai-view-candidate-generator.test.js`

**Interfaces:**
- Consumes: `generateAiViewCandidates({ context, rooms, doorWindows, obstacles, validator? })`。
- Produces: `{ candidates: AiView[], roomResults: Array<{ roomIndex, roomName, status, reason, degraded }> }`。
- Uses: `validatePanoramaPoint(point, options)` 作为默认合法性检查。

- [ ] **Step 1: 写矩形房候选数量、稳定性和默认选择失败测试**

```js
test('generates stable candidates and selects only the best primary-room view', () => {
    const input = fixtureForRectangularRoom({ width: 4200, depth: 3200, name: '客厅' });
    const first = generateAiViewCandidates(input);
    const second = generateAiViewCandidates(input);
    assert.deepEqual(first, second);
    assert.equal(first.candidates.length, 3);
    assert.equal(first.candidates.filter(item => item.selected).length, 1);
    assert.equal(first.candidates[0].selected, true);
});
```

- [ ] **Step 2: 运行并确认生成器模块缺失失败**

Run: `node --test tests/ai-view-candidate-generator.test.js`

Expected: FAIL，无法导入生成器。

- [ ] **Step 3: 实现房间分析、基础站位和确定性排序**

实现纯函数：

```js
analyzeRoom(polygon, roomInfo)
enumerateStations(analysis)
enumerateOrientations(station, analysis)
scoreCandidate(candidate, analysis)
dedupeCandidates(candidates, { positionThreshold: 350, yawThreshold: 20 })
roomCandidateLimit(analysis) // 2 | 3 | 4
```

站位依次来自入口内侧、最长墙对侧、内缩角点、质心附近；没有门信息时入口规则自然跳过。排序键依次为 `score desc/rule priority/y/x/yaw`，禁止使用随机数。

- [ ] **Step 4: 运行基础测试并确认通过**

Run: `node --test tests/ai-view-candidate-generator.test.js`

Expected: PASS 当前矩形房测试。

- [ ] **Step 5: 写凹形、墙距、三维障碍物和降级失败测试**

```js
test('rejects concave-room stations outside the polygon', () => {
    const result = generateAiViewCandidates(fixtureForConcaveRoom());
    assert.ok(result.candidates.every(view => pointInPolygon(view.x, view.y, CONCAVE_ROOM)));
});

test('keeps a camera above furniture when vertical bounds do not overlap', () => {
    const result = generateAiViewCandidates(fixtureWithLowFurniture({ cameraZ: 1800, maxZ: 700 }));
    assert.ok(result.candidates.some(view => view.valid));
});

test('marks generation degraded when obstacle data is unavailable', () => {
    const result = generateAiViewCandidates({ ...fixtureForRectangularRoom(), obstacles: null });
    assert.ok(result.roomResults.every(room => room.degraded));
});
```

- [ ] **Step 6: 实现完整校验、去重、次要空间默认不选和失败原因**

为每个站位调用默认或注入 validator，传入 `minWallDistance: 80/cameraRadius: 80`。只保留合法点；次要空间所有 `selected=false`。房间无候选时输出 `status: 'empty'` 与最后一组稳定失败原因；缺障碍物时候选 `validationMode: 'degraded'`。

- [ ] **Step 7: 运行生成器完整测试**

Run: `node --test tests/ai-view-candidate-generator.test.js`

Expected: PASS，覆盖矩形、凹形、窄长、大小房间、Z 相交、去重、降级和稳定 ID。

- [ ] **Step 8: 提交**

```bash
git add src/ai-concept/AiViewCandidateGenerator.js tests/ai-view-candidate-generator.test.js
git commit -m "feat: generate deterministic AI room views"
```

---

### Task 4: 实现 AI View Store 的选择、排除和版本草稿语义

**Files:**
- Create: `src/ai-concept/AiViewStore.js`
- Test: `tests/ai-view-store.test.js`

**Interfaces:**
- Produces: `new AiViewStore({ repository })`。
- Produces: `initialize({ generatedViews, roomResults, context })`、`getState()`、`subscribe(listener)`。
- Produces: `setActiveView(id)`、`toggleSelected(id)`、`excludeView(id)`、`restoreExcluded()`、`addCustomView(view)`、`deleteCustomView(id)`、`updateView(id, patch)`、`disableView(id)`、`setRoomFilter(roomId)`、`setPhase(phase)`。

- [ ] **Step 1: 写初始化与选择分离失败测试**

```js
test('active view changes without changing generation selection', async () => {
    const store = new AiViewStore({ repository: null });
    await store.initialize({ generatedViews: [selected, unselected], roomResults: [], context });
    await store.setActiveView(unselected.id);
    const state = store.getState();
    assert.equal(state.activeViewId, unselected.id);
    assert.deepEqual(state.views.filter(v => v.selected).map(v => v.id), [selected.id]);
});
```

- [ ] **Step 2: 运行并确认 Store 缺失失败**

Run: `node --test tests/ai-view-store.test.js`

Expected: FAIL。

- [ ] **Step 3: 实现初始化、不可变快照、订阅与原子持久化**

Store 状态固定为：

```js
{
  phase, context, views, roomResults,
  activeViewId, activeRoomId, editingViewId,
  draftRecovered, persistenceError
}
```

Repository 为 null 时只更新内存；有 Repository 时每个成功变更保存 `views/roomResults/activeViewId/activeRoomId`。

- [ ] **Step 4: 写排除/恢复、自定义删除和关联任务保护失败测试**

```js
test('auto views are excluded and restorable while custom views are deleted', async () => {
    await store.excludeView(auto.id);
    assert.equal(find(auto.id).status, 'excluded');
    await store.restoreExcluded();
    assert.equal(find(auto.id).status, 'available');
    await store.deleteCustomView(custom.id);
    assert.equal(find(custom.id), undefined);
});

test('views linked to work are disabled instead of deleted', async () => {
    const linked = { ...custom, id: 'custom-linked', taskIds: ['task-1'] };
    await store.addCustomView(linked);
    await store.deleteCustomView(linked.id);
    assert.equal(find(linked.id).status, 'disabled');
});
```

- [ ] **Step 5: 实现业务动作和约束**

自动点垃圾桶只设置 `excluded`；custom 且无 `taskIds/resultIds` 才真正删除；有关联数据则 `disabled`。非法、excluded、disabled 视角不得选中；至少一个合法 `selected=true` 时派生 `canContinue=true`。

- [ ] **Step 6: 运行 Store 测试**

Run: `node --test tests/ai-view-store.test.js`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add src/ai-concept/AiViewStore.js tests/ai-view-store.test.js
git commit -m "feat: manage AI view candidate state"
```

---

### Task 5: 实现胶片栏和编辑控制器

**Files:**
- Create: `src/ai-concept/AiViewFilmstrip.js`
- Create: `src/ai-concept/AiViewEditController.js`
- Test: `tests/ai-view-filmstrip.test.js`
- Test: `tests/ai-view-edit-controller.test.js`

**Interfaces:**
- Produces: `new AiViewFilmstrip(container, { documentRef, onActivate, onToggleSelected, onEdit, onDelete, onRestore, onAdd, onRoomFilter })` 与 `render(state)`。
- Produces: `new AiViewEditController({ store, validator, onPreview, movementSpeed })` 与 `enter/applyMovement/updateView/setHeightPreset/nudgeHeight/save/cancel/getState`。

- [ ] **Step 1: 写胶片栏 DOM 契约失败测试**

```js
test('filmstrip renders room labels, text edit controls, and trash buttons', () => {
    filmstrip.render({ views: [view], activeViewId: view.id, activeRoomId: view.roomId });
    assert.match(container.textContent, /客厅/);
    assert.match(container.textContent, /入口广角/);
    assert.equal(container.querySelector('[data-action="edit"]').textContent, '微调');
    assert.equal(container.querySelector('[data-action="delete"]').getAttribute('aria-label'), '删除入口广角');
    assert.doesNotMatch(container.textContent, /自动|手动/);
});
```

- [ ] **Step 2: 运行胶片栏测试并确认缺失失败**

Run: `node --test tests/ai-view-filmstrip.test.js`

Expected: FAIL。

- [ ] **Step 3: 实现胶片栏渲染和事件委托**

每张卡使用按钮表达当前查看，独立 checkbox/aria-pressed 表达参与生图；顶部只显示“微调”文字与垃圾桶 SVG。excluded 单独进入恢复区域，不与活动卡混排。切换房间只调用 `onRoomFilter`。

- [ ] **Step 4: 写编辑快照、合法移动、保存和取消失败测试**

```js
test('cancel restores the exact entry pose and save marks an automatic view adjusted', async () => {
    controller.enter(view.id, { yaw: 35, pitch: -2, fov: 86 });
    controller.applyMovement({ forward: 1 }, 0.5, { yaw: 35, pitch: -2, fov: 86 });
    controller.cancel();
    assert.deepEqual(previews.at(-1), { point: view, view: { yaw: 35, pitch: -2, fov: 86 } });

    controller.enter(view.id);
    controller.updateView({ yaw: 50 });
    await controller.save();
    assert.equal(store.getState().views[0].status, 'adjusted');
});
```

- [ ] **Step 5: 运行编辑测试并确认缺失失败**

Run: `node --test tests/ai-view-edit-controller.test.js`

Expected: FAIL。

- [ ] **Step 6: 实现 AI 编辑控制器**

沿用全景编辑器的相机局部坐标移动公式，但直接通过 Store 的 `updateView(id, patch)` 一次保存点位和视角；编辑中保存前再次 validator。非法点不更新 working point，返回具体 code；cancel 回放完整 snapshot；成功保存后 `status='adjusted'`。

- [ ] **Step 7: 运行组件测试**

Run: `node --test tests/ai-view-filmstrip.test.js tests/ai-view-edit-controller.test.js`

Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add src/ai-concept/AiViewFilmstrip.js src/ai-concept/AiViewEditController.js tests/ai-view-filmstrip.test.js tests/ai-view-edit-controller.test.js
git commit -m "feat: add AI view filmstrip and editing"
```

---

### Task 6: 建立独立页面与视觉系统

**Files:**
- Create: `index-ai-concept.html`
- Create: `src/ai-concept/ai-concept.css`
- Test: `tests/ai-concept-page-contract.test.js`

**Interfaces:**
- Produces: AiConceptApp 所需固定 ID，包括 `ai-concept-app/canvas/status/previous/next/room-filter/filmstrip/add/restore/selection-count/continue/edit-controls/loading/empty/error/toast`。

- [ ] **Step 1: 写页面 DOM 与视觉契约失败测试**

```js
test('AI concept page exposes the candidate workbench without panorama labels', async () => {
    const html = await readFile(htmlUrl, 'utf8');
    for (const id of REQUIRED_IDS) assert.match(html, new RegExp(`id=["']${id}["']`));
    assert.match(html, /src="\.\/src\/AiConceptApp\.js"/);
    assert.doesNotMatch(html, /AI方向示意图/);
    assert.doesNotMatch(html, /位置微调/); // 页面级按钮不得出现
});

test('styles include blue glass editing glow and reduced-motion fallback', async () => {
    const css = await readFile(cssUrl, 'utf8');
    assert.match(css, /backdrop-filter:\s*blur/);
    assert.match(css, /\.ai-concept-editing\s+\.ai-concept-app::after/);
    assert.match(css, /rgba\(79,\s*139,\s*188/);
    assert.match(css, /prefers-reduced-motion/);
});
```

- [ ] **Step 2: 运行并确认页面和 CSS 缺失失败**

Run: `node --test tests/ai-concept-page-contract.test.js`

Expected: FAIL。

- [ ] **Step 3: 创建 HTML 可访问结构**

中央 canvas 全屏；顶部中央状态；左右切换；底部胶片栏；右下选择计数与“下一步：生图条件”；编辑 dock 只在 editing 状态展示；loading/empty/error 使用 `aria-live`。

- [ ] **Step 4: 实现浅色蓝系 Liquid Glass 与响应式规则**

使用低饱和蓝 `#4f8bbc/#337dcc`、半透明白和柔和阴影。编辑光晕放在 `app::after`，`pointer-events:none`，四周渐变且 opacity 受 `.ai-concept-editing` 控制。窄屏胶片栏可横向滚动，操作按钮不遮挡缩略图。

- [ ] **Step 5: 运行页面契约测试**

Run: `node --test tests/ai-concept-page-contract.test.js`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add index-ai-concept.html src/ai-concept/ai-concept.css tests/ai-concept-page-contract.test.js
git commit -m "feat: add AI concept workbench page"
```

---

### Task 7: 集成 AiConceptApp 的真实白模、候选和交互状态

**Files:**
- Create: `src/AiConceptApp.js`
- Create: `tests/helpers/ai-concept-app-harness.js`
- Create: `tests/ai-concept-app-startup.test.js`
- Create: `tests/ai-concept-app-state.test.js`

**Interfaces:**
- Produces: `loadAiConceptSceneData(service): Promise<SceneData>`。
- Produces: `new AiConceptApp(dependencies)`、`init()`、`getState()`、`selectView()`、`selectRelativeView()`、`enterEditMode()`、`saveEdit()`、`cancelEdit()`、`excludeView()`、`restoreExcluded()`、`addCustomView()`、`continueToConditions()`、`dispose()`。
- Consumes: Tasks 1–6 的模块接口。

- [ ] **Step 1: 创建假 DOM/SceneManager/RoomRenderer 测试夹具并写启动失败测试**

```js
test('starts in the best primary room candidate using white model fixed view', async () => {
    const { app, calls } = createAiConceptHarness();
    assert.equal(await app.init(), true);
    assert.equal(app.getState().phase, 'ready');
    assert.ok(app.getState().views.length >= 2);
    assert.deepEqual(calls.slice(0, 4).map(call => call[0]), ['load', 'render', 'room-labels', 'white']);
    assert.ok(calls.some(call => call[0] === 'camera'));
    assert.ok(calls.some(call => call[0] === 'ceilings' && call[1] === true));
});
```

- [ ] **Step 2: 运行启动测试并确认 AiConceptApp 缺失失败**

Run: `node --test tests/ai-concept-app-startup.test.js`

Expected: FAIL。

- [ ] **Step 3: 实现依赖注入、启动与真实候选接线**

启动顺序：绑定 UI → loading → 加载 outline/rooms/doors/windows/softlists/contentModels → RoomRenderer.render → 隐藏房间 Sprite → 开启吊顶 → `setMaterialRestorationEnabled(false)` 白模 → 收集障碍物 → 解析 AI context → Repository.load/Store.initialize；无草稿才调用生成器 → 进入最高优先房间最高分候选 → SceneManager.setCameraPreset。

- [ ] **Step 4: 写浏览、选择、编辑、排除、恢复和自定义失败测试**

```js
test('view browsing keeps selection while editing blocks navigation and continue', async () => {
    await app.init();
    const before = selectedIds(app.getState());
    await app.selectRelativeView(1);
    assert.deepEqual(selectedIds(app.getState()), before);
    app.enterEditMode();
    assert.equal(await app.selectRelativeView(1), false);
    assert.equal(app.continueToConditions(), false);
    app.cancelEdit();
    assert.equal(app.getState().phase, 'ready');
});
```

- [ ] **Step 5: 实现状态协调和 UI 渲染**

Store 订阅驱动 Filmstrip 和计数；激活候选使用 `transitionCameraPreset(..., { duration: 0.55 })`；编辑时 classList 添加 `ai-concept-editing`，输入策略只允许低速 WASD/高度/鼠标视角；排除活动候选后选择同房间下一个合法候选，否则切换其他房间；自定义点初始使用当前合法点副本并进入编辑。

- [ ] **Step 6: 写错误、降级和生图条件边界失败测试**

```js
test('continue exposes a real conditions payload without creating fake AI work', async () => {
    await app.init();
    const payload = app.continueToConditions();
    assert.deepEqual(Object.keys(payload).sort(), ['context', 'selectedViews']);
    assert.equal(app.getState().phase, 'conditions');
    assert.equal(app.getState().tasks, undefined);
    assert.equal(app.getState().results, undefined);
});
```

- [ ] **Step 7: 实现 conditions 状态框架和错误恢复**

`continueToConditions()` 只在非 editing 且至少一个合法选中视角时返回结构化 payload，并切换真实 `conditions` 页面状态；不创建 task/result。加载失败进入 error 并保留 retry；某房间无候选只进入 roomResults empty，不阻断其他房间。

- [ ] **Step 8: 运行应用测试**

Run: `node --test tests/ai-concept-app-startup.test.js tests/ai-concept-app-state.test.js`

Expected: PASS。

- [ ] **Step 9: 提交**

```bash
git add src/AiConceptApp.js tests/helpers/ai-concept-app-harness.js tests/ai-concept-app-startup.test.js tests/ai-concept-app-state.test.js
git commit -m "feat: integrate AI concept candidate workbench"
```

---

### Task 8: 接入 Vite 构建、真实 Drawing2 验收和全量回归

**Files:**
- Modify: `vite.config.3d.js`
- Modify: `tests/panorama-build-contract.test.js`
- Create: `tests/ai-concept-real-drawing.test.js`
- Modify: `README.md`（仅在已有入口说明段落中追加 AI 页面启动 URL）

**Interfaces:**
- Produces: `dist-3d/index-ai-concept.html`。
- Verifies: 真实 `public/data/Drawing2.json` 或项目实际 bundled Drawing2 路径可被现有 GeometryService 解析并产生 AI 候选。

- [ ] **Step 1: 写构建入口失败测试**

```js
assert.equal(path.basename(inputs.aiConcept ?? ''), 'index-ai-concept.html');
```

- [ ] **Step 2: 运行构建契约并确认新入口缺失失败**

Run: `node --test tests/panorama-build-contract.test.js`

Expected: FAIL，`inputs.aiConcept` 为空。

- [ ] **Step 3: 将独立页面加入 Vite 多入口**

```js
input: {
  preview: resolve(__dirname, 'index-3d.html'),
  vr: resolve(__dirname, 'index-vr.html'),
  panorama: resolve(__dirname, 'index-panorama.html'),
  aiConcept: resolve(__dirname, 'index-ai-concept.html'),
}
```

- [ ] **Step 4: 写真实 Drawing2 数据生成验收测试**

测试通过 `GeometryService`/现有解析入口读取真实 Drawing2，调用 `generateAiViewCandidates()`，断言：至少一个主要房间有候选；所有候选坐标/FOV 有限；每个房间候选不超过 4；主要房间默认选中不超过一个；生成两次深相等；结果不包含任何原 `camera_list` id。

- [ ] **Step 5: 运行真实数据测试并修复数据适配**

Run: `node --test tests/ai-concept-real-drawing.test.js`

Expected: PASS。若真实门窗字段缺少统一形态，只在生成器输入适配层补充显式字段解析，不在测试中伪造。

- [ ] **Step 6: 更新入口说明并运行目标测试**

Run: `node --test tests/ai-*.test.js tests/content-obstacle-bounds.test.js tests/panorama-build-contract.test.js tests/panorama-app-startup.test.js`

Expected: PASS。

- [ ] **Step 7: 运行完整自动测试和生产构建**

Run: `npm test`

Expected: 0 fail；现有 skip 保持原状。

Run: `npm run build:3d`

Expected: exit 0，并生成 `dist-3d/index-ai-concept.html`、`dist-3d/index-panorama.html`、`dist-3d/index-3d.html`、`dist-3d/index-vr.html`。

- [ ] **Step 8: 使用本地前端做真实浏览器验收**

启动：`npm run dev -- --port 4181`

打开：`http://127.0.0.1:4181/index-ai-concept.html?planId=ai-concept-qa&version=1#debug`

验收：白模和吊顶显示；自动进入主要房间候选；房间切换和胶片栏正确；浏览不改变选择；微调显示雾蓝光晕且保存/取消正确；自动点可排除恢复；自定义点确认删除；刷新恢复草稿；下一步只进入 conditions 框架；控制台无未捕获异常。

- [ ] **Step 9: 提交**

```bash
git add vite.config.3d.js tests/panorama-build-contract.test.js tests/ai-concept-real-drawing.test.js README.md
git commit -m "feat: ship AI concept view page"
```

---

## Self-Review

- Spec coverage: Tasks 2–4 覆盖独立数据、版本、选择/排除语义；Task 3 覆盖确定性候选生成、房间数量、评分、去重、降级；Tasks 5–7 覆盖布局、微调、自定义和 conditions 边界；Task 8 覆盖真实数据、回归和构建。
- Scope boundary: 不包含风格/环境矩阵、AI 服务任务、轮询、结果相册或偏好记录；这些属于下一阶段独立设计。
- Type consistency: 全流程统一使用 `roomId/activeViewId/status/selected/yaw/pitch/fov`，Repository 参数统一为 `planId/version/draft`，FOV 统一为水平值。
- Placeholder scan: 本计划不含待定字段、空实现或“同上实现”等不可执行步骤。
