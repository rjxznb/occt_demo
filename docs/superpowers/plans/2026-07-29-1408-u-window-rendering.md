# 1408 U 型窗渲染实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 OCCT 统一内容模型链路中实现 `1408` U 型窗的 UE 参数映射、模型原点放置和可选调试 fixture。

**Architecture:** `ParametricParameterResolver` 只负责把 CAD `BlockInnerInfo` 转为参数化模型语义；`ContentModelPlacement` 只负责根据 8 点轮廓、原始 Size、外墙厚和统一翻转计算 UE 模型原点；`SceneFixtures` 与 `DataSource` 只负责在 `fixture=1408` 时不可变地追加一条合成 `window_list` 记录。资源发现继续复用既有 `TypeId -> template ResId -> goods detail -> parametric JSON -> OBJ` 链路，不增加 1408 专属下载器。

**Tech Stack:** JavaScript ES modules、Node.js `node:test`、Three.js、Vite 3D build。

## Global Constraints

- 工作目录固定为 `D:\occt_demo\.worktrees\cad-renderer-parametric-bridge`，分支固定为 `codex/ue-typeid-rendering`。
- 只修改 OCCT 工作树，不修改、部署或提交 `C:\Users\User\Desktop\cad_plugin`。
- 不修改 `public/data/Drawing2.json` 或 `dist-3d/data/Drawing2.json`。
- 默认 3D、VR 和 CAD 入口保持原行为；只有精确查询参数 `fixture=1408` 才追加 U 型窗。
- 1408 继续使用模板资源 `ResId=2406318`，不得嵌入或伪造模型文件。
- 保持统一水平翻转规则 `CAD horizontalFlip XOR template XMirror`，垂直翻转使用 CAD `verticalFlip`，1408 不增加额外旋转。
- 无效 8 点轮廓、非正 Size 或非正外墙厚必须回退现有通用放置，不得猜测位置或隐藏模型。
- 每个实现任务严格执行 RED、GREEN、回归、单独提交；构建产物不得复制到 CAD 或 AutoCAD 缓存。

## 文件结构

- `src/components/ParametricParameterResolver.js`：注册 1408 参数适配器；不负责资源下载或模型放置。
- `src/components/ContentModelPlacement.js`：注册 1408 placement adapter；保持 normalized instance 原始 Size 不变。
- `src/dev/SceneFixtures.js`：保存并克隆只用于本地验证的 1408 合成 CAD 记录。
- `src/core/DataSource.js`：只负责识别允许的 fixture 查询参数并包装数据源。
- `tests/parametric-parameter-resolver.test.js`：锁定 UE 字段名称、顺序和墙厚优先级。
- `tests/content-model-placement.test.js`：锁定人工盒中心、模型原点、旋转、翻转和无效数据 fallback。
- `tests/scene-fixtures.test.js`：锁定 URL 门控、输入不可变、目标列表和完整 fixture 数据。

---

### Task 1: 注册 1408 UE 参数适配器

**Files:**
- Modify: `tests/parametric-parameter-resolver.test.js`
- Modify: `src/components/ParametricParameterResolver.js`

**Interfaces:**
- Consumes: normalized content instance `{ typeId, rawBlockInnerInfo, externalWallThickness }` 和现有 `selection.templateEntry.ModelParamterMap`。
- Produces: `resolveParametricParameters(instance, selection): Array<{ name: string, value: number }>`，1408 输出 UE 参数名 `宽度/深度/左深/右深/左宽/右宽/高度/离地/墙厚`。

- [ ] **Step 1: 写入 CAD 明确墙厚优先的失败测试**

在 `tests/parametric-parameter-resolver.test.js` 追加：

```js
test('maps 1408 U-window CAD fields to UE parameter names', () => {
    const parameters = resolveParametricParameters({
        typeId: '1408',
        externalWallThickness: 240,
        rawBlockInnerInfo: {
            长: 2870,
            下厚: 240,
            左厚: 180,
            右厚: 220,
            左宽: 1030,
            右宽: 810,
            高度: 1600,
            离地高度: 900,
            墙厚: 260,
        },
    }, selection({ 宽度: 3970, 高度: 1900 }));

    assert.deepEqual(parameters, [
        { name: '宽度', value: 2870 },
        { name: '深度', value: 240 },
        { name: '左深', value: 180 },
        { name: '右深', value: 220 },
        { name: '左宽', value: 1030 },
        { name: '右宽', value: 810 },
        { name: '高度', value: 1600 },
        { name: '离地', value: 900 },
        { name: '墙厚', value: 260 },
    ]);
});
```

该用例同时锁定：UE 的 `左深/右深` 名称必须保留；实例参数不能被数值模板默认值覆盖；CAD 明确提供的 `墙厚=260` 优先于 drawing 级 `240`。

- [ ] **Step 2: 写入 drawing 外墙厚 fallback 的失败测试**

继续追加：

```js
test('uses drawing external wall thickness when 1408 has no explicit wall thickness', () => {
    const parameters = resolveParametricParameters({
        typeId: '1408',
        externalWallThickness: 240,
        rawBlockInnerInfo: {
            长: 2870,
            下厚: 240,
            左厚: 180,
            右厚: 220,
            左宽: 1030,
            右宽: 810,
            高度: 1600,
            离地高度: 900,
        },
    }, selection({}));

    assert.deepEqual(parameters.at(-1), { name: '墙厚', value: 240 });
    assert.equal(parameters.length, 9);
});
```

- [ ] **Step 3: 运行测试并确认 RED**

Run:

```powershell
node --test --test-name-pattern="1408 U-window|1408 has no explicit" tests/parametric-parameter-resolver.test.js
```

Expected: 两个新用例 FAIL；当前 1408 只走通用 `长 -> 长度` 别名，未生成 UE U 型窗参数。

- [ ] **Step 4: 增加最小 1408 参数适配函数**

在 `addArcWindowParameters` 后增加：

```js
function addUWindowParameters(target, instance, blockInnerInfo) {
    setFinite(target, '宽度', blockInnerInfo.长);
    setFinite(target, '深度', blockInnerInfo.下厚);
    setFinite(target, '左深', blockInnerInfo.左厚);
    setFinite(target, '右深', blockInnerInfo.右厚);
    setFinite(target, '左宽', blockInnerInfo.左宽);
    setFinite(target, '右宽', blockInnerInfo.右宽);
    setFinite(target, '高度', blockInnerInfo.高度);
    setFinite(target, '离地', blockInnerInfo.离地高度);

    const explicitWallThickness = finiteNumber(blockInnerInfo.墙厚);
    setFinite(target, '墙厚', explicitWallThickness === null
        ? instance?.externalWallThickness
        : explicitWallThickness);
}
```

不要在前端删除 `左深/右深`。它们按 UE 语义进入现有 conversion request；当前资源未声明的参数由既有转换服务处理。

- [ ] **Step 5: 注册 1408 并保留模板默认值的 only-when-missing 规则**

把 `hasTypeAdapter` 和分支改为：

```js
const hasTypeAdapter = typeId === '1313'
    || typeId === '1401'
    || typeId === '1407'
    || typeId === '1408'
    || typeId === '140c';

if (typeId === '1313') addCornerOpeningParameters(target, instance, blockInnerInfo, false);
if (typeId === '1401') addStandardWindowParameters(target, blockInnerInfo);
if (typeId === '1407') addCornerOpeningParameters(target, instance, blockInnerInfo, true);
if (typeId === '1408') addUWindowParameters(target, instance, blockInnerInfo);
if (typeId === '140c') addArcWindowParameters(target, instance, blockInnerInfo);
```

后续 `addNumericTemplateDefaults(target, selection, true)` 保持不变，64 项上限和有限数值过滤继续由现有代码承担。

- [ ] **Step 6: 验证 GREEN 和参数回归**

Run:

```powershell
node --test --test-name-pattern="1408 U-window|1408 has no explicit" tests/parametric-parameter-resolver.test.js
node --test tests/parametric-parameter-resolver.test.js
```

Expected: 两条 1408 用例和完整参数测试文件全部 PASS。现有 `uses template millimeter height when a parametric resource has zero sample dimensions` 已保护 1408 零资源尺寸所需的 Height Z 轴参考，不修改 `ContentTemplateResolver.js`。

- [ ] **Step 7: 提交 Task 1**

```powershell
git add -- src/components/ParametricParameterResolver.js tests/parametric-parameter-resolver.test.js
git commit -m "feat: resolve 1408 U-window parameters"
```

---

### Task 2: 实现 1408 UE 人工盒放置

**Files:**
- Modify: `tests/content-model-placement.test.js`
- Modify: `src/components/ContentModelPlacement.js`

**Interfaces:**
- Consumes: `{ footprint, size, basePoint, rotationDegrees, horizontalFlip, verticalFlip, externalWallThickness }`，以及 `selection.xMirror`。
- Produces: 仅对有效 1408 返回 `anchor: 'model-origin'` 的 placement plan；人工盒底面中心对齐 CAD 8 点轮廓在自身旋转坐标系中的包围盒中心。

- [ ] **Step 1: 增加可观察模型原点和局部轴的非对称原型**

在 `tests/content-model-placement.test.js` 的原型 helper 区域增加：

```js
function makeUWindowPrototype() {
    const prototype = new THREE.Group();
    const geometry = new THREE.BoxGeometry(3350, 1600, 1270);
    // Source OBJ is Y-up. After axis conversion, this occupies
    // plan X [-1675, 1675], plan Y [-240, 1030], world Z [0, 1600].
    geometry.translate(0, 800, -395);
    prototype.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));

    const origin = new THREE.Object3D();
    origin.name = 'uWindowOrigin';
    prototype.add(origin);

    const xAxis = new THREE.Object3D();
    xAxis.name = 'uWindowXAxis';
    xAxis.position.x = 100;
    prototype.add(xAxis);

    const yAxis = new THREE.Object3D();
    yAxis.name = 'uWindowYAxis';
    yAxis.position.z = -100;
    prototype.add(yAxis);
    return prototype;
}

const uWindowSelection = {
    ...selection,
    typeId: '1408',
    typeName: 'U形窗',
    resId: '2406318',
    referenceSize: { x: 0, y: 0, z: 120 },
    xMirror: false,
};

const uWindowResource = {
    kind: 'parametric-obj',
    resourceType: 8,
    modelType: 0,
    contentHash: 'u-window',
};

function uWindowInstance(overrides = {}) {
    return {
        ...instance,
        instanceId: 'window_list:fixture-1408',
        sourceList: 'window_list',
        sourceIndex: 9,
        category: 'window',
        typeId: '1408',
        basePoint: { x: 3631.313676, y: -4728.045438, z: 0 },
        footprint: [
            { x: 3631.313676, y: -4728.045438 },
            { x: 281.313676, y: -4728.045438 },
            { x: 281.313676, y: -5998.045438 },
            { x: 461.313676, y: -5998.045438 },
            { x: 461.313676, y: -4968.045438 },
            { x: 3411.313676, y: -4968.045438 },
            { x: 3411.313676, y: -5778.045438 },
            { x: 3631.313676, y: -5778.045438 },
        ],
        size: { x: 2870, y: 1030, z: 1600 },
        rotationDegrees: 180,
        horizontalFlip: false,
        verticalFlip: false,
        groundHeight: 900,
        externalWallThickness: 240,
        ...overrides,
    };
}
```

- [ ] **Step 2: 写入无额外旋转和模型原点的失败测试**

追加：

```js
test('1408 aligns the UE artificial U-box center without extra rotation', () => {
    const root = placeContentModel(
        makeUWindowPrototype(),
        uWindowInstance(),
        uWindowSelection,
        uWindowResource,
    );
    root.updateMatrixWorld(true);
    const origin = root.getObjectByName('uWindowOrigin')
        .getWorldPosition(new THREE.Vector3());
    const xDirection = root.getObjectByName('uWindowXAxis')
        .getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
    const yDirection = root.getObjectByName('uWindowYAxis')
        .getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
    const box = worldBox(root);

    assertNear(origin.x, 1956.313676, '1408 model-origin world x');
    assertNear(origin.y, -4968.045438, '1408 model-origin world y');
    assertNear(origin.z, 900, '1408 model-origin world z');
    assertNear(xDirection.x, -1, '1408 local X world x');
    assertNear(xDirection.y, 0, '1408 local X world y');
    assertNear(yDirection.x, 0, '1408 local Y world x');
    assertNear(yDirection.y, -1, '1408 local Y world y');
    assertNear(box.min.z, 900, '1408 sill height');
    assertNear(root.userData.debugInfo.transform.rotationDegrees, 180,
        '1408 keeps CAD rotation');
});
```

计算依据：`correctedX=2870+2*240=3350`、`correctedY=1030+240=1270`，人工盒局部中心为 `(0,395)`；轮廓局部 bounds center 为 `(1675,635)`，旋转 180° 后的世界 bounds center 为 `(1956.313676,-5363.045438)`，所以模型原点为 `(1956.313676,-4968.045438)`。

- [ ] **Step 3: 写入模板水平镜像与 CAD 垂直翻转组合的失败测试**

追加：

```js
test('1408 placement compensates the artificial center after both plan flips', () => {
    const root = placeContentModel(
        makeUWindowPrototype(),
        uWindowInstance({ verticalFlip: true }),
        { ...uWindowSelection, xMirror: true },
        uWindowResource,
    );
    root.updateMatrixWorld(true);
    const origin = root.getObjectByName('uWindowOrigin')
        .getWorldPosition(new THREE.Vector3());
    const xDirection = root.getObjectByName('uWindowXAxis')
        .getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
    const yDirection = root.getObjectByName('uWindowYAxis')
        .getWorldPosition(new THREE.Vector3()).sub(origin).normalize();

    assertNear(origin.x, 1956.313676, 'flipped 1408 model-origin world x');
    assertNear(origin.y, -5758.045438, 'flipped 1408 model-origin world y');
    assertNear(xDirection.x, 1, 'flipped 1408 local X world x');
    assertNear(xDirection.y, 0, 'flipped 1408 local X world y');
    assertNear(yDirection.x, 0, 'flipped 1408 local Y world x');
    assertNear(yDirection.y, 1, 'flipped 1408 local Y world y');
    assert.equal(root.userData.debugInfo.transform.horizontalFlip, true);
    assert.equal(root.userData.debugInfo.transform.verticalFlip, true);
});
```

- [ ] **Step 4: 运行两条测试并确认 RED**

Run:

```powershell
node --test --test-name-pattern="1408 aligns|1408 placement compensates" tests/content-model-placement.test.js
```

Expected: 当前 1408 走 `bounds-center` 通用锚点，至少模型原点断言 FAIL。

- [ ] **Step 5: 增加 UE U 型窗 placement helper**

在 `resolveCornerDoorPlacement` 后、`resolvePlacementPlan` 前增加：

```js
function resolveUWindowPlacement(instance, horizontalFlip, verticalFlip) {
    const sourceRotation = rotationDegreesOf(instance);
    const footprint = footprintMetrics(
        instance?.footprint,
        sourceRotation,
        basePointOf(instance),
    );
    const sizeX = positiveNumber(instance?.size?.x);
    const sizeY = positiveNumber(instance?.size?.y);
    const wallThickness = positiveNumber(instance?.externalWallThickness);
    if (!footprint?.boundsCenter || !sizeX || !sizeY || !wallThickness) return null;

    const correctedX = sizeX + wallThickness * 2;
    const correctedY = sizeY + wallThickness;
    const localBoxMin = {
        x: -correctedX / 2,
        y: correctedY - wallThickness,
    };
    const localBoxMax = {
        x: correctedX / 2,
        y: -wallThickness,
    };
    const localCenterX = (localBoxMin.x + localBoxMax.x) / 2
        * (horizontalFlip ? -1 : 1);
    const localCenterY = (localBoxMin.y + localBoxMax.y) / 2
        * (verticalFlip ? -1 : 1);
    const rotation = THREE.MathUtils.degToRad(sourceRotation);
    const rotatedCenterX = localCenterX * Math.cos(rotation)
        - localCenterY * Math.sin(rotation);
    const rotatedCenterY = localCenterX * Math.sin(rotation)
        + localCenterY * Math.cos(rotation);
    const sourceBasePoint = basePointOf(instance);

    return {
        ...instance,
        basePoint: {
            x: footprint.boundsCenter.x - rotatedCenterX,
            y: footprint.boundsCenter.y - rotatedCenterY,
            z: finiteNumber(sourceBasePoint.z),
        },
        footprint: [],
    };
}
```

`correctedX` 虽因 X 对称而不改变中心，仍需按 UE 原公式显式计算，避免以后误把 U 型盒当成 L 型盒。

- [ ] **Step 6: 在统一翻转计算后注册有效 1408 分支**

在 `resolvePlacementPlan` 已有 `effectiveHorizontalFlip` 后、1313/1407 分支附近加入：

```js
if (String(instance?.typeId ?? '').trim() === '1408') {
    const verticalFlip = Boolean(instance?.verticalFlip);
    const uWindowInstance = resolveUWindowPlacement(
        instance,
        effectiveHorizontalFlip,
        verticalFlip,
    );
    if (uWindowInstance) {
        return {
            instance: {
                ...uWindowInstance,
                horizontalFlip: effectiveHorizontalFlip,
                verticalFlip,
            },
            effectiveHorizontalFlip,
            anchor: 'model-origin',
            arc: null,
        };
    }
}
```

不得调整 `rotationDegrees`，不得套用 1407 的强制 Y 轴补偿；helper 返回 `null` 时继续进入现有通用 return。

- [ ] **Step 7: 增加无效几何 fallback 回归测试**

追加：

```js
test('invalid 1408 geometry keeps the generic bounds-center fallback visible', () => {
    const root = placeContentModel(
        makeUWindowPrototype(),
        uWindowInstance({ footprint: [], externalWallThickness: null }),
        uWindowSelection,
        uWindowResource,
    );
    root.updateMatrixWorld(true);
    const origin = root.getObjectByName('uWindowOrigin')
        .getWorldPosition(new THREE.Vector3());

    assertNear(origin.x, 3631.313676, 'fallback model-origin world x');
    assertNear(origin.y, -4333.045438, 'fallback model-origin world y');
    assertNear(origin.z, 900, 'fallback model-origin world z');
    assert.equal(root.userData.debugInfo.transform.verticalFlip, false);
});
```

- [ ] **Step 8: 验证 GREEN 和完整放置回归**

Run:

```powershell
node --test --test-name-pattern="1408|invalid 1408" tests/content-model-placement.test.js
node --test tests/content-model-placement.test.js
```

Expected: 三条 1408 测试全部 PASS；1313、1407、140c、普通静态模型和翻转测试保持 PASS。

- [ ] **Step 9: 提交 Task 2**

```powershell
git add -- src/components/ContentModelPlacement.js tests/content-model-placement.test.js
git commit -m "feat: place 1408 U-windows using UE alignment"
```

---

### Task 3: 增加精确门控的 1408 合成 fixture

**Files:**
- Modify: `tests/scene-fixtures.test.js`
- Modify: `src/dev/SceneFixtures.js`
- Modify: `src/core/DataSource.js`

**Interfaces:**
- Consumes: `withSceneFixture(source, search)` 中 `URLSearchParams(search).get('fixture')`。
- Produces: `fixture=1408` 时返回包装数据源，其 `loadDrawing()` 只向克隆后的 `window_list` 追加一条真实 `TypeId=1408` 记录；1313 fixture 行为保持不变。

- [ ] **Step 1: 写入 1408 fixture 完整性和不可变性失败测试**

在 `tests/scene-fixtures.test.js` 追加：

```js
test('fixture=1408 appends one asymmetric U-window without mutating the drawing', async () => {
    const originalWindow = { TypeId: '1401', BasePoint: 'X=0 Y=0 Z=0' };
    const originalDoor = { TypeId: '1302' };
    const drawing = {
        window_list: [originalWindow],
        door_list: [originalDoor],
        final_room_list: [{ TypeId: '1101' }],
    };

    const result = await withFixture(drawingSource(drawing), '?fixture=1408').loadDrawing();
    const fixture = result.window_list.at(-1);

    assert.equal(result.window_list.length, 2);
    assert.equal(fixture.TypeId, '1408');
    assert.equal(fixture.BasePoint, 'X=3631.313676 Y=-4728.045438 Z=0.000000');
    assert.equal(fixture.Size, 'X=2870.000000 Y=1030.000000');
    assert.equal(fixture.OutRotateRadian, 180);
    assert.deepEqual(fixture.BlockInnerInfo, {
        长: 2870,
        下厚: 240,
        左厚: 180,
        右厚: 220,
        左宽: 1030,
        右宽: 810,
        高度: 1600,
        墙厚: 240,
        左右翻转: 0,
        上下翻转: 0,
        旋转角度: 0,
        离地高度: 900,
    });
    assert.equal(fixture.Points.length, 8);
    assert.equal(fixture.Points[0],
        'X=3631.313676 Y=-4728.045438 Z=0.000000 B=0.000000');
    assert.equal(fixture.Points[6],
        'X=3411.313676 Y=-5778.045438 Z=0.000000 B=0.000000');
    assert.notEqual(result, drawing);
    assert.notEqual(result.window_list, drawing.window_list);
    assert.deepEqual(drawing.window_list, [originalWindow]);
    assert.equal(result.door_list, drawing.door_list);
    assert.equal(result.final_room_list, drawing.final_room_list);
});
```

- [ ] **Step 2: 扩展无关 fixture 精确门控测试**

把现有无关值测试改为同时验证近似值：

```js
test('unrelated fixture values leave the drawing untouched', async () => {
    for (const search of ['?fixture=13130', '?fixture=14080', '?fixture=U-window']) {
        const drawing = {
            door_list: [{ TypeId: '1302' }],
            window_list: [{ TypeId: '1401' }],
        };
        const result = await withFixture(drawingSource(drawing), search).loadDrawing();

        assert.equal(result, drawing);
        assert.equal(result.door_list.length, 1);
        assert.equal(result.window_list.length, 1);
    }
});
```

- [ ] **Step 3: 运行 fixture 测试并确认 RED**

Run:

```powershell
node --test --test-name-pattern="fixture=1408|unrelated fixture" tests/scene-fixtures.test.js
```

Expected: 1408 用例 FAIL，因为 `withSceneFixture` 当前只允许 1313；无关值用例保持 PASS。

- [ ] **Step 4: 在 SceneFixtures 中定义并克隆 1408 CAD 记录**

在 `CORNER_DOOR_1313` 后增加：

```js
const U_WINDOW_1408 = Object.freeze({
    BasePoint: 'X=3631.313676 Y=-4728.045438 Z=0.000000',
    BlockInnerInfo: Object.freeze({
        长: 2870,
        下厚: 240,
        左厚: 180,
        右厚: 220,
        左宽: 1030,
        右宽: 810,
        高度: 1600,
        墙厚: 240,
        左右翻转: 0,
        上下翻转: 0,
        旋转角度: 0,
        离地高度: 900,
    }),
    ChildType: 0,
    HorizontalFlip: false,
    MarkType: 1,
    OutRotateRadian: 180,
    OutXScale: 1,
    OutYScale: 1,
    OutZScale: 1,
    Points: Object.freeze([
        'X=3631.313676 Y=-4728.045438 Z=0.000000 B=0.000000',
        'X=281.313676 Y=-4728.045438 Z=0.000000 B=0.000000',
        'X=281.313676 Y=-5998.045438 Z=0.000000 B=0.000000',
        'X=461.313676 Y=-5998.045438 Z=0.000000 B=0.000000',
        'X=461.313676 Y=-4968.045438 Z=0.000000 B=0.000000',
        'X=3411.313676 Y=-4968.045438 Z=0.000000 B=0.000000',
        'X=3411.313676 Y=-5778.045438 Z=0.000000 B=0.000000',
        'X=3631.313676 Y=-5778.045438 Z=0.000000 B=0.000000',
    ]),
    Size: 'X=2870.000000 Y=1030.000000',
    TypeId: '1408',
    VerticalFlip: false,
});

function cloneUWindow1408() {
    return {
        ...U_WINDOW_1408,
        BlockInnerInfo: { ...U_WINDOW_1408.BlockInnerInfo },
        Points: [...U_WINDOW_1408.Points],
    };
}
```

fixture 采用 Drawing2 客厅南侧清晰外墙段：总体宽 `3350=2870+2*240`，最大深度 `1270=1030+240`；左右臂末端分别位于 Y `-5998.045438` 和 `-5778.045438`，可以肉眼辨识镜像错误。

- [ ] **Step 5: 让 applySceneFixture 分别追加到正确列表**

将函数改为：

```js
export function applySceneFixture(drawing, fixtureName) {
    if (!drawing || typeof drawing !== 'object') return drawing;
    if (fixtureName === '1313') {
        const doorList = Array.isArray(drawing.door_list) ? drawing.door_list : [];
        return {
            ...drawing,
            door_list: [...doorList, cloneCornerDoor1313()],
        };
    }
    if (fixtureName === '1408') {
        const windowList = Array.isArray(drawing.window_list) ? drawing.window_list : [];
        return {
            ...drawing,
            window_list: [...windowList, cloneUWindow1408()],
        };
    }
    return drawing;
}
```

- [ ] **Step 6: 在数据源入口只允许两个精确 fixture 名称**

在 `src/core/DataSource.js` 的 `withSceneFixture` 中改为：

```js
export function withSceneFixture(source, search = '') {
    const fixtureName = new URLSearchParams(String(search).replace(/^\?/, '')).get('fixture');
    return fixtureName === '1313' || fixtureName === '1408'
        ? new SceneFixtureDataSource(source, fixtureName)
        : source;
}
```

不修改 `App3D.js`；它已经把 `window.location.search` 交给 `withSceneFixture`。

- [ ] **Step 7: 验证 GREEN、1313 回归和注册归一化结果**

Run:

```powershell
node --test tests/scene-fixtures.test.js
node --test tests/content-model-registry.test.js tests/parametric-parameter-resolver.test.js
```

Expected: fixture 测试全部 PASS，现有 1313 注入不变；注册测试保持 PASS。1408 在运行时归一化为 `window_list` 内容实例，并携带 drawing `out_wall_thickness=240`。

- [ ] **Step 8: 提交 Task 3**

```powershell
git add -- src/dev/SceneFixtures.js src/core/DataSource.js tests/scene-fixtures.test.js
git commit -m "feat: add opt-in 1408 scene fixture"
```

---

### Task 4: 全量回归、构建和本地 OCCT 浏览器检查点

**Files:**
- Verify only: `tests/*.test.js`
- Build only: `dist-3d/`

**Interfaces:**
- Consumes: Tasks 1-3 和模板 `1408 -> ResId 2406318`。
- Produces: 可由用户在本地 OCCT 页面确认的 1408 U 型窗；不产生 CAD plugin 修改或部署。

- [ ] **Step 1: 一起运行直接相关测试**

Run:

```powershell
node --test tests/content-template-resolver.test.js tests/parametric-parameter-resolver.test.js tests/content-model-placement.test.js tests/scene-fixtures.test.js
```

Expected: 所有用例 PASS，包括零资源尺寸使用模板 Height 的既有测试，以及新 1408 参数、放置和 fixture 测试。

- [ ] **Step 2: 运行完整 Node 测试套件**

Run:

```powershell
npm.cmd test
```

Expected: exit code 0，failed 0，cancelled 0；环境相关跳过项仅允许保持仓库既有数量。

- [ ] **Step 3: 构建本地 3D 前端**

Run:

```powershell
npm.cmd run build:3d
```

Expected: Vite exit code 0 并更新本工作树 `dist-3d`。不要运行 `deploy:3d`，不要复制到 CAD 或 AutoCAD cache。

- [ ] **Step 4: 启动或复用 4179 的 OCCT 3D 服务**

如果 4179 未由本工作树提供页面，运行：

```powershell
npm.cmd run dev:3d -- --host 127.0.0.1 --port 4179
```

打开：

```text
http://127.0.0.1:4179/index-3d.html?fixture=1408&codex=1408-ue-placement-20260729#debug
```

- [ ] **Step 5: 执行浏览器自动检查**

确认：

- 页面进入“就绪”，没有 ContentLoader failure；
- 模板选择为 `TypeId=1408`、`ResId=2406318`，资源类型为参数化 OBJ；
- conversion request 参数包含 `宽度/深度/左深/右深/左宽/右宽/高度/离地/墙厚`；
- 点击目标后控制台输出 `[ContentModel debug] TypeId=1408 instance=window_list:9`；
- 模型世界 Z 底部位于 900mm，主体竖直，不倒在地上。

- [ ] **Step 6: 交给用户完成视觉检查点**

请用户确认客厅南侧合成 U 型窗：三面形成 U 型、背面沿外墙、左臂比右臂长 220mm、模型没有镜像或反向、模型原点没有把整体推离洞口。在用户确认前，不开始下一个 TypeId，也不迁移或部署到 CAD plugin。
