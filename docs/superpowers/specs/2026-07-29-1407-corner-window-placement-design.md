# 1407 拐角窗放置修复设计

## 目标

在 OCCT 3D 前端中为 `TypeId=1407` 复现 UE 的专用放置规则，使 `Drawing2.json` 中两个拐角窗同时具有正确的拐角锚点和局部方向。

## 范围

- 只修改 `D:/occt_demo/.worktrees/cad-renderer-parametric-bridge` 中的前端源码和测试。
- 只对 `TypeId=1407` 增加专用放置分支。
- 允许 `ContentModelRegistry.js` 把顶层 `out_wall_thickness` 作为只读 CAD 事实保留到内容模型实例，但不改写原始 JSON 字段。
- 不修改 CAD 项目，不复制构建产物到 CAD 资源目录或运行时缓存。
- 不改变 1401、140c、140d02 或其他 TypeId 的解析、缩放、旋转和放置行为。
- 不改动参数化请求接口、资源映射或模型缓存键。

## 根因证据

UE 在 `TemplateManager.cpp` 和 `BIMScene.cpp` 中对 1407 做了两层专用处理：

1. 将 CAD `Size.X/Size.Y` 各加一个墙厚，得到用于放置的 L 型窗包围尺寸。
2. 使用局部包围盒 `(0, Size.Y, 0) -> (Size.X, 0, Size.Z)` 的底部中心对齐 CAD 轮廓的 `MiddlePos`，保留 CAD 旋转，不额外增加 90° 或 180°。

当前前端把 1407 当作普通 `bounds-center` 模型：

- 使用 footprint 所有顶点的算术平均值作为目标中心，与 UE 的局部包围盒中心不同。
- 参数化 OBJ 执行 Y-up 到 Z-up 转换后，1407 的第二条平面轴指向局部负 Y；UE 的专用包围规则按局部正 Y 放置。
- 通用居中虽然能让模型大致覆盖洞口，但会把 L 型的拐角原点移到另一侧，从而产生窗体支臂方向相反的视觉结果。

`Drawing2.json` 的两个实例已证实该差异：

- `window_list[6]` 的 UE 拐角锚点约为 `(-6878.686228, 2321.954466)`。
- `window_list[7]` 的 UE 拐角锚点约为 `(-5528.686224, 2321.955009)`。
- 两次参数化转换返回了不同尺寸的 OBJ，因此资源选择、参数请求和缓存复用不是根因。

## 方案对比

### 方案 1：在放置层增加 1407 专用计划（采用）

在 `ContentModelPlacement.js` 中从原始 CAD 事实计算 UE 对等的 `MiddlePos`、修正尺寸和拐角锚点，然后在模型局部平面执行 1407 OBJ 轴向补偿。原始实例数据保持不变，特例集中在已有的放置计划边界内。

### 方案 2：在 JSON 解析阶段改写 BasePoint 和翻转字段（不采用）

会污染原始 CAD 输入，并让参数解析、资源选择和调试输出看到伪造数据，不符合当前分层职责。

### 方案 3：加载后直接改写 OBJ 几何（不采用）

会将实例放置规则混入可缓存原型，增加几何复用和多实例串扰的风险，也与 UE 通过 Actor Transform 放置的做法不一致。

## 选定设计

### 1407 放置计划

`resolvePlacementPlan` 在 140c 特例之后识别 1407，调用独立的纯计算帮助函数：

1. 以 CAD `BasePoint` 为原点，用 CAD 旋转的逆变换将 footprint 顶点转回模型局部平面。
2. 对局部顶点求轴对齐包围盒中心，再转回世界坐标，得到 UE 的 `MiddlePos`。
3. 读取 CAD `Size.X`、`Size.Y` 和顶层 `out_wall_thickness`，得到 `(Size.X + WallThickness, Size.Y + WallThickness)`。`ContentModelRegistry.js` 将该全局值以 `externalWallThickness` 保留到每个规范化实例，对应 UE `CadMarkData->GetExternalWallThickness()` 的数据来源。
4. 将修正尺寸的半尺寸按 CAD 旋转到世界坐标，从 `MiddlePos` 中减去，得到 UE 对等的拐角锚点。
5. 将有效实例的放置方式设为 `model-origin`，保留 CAD 旋转、水平翻转和离地高度。
6. 在 1407 模型的局部平面对 Y 轴执行一次坐标补偿；该补偿与 CAD 上下翻转组合，而不会覆盖 CAD 原值。

### 降级行为

当 footprint 少于三个有效点、包围尺寸退化、CAD Size 无效或顶层 `out_wall_thickness` 无效时，不使用不完整的 1407 专用结果，而是继续走现有通用 `bounds-center` 放置。降级不影响模型请求或本地占位回退。

## 测试设计

首先在 `tests/content-model-registry.test.js` 验证顶层 `out_wall_thickness` 被保留为每个实例的 `externalWallThickness`。

然后在 `tests/content-model-placement.test.js` 中使用 `Drawing2.json` 两个 1407 实例的实际 BasePoint、Points、Size、旋转和顶层墙厚数据，配合一个原点在 L 型拐角的非对称 Y-up 测试原型。

每个实例分别验证：

- 修改前测试因模型原点不在 UE 拐角锚点而失败。
- 模型原点的世界 XY 与 UE 计算的拐角锚点一致。
- 模型局部 +X 轴经 CAD 旋转后保持正确方向。
- 模型第二条平面轴经 OBJ 轴向补偿和 CAD 旋转后指向局部正 Y。
- 模型底部等于 CAD 离地高度。
- 1401 和 140c 的现有放置测试继续通过。

## 本地验证

1. 运行针对 1407 的新增测试，确认红绿循环。
2. 运行全部 Node 测试和 `npm run build:3d`。
3. 只启动 OCCT 本地 3D 页面，使用 `Drawing2.json` 查看两个 1407 拐角窗。
4. 点击两个模型，确认控制台中的 `typeId=1407`、来源索引、旋转和世界包围信息分别对应 `window_list[6]` 与 `window_list[7]`。
5. 由用户在本地 OCCT 页面确认窗体两条支臂均沿墙洞展开，没有反向伸入房间。
