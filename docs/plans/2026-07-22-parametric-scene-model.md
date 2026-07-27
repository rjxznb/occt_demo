# 参数化 SceneModel 实施计划

> 状态：待实施  
> 依据：`docs/scene-model.md` 与 `D:\KeMagic` 的 Product/ProductView、参数求值、参数化几何和 Command/History 实现  
> 实施原则：每个任务先补失败测试，再写最小实现，再运行完整验证；每个阶段独立提交，禁止把运行时 Three.js 对象写入项目数据。

## 目标

把当前“2D/3D 分别深拷贝数据、软装 3D 使用 Box、运行时模型直接挂在 scene”改造成以 SceneDocument 为唯一真相源的架构，并跑通一个基础柜体的参数化闭环：

1. 同一实体在 2D、3D 使用同一个 `entityId`；
2. 修改柜体尺寸后，2D footprint、3D 板件和碰撞体同步更新；
3. 参数修改支持校验、撤销、重做、保存和重新打开；
4. 未参数化的旧 TypeId 继续显示 DXF 符号和 3D Box；
5. 第二阶段再把墙、门窗和 CSG 派生几何迁入统一模型，避免首版同时改动参数引擎和高风险布尔运算。

## 技术决策

- 保持现有 JavaScript ES Module 技术栈，使用 JSDoc 描述公开类型；本轮不迁移 TypeScript。
- 使用浏览器原生 `crypto.randomUUID()` 创建持久化实体 ID；测试通过注入 `idFactory` 固定 ID。
- 增加 `ajv` 校验 SceneDocument 和 ProductDefinition；公式使用自定义 AST 白名单求值，禁止 `eval` 和 `new Function`。
- 纯模型层不依赖 DOM 和 Three.js。Recipe 先生成中立的 `PartSpec`，再由 2D/3D 投影转换成 Three.js 对象。
- 使用 Node 内置 `node:test` 做模型层测试，不引入额外测试框架；浏览器渲染继续通过 Vite 构建和人工视觉回归验证。
- 保留现有 `RoomRenderer`、`PlanRenderer` 和 CSG 算法，先用兼容适配层接入 SceneStore，再逐步替换平行数组。
- SceneDocument 只保存权威数据；公式结果、网格、碰撞体、bounds 和选择状态全部属于运行时派生缓存。

## 里程碑 A：建立可测试的模型内核

### 任务 1：测试入口和契约骨架

**修改**

- `package.json`
- `src/model/SceneDocument.js`
- `src/model/schema/scene-document.schema.json`
- `src/model/schema/product-definition.schema.json`
- `src/model/validateDocument.js`
- `tests/model/validateDocument.test.js`

**实施**

1. 安装 `ajv`，增加脚本：`test: node --test`、`test:watch: node --test --watch`。
2. 用 JSDoc 固化 `SceneDocument`、`Entity`、`Transform`、`ComponentInstance`、`ProductDefinition`、`ParameterDefinition` 的字段；单位固定为 mm，坐标固定为 Z-up、右手系。
3. SceneDocument Schema 要求 `schemaVersion`、`projectId`、`units`、`coordinateSystem`、`levels`、`entities`；实体必须有 UUID、`kind`、`source`、`revision`。
4. ProductDefinition Schema 要求稳定的 `productId + version`、参数 code、几何 Recipe 和表示策略；拒绝重复参数 code、未知 recipe 节点和非有限数值。
5. `validateSceneDocument()` 与 `validateProductDefinition()` 返回 `{ valid, errors }`，错误包含 JSON path、错误码和中文消息，不直接抛出 AJV 内部对象。

**测试**

- 最小合法文档通过；缺少单位、重复实体 ID、NaN、错误 quaternion 长度失败。
- 合法柜体定义通过；重复参数 code、非法公式节点和未知 geometry strategy 失败。
- 命令：`npm test -- tests/model/validateDocument.test.js`，预期全部通过。

### 任务 2：LegacyAdapter 生成统一实体

**新增/修改**

- `src/model/LegacyAdapter.js`
- `src/model/LegacyRenderDataAdapter.js`
- `tests/model/LegacyAdapter.test.js`
- `src/App.js`

**实施**

1. `LegacyAdapter.fromGeometryPayload({ outline, rooms, doorWindows, softlists }, options)` 生成 SceneDocument；`options.idFactory` 可注入。
2. 每个 room、door、window、softlist 和 outline 都生成独立 Entity；原始 `TypeId`、数组索引、DXF key 仅保存在 `legacy` 字段。
3. 门窗实体保存显示 footprint；临时 cutter 不进入实体，后续由派生服务计算。
4. softlist 生成 `kind: 'component'`：有产品映射时保存正式 `productRef`，无映射时保存 `legacyBox` 定义引用和原始 symbol/footprint。
5. `LegacyRenderDataAdapter.toLegacyPayload(sceneDocument)` 暂时还原现有渲染器需要的 `{ outline, rooms, doorWindows, softlists }`，并把 `entityId` 带入每个旧对象。
6. `App.loadData()` 只调用一次 LegacyAdapter，设置 `this.sceneDocument`；兼容适配器仅用于尚未迁移的渲染路径，不再让 2D/3D 各自成为权威数据。

**测试**

- 输入 N 个房间、门、窗、软装，输出数量和 kind 正确且 ID 全局唯一。
- 相同 `idFactory` 下 2D/3D 兼容 payload 中同一对象的 `entityId` 相同。
- 无 footprint、未知 TypeId、freestyle 软装不导致整批导入失败，并产生可定位诊断。

### 任务 3：SceneStore、SelectionStore 与命令历史

**新增/修改**

- `src/model/SceneStore.js`
- `src/model/SelectionStore.js`
- `src/model/History.js`
- `src/model/commands/SceneCommands.js`
- `tests/model/SceneStore.test.js`
- `tests/model/History.test.js`

**公开接口**

```js
sceneStore.getEntity(id)
sceneStore.getEntitiesByKind(kind)
sceneStore.subscribe(listener)              // listener(changeSet)
sceneStore.execute(command)
sceneStore.undo()
sceneStore.redo()

selectionStore.select(entityId, { additive })
selectionStore.clear()
selectionStore.subscribe(listener)
```

**实施**

1. SceneStore 内部使用 `Map<entityId, entity>`，事务完成后一次性发送 `{ added, updated, removed, reasons }`。
2. 提供 `AddEntityCommand`、`RemoveEntityCommand`、`MoveEntityCommand`、`ChangeAppearanceCommand` 和后续复用的 `ChangeParameterCommand`。
3. Command 保存修改前后数据，不保存 mesh；连续拖动用 `mergeKey` 合并，提交时递增 Entity revision。
4. SelectionStore 与 SceneDocument 分离；实体删除后自动清除对应选择。
5. 所有 getter 返回只读视图或结构化克隆，禁止调用方绕过命令直接修改 Store 内部实体。

**测试**

- 增删改发送一次精确 changeSet；失败事务不留下半更新状态。
- 参数/位置修改可 undo/redo；新命令执行后清空 redo 栈。
- 相同 `mergeKey` 的连续修改合并，不同实体或参数不合并。

## 里程碑 B：统一 2D/3D 身份与旧数据兼容

### 任务 4：投影注册表和 entityId 回链

**新增/修改**

- `src/projections/ProjectionRegistry.js`
- `src/projections/PlanProjection.js`
- `src/projections/Scene3DProjection.js`
- `src/components/PlanRenderer.js`
- `src/components/RoomRenderer.js`
- `src/components/SoftlistRenderer.js`
- `src/components/Softlist3DFactory.js`

**实施**

1. ProjectionRegistry 维护 `entityId -> Set<Object3D>`，统一注册、查询、替换和 dispose。
2. 所有实体根对象写入 `userData = { entityId, representationId, partId? }`；类型和数组索引只能作为显示辅助字段。
3. PlanProjection 和 Scene3DProjection 订阅 SceneStore changeSet，仅更新受影响实体；第一版允许房间/墙体整组重建，component 必须按实体增量重建。
4. `App.switchTo2DView()` 和 `switchTo3DView()` 不再 `JSON.parse(JSON.stringify(...))`；两边都读取同一个 SceneStore。
5. 切换数据源时统一销毁两个投影、Registry、材质和几何缓存，避免旧订阅继续刷新。

**测试/验收**

- 单元测试验证 Registry 替换对象后 dispose 一次且索引无残留。
- 浏览器中同一软装的 2D group 和 3D mesh 具有相同 entityId。
- 反复切换 2D/3D 不增加重复对象，不丢材质和可见性。

### 任务 5：选择、材质和拖入模型改走 Store

**修改**

- `src/components/SelectionManager.js`
- `src/components/Softlist2DSelector.js`
- `src/components/DXFMaterialSidebar.js`
- `src/components/MaterialSidebar.js`
- `src/components/DragDropManager.js`
- `src/App.js`

**实施**

1. 选择器只把命中的 `entityId` 交给 SelectionStore；两个投影监听选择状态并分别高亮，mesh 不再保存权威选中状态。
2. 材质修改派发 `ChangeAppearanceCommand`，按 `materialSlot` 或 legacy 默认槽保存到 Entity。
3. DragDropManager 不直接把新模型作为最终数据挂入 scene；改为创建 component Entity，再由 Scene3DProjection 生成对象。
4. 删除和移动都派发 Command；保留现有射线拾取和拖动体验。

**验收**

- 2D 选软装后切到 3D仍高亮同一实体，反向亦然。
- 材质、移动、删除可以撤销/重做；刷新投影后状态不丢失。
- 未映射 TypeId 仍显示原 DXF symbol 和 DEFAULT_HEIGHT Box。

## 里程碑 C：参数引擎与首个柜体竖切

### 任务 6：ProductCatalog 和产品版本锁定

**新增**

- `src/parametric/ProductCatalog.js`
- `src/parametric/products/basic-cabinet.v1.js`
- `src/parametric/products/legacy-box.v1.js`
- `src/parametric/legacyTypeMap.js`
- `tests/parametric/ProductCatalog.test.js`

**实施**

1. Catalog 以 `productId@version` 为唯一键；注册时运行 ProductDefinition 校验，不允许静默覆盖相同版本。
2. `ComponentInstance.productRef` 必须包含精确版本；打开文档时缺少版本则报告错误并使用只读 legacyBox 降级，不自动换到最新版。
3. 第一件正式产品定义为 `storage.basic-cabinet@1.0.0`，参数包含 `width/depth/height/panelThickness/backThickness/toeKickHeight/shelfCount/doorCount`。
4. legacyTypeMap 只为明确验证过的 TypeId 建立映射；其余全部走 `legacy.placeholder@1.0.0`。

### 任务 7：安全公式求值、依赖图和参数约束

**新增**

- `src/parametric/ExpressionEvaluator.js`
- `src/parametric/ParameterResolver.js`
- `src/parametric/ParameterHash.js`
- `tests/parametric/ParameterResolver.test.js`

**公开接口**

```js
resolveParameters(definition, overrides, context)
// => { ok, values, diagnostics, hash, effects }
```

**实施**

1. AST 仅支持 literal、ref、add、sub、mul、div、min、max、clamp、round、floor、ceil、eq、lt、lte、gt、gte、and、or、not、if。
2. ref 只允许 `self.*`、`parent.*`、`project.*`；MVP 不允许任意 entityId 跨实体读取。
3. 收集 ref 构建依赖图，拓扑排序后求值；循环依赖、除零、缺失引用和非有限结果均返回诊断，不进入几何生成。
4. 求值顺序固定为默认值 → 实例覆盖 → 类型归一化 → 公式 → min/max/options → 跨参数约束。
5. hash 对 definition version、规范化后的 values 和 resolver version 做稳定序列化；对象 key 顺序不影响结果。

**测试**

- 默认值、range、options、integer、boolean 和公式联动正确。
- 依赖循环、缺失引用、除零、越界、NaN 全部失败且保留上一个有效几何。
- 输入对象 key 顺序不同但语义相同时 hash 一致。
- 测试证明公式文本无法调用 `window`、`fetch`、构造函数或原型链。

### 任务 8：Recipe 求值和 Three.js 生成边界

**新增/修改**

- `src/parametric/RecipeEvaluator.js`
- `src/parametric/GeometryCache.js`
- `src/projections/ThreePartFactory.js`
- `src/projections/PlanPartFactory.js`
- `tests/parametric/RecipeEvaluator.test.js`

**实施**

1. MVP Recipe 节点支持 `group`、`box`、`repeat`；输出中立 `PartSpec[]`，字段固定为 `partId`、尺寸、局部 transform、materialSlot 和 visible。
2. basic-cabinet 生成左右侧板、顶底板、背板、踢脚、可重复层板和门板；重复件使用稳定 `shelf-0`、`door-0` 等 partId。
3. PlanPartFactory 从同一 resolved values 生成矩形 footprint；ThreePartFactory 将 PartSpec 转为 Group/Mesh。
4. GeometryCache 键为 product/version/parameterHash/representation/quality；相同参数实例共享 BufferGeometry，不共享 transform 和 Entity 状态。
5. 缓存采用引用计数；投影替换或销毁时释放引用，计数归零后 dispose。

**测试**

- 修改 width 只改变受影响板件尺寸和位置；partId 保持稳定。
- shelfCount、doorCount 的 0、1、多件边界生成正确，无重复 ID 和负尺寸。
- 相同参数命中同一缓存，不同参数产生不同 key；释放后 geometry 只 dispose 一次。

### 任务 9：参数编辑 UI 和 ChangeParameterCommand

**新增/修改**

- `src/components/ParameterPanel.js`
- `index.html`
- `src/model/commands/SceneCommands.js`
- `src/App.js`

**实施**

1. 选中有 ProductDefinition 的 component 时显示参数面板；按 schema 生成 number、range、checkbox 和 select 控件。
2. 输入先调用 resolver 做预校验；非法值显示参数级错误，不提交 Store，也不替换上一个有效 2D/3D 表示。
3. 合法修改派发 `ChangeParameterCommand`；滑块 input 使用 `entityId+parameterCode` mergeKey，change 时结束合并。
4. changeSet 根据参数 `effects` 标记 plan2d/preview3d/collision/bounds；投影只刷新受影响表示。
5. 增加 Ctrl/Cmd+Z、Ctrl/Cmd+Shift+Z 和 Ctrl/Cmd+Y；文本输入聚焦时仍由参数面板正确区分浏览器编辑撤销与场景撤销。

**验收**

- width 改变后两个视图的尺寸在一次事务后同步，3D 不再只缩放根 Group，而是重建板件。
- 连续拖动宽度只产生一次历史记录；撤销恢复所有表示和输入框值。
- 非法 panelThickness、负尺寸、层板过多不会产生 NaN 或退化几何。

## 里程碑 D：持久化、迁移和首版发布

### 任务 10：SceneDocument 保存、加载和迁移

**新增/修改**

- `src/model/SceneSerializer.js`
- `src/model/migrations/index.js`
- `src/components/DataSourcePicker.js`
- `index.html`
- `tests/model/SceneSerializer.test.js`

**实施**

1. 导出 JSON 前运行 Schema 校验，只保存 SceneDocument、产品版本锁和材质引用；过滤选择、derived cache、Three 对象和历史栈。
2. 导入流程为 parse → schemaVersion 识别 → 顺序迁移 → 校验 → ProductCatalog 引用检查 → 原子替换当前 Store。
3. 增加“保存项目”和“打开项目”入口；加载失败保持当前场景不变，并显示可定位错误。
4. v1 只实现 `1.0` schema；迁移注册表和测试先建立，后续版本不得在业务代码中散落兼容分支。

**测试**

- 保存再打开后实体 ID、产品版本、参数、transform、材质和可见性完全一致。
- 导出结果不包含 `Object3D`、geometry、selection、history、formulaCache。
- 损坏 JSON、未知 schemaVersion、缺失产品版本均不替换当前文档。

### 任务 11：兼容性、性能和视觉回归

**修改**

- `src/App.js`
- `README.md`
- `docs/scene-model.md`（仅把已落地章节标记为 implemented）

**验证矩阵**

1. 运行 `npm test`。
2. 运行 `npm run build` 和 `npm run build:3d`。
3. 用内置示例验证房间、门、窗、62 件软装数量与改造前一致；未知 TypeId 全部走 legacyBox。
4. 放大检查门窗 CSG 边缘、弧墙、地板、软装 DXF 符号和柜体板件，不能只看整屋缩略图。
5. 连续切换 2D/3D 十次、修改柜体参数五十次，确认对象数量和 GPU geometry 数量可回落，无重复订阅和明显泄漏。
6. 参数修改到可见更新目标小于 100ms；相同产品同参数实例必须命中共享 geometry 缓存。
7. 保存项目、刷新页面、重新打开，复核参数化柜体与 legacy 软装同时存在。

**里程碑 A-D 完成定义**

- `docs/scene-model.md` 第 21 节中除墙体宿主相关外的 MVP 验收项全部通过。
- App 不再用 JSON 深拷贝维护 2D/3D 两份权威状态。
- 所有交互修改均经 SceneStore Command；业务逻辑不依赖 Three.js UUID 或数组下标。
- basic-cabinet 是可编辑、可撤销、可保存、2D/3D 同步的真实参数化装配体。

## 里程碑 E：建筑结构参数化（MVP 稳定后实施）

### 任务 12：门窗 cutter 从实体派生

**新增/修改**

- `src/geometry/DerivedOpeningService.js`
- `src/core/GeometryService.js`
- `src/components/RoomRenderer.js`
- `tests/geometry/DerivedOpeningService.test.js`

**实施**

1. Entity 保存门窗显示 footprint、base 和 height；`DerivedOpeningService` 使用统一 offset 规则实时生成 cutter。
2. `RoomRenderer` 按 entityId 关联显示对象与 cutter，删除 `processed_doors/processed_windows` 平行数组契约。
3. offset 失败时记录诊断并使用原 footprint，保持当前“不能丢门窗”的安全降级。
4. 对照现有 CSG 规则保留外扩 15mm、退化三角形清理和减数分批处理。

**测试/验收**

- 显示 footprint 和 cutter 始终来自同一 entityId。
- 重叠门窗、弧墙附近开口、offset 失败路径都不造成整屋 CSG 静默丢失。

### 任务 13：墙体一级实体和门窗宿主关系

**新增/修改**

- `src/geometry/WallGeometryService.js`
- `src/model/LegacyAdapter.js`
- `src/projections/Scene3DProjection.js`
- `tests/geometry/WallGeometryService.test.js`

**实施**

1. 墙的权威数据固定为中心路径、thickness、height、base；墙面、碰撞体和 CSG 几何均为派生结果。
2. 旧户型导入时先创建只读 derived wall entities，确保视觉一致；只有进入墙编辑模式后才升级为 runtime 可编辑墙。
3. 门窗 host relation 保存 `wallId + distance + elevation + lateralOffset + flip`；width/height 仍属于产品参数。
4. 自动宿主匹配仅在距离与方向都满足容差时建立；多候选或无候选保留 legacy 世界坐标并给出诊断，不猜测宿主。
5. 墙长度或路径变化时重新计算宿主位置和越界状态，再由 opening service 生成 cutter。

**验收**

- 修改墙长后门窗沿宿主保持相对位置；越界门窗明确报错且保留可编辑状态。
- 相同尺寸、不同宿主位置的窗共享几何缓存。
- 房间边界、墙体和开口视觉与现有示例一致后，才能删除旧房间边直接建墙的路径。

### 任务 14：扩展 Recipe 与其他结构实体

**新增/修改**

- `src/parametric/RecipeEvaluator.js`
- `src/projections/ThreePartFactory.js`
- `src/geometry/PathUtils.js`
- 对应单元测试

**实施**

1. 在 box 竖切稳定后，依次增加 shape、line、extrude、sweep、asset 和 boolean；每种节点必须先有纯数据测试，再接 Three.js。
2. `PathUtils.flattenPath()` 统一处理 bulge 弧，2D、墙体、挤出和碰撞不得各自采样。
3. 梁、柱、平台和机电点位按 EntityKind 接入；没有编辑需求的类型先以 imported SourceGeometry 存储，不强行参数化。
4. 每新增一种 Recipe 节点都更新 ProductDefinition Schema、版本号、缓存 generatorVersion 和迁移测试。

## 提交顺序

每个任务完成并验证后单独提交，建议提交信息：

1. `test: add model contract validation harness`
2. `feat: adapt legacy geometry into scene entities`
3. `feat: add scene store selection and history`
4. `refactor: project shared entities into 2d and 3d`
5. `refactor: route scene interactions through commands`
6. `feat: add versioned product catalog`
7. `feat: resolve parameter expressions safely`
8. `feat: generate parametric cabinet representations`
9. `feat: add parameter editing workflow`
10. `feat: persist and reload scene documents`
11. `test: verify parametric scene compatibility`
12. `refactor: derive opening cutters from entities`
13. `feat: add hosted parametric walls and openings`
14. `feat: extend procedural geometry recipes`

## 明确不在首版范围内

- 不把 KeMagic 的旧公式执行器、坐标字符串或 `__formulaCache__` 原样复制过来。
- 不在首个参数化竖切中实现任意脚本公式、跨项目产品继承或多人协作。
- 不在 SceneDocument 中保存 Three.js 对象、三角形顶点、公式缓存或选择状态。
- 不把所有旧 TypeId 一次性做成真实模型；无正式定义的产品继续使用 legacyBox。
- 不在里程碑 A-D 中重写墙体拓扑和 CSG；这些改动必须等柜体参数化闭环稳定后单独实施。
