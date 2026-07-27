# Scene Click Debug and Room Info Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `#debug` 模式下点击参数化软装输出可序列化的解析/放置快照，并让房间信息弹窗支持同房间二次点击关闭、跨房间复用切换。

**Architecture:** 新建一个无 DOM 依赖的 `SceneClickInteraction` 小模块，集中处理房间状态决策、参数化软装根节点解析和受控日志输出。`ParametricModelLoader` 在实例完成世界变换后挂载纯数据 `debugInfo`；`RoomInfoView` 用一次合并目标射线检测选择最近对象，再分流到模型日志或房间弹窗状态机。

**Tech Stack:** JavaScript ES modules、Three.js 0.178、原生 DOM、Node.js `node:test`、Vite 6。

## Global Constraints

- 模型点击日志仅在 `window.location.hash === '#debug'` 时启用。
- 不打印完整 Three.js `Mesh` / `Group` 对象，只打印可序列化的纯数据快照。
- 不把参数化软装接入 TransformControls，不改变模型几何、放置、材质或编辑行为。
- 房间与参数化软装必须依据同一次射线检测的最近命中对象仲裁，避免穿透模型打开底层房间。
- 房间弹窗 DOM 始终最多一个；切换房间只更新内容。
- 保留现有 5px 点击/拖拽阈值和房间俯视图交互。
- 使用现有 `npm test` 与 `npm run build:3d -- --emptyOutDir=false` 验证，不新增依赖。
- 当前工作树已有软装方向、基点和测试改动；实施时不得丢弃、覆盖或重置这些改动。

---

## File Structure

- Create: `src/components/SceneClickInteraction.js` — 纯交互决策、参数化实例根节点查找、Debug 开关判断和安全日志输出。
- Modify: `src/components/ParametricModelLoader.js` — 构造并挂载可序列化的实例级 `debugInfo`。
- Modify: `src/components/RoomInfoView.js` — 合并射线目标、按最近命中分流、维护 `activeRoomIndex`。
- Create: `tests/scene-click-interaction.test.js` — 房间状态机、模型根节点查找、Debug 日志开关测试。
- Create: `tests/parametric-model-debug-info.test.js` — 调试快照字段和可序列化性测试。

### Task 1: Scene Click Interaction Decisions

**Files:**
- Create: `src/components/SceneClickInteraction.js`
- Create: `tests/scene-click-interaction.test.js`

**Interfaces:**
- Produces: `decideRoomPanelAction(activeRoomIndex, panelVisible, clickedRoomIndex) -> { action: 'show'|'hide', roomIndex: number|null }`
- Produces: `findParametricSoftlistRoot(object) -> THREE.Object3D|null`
- Produces: `isSceneDebugEnabled(hash) -> boolean`
- Produces: `logParametricSoftlistDebug(root, hash, logger) -> boolean`

- [ ] **Step 1: Write failing tests for room state transitions**

Create `tests/scene-click-interaction.test.js` with:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
    decideRoomPanelAction,
    findParametricSoftlistRoot,
    isSceneDebugEnabled,
    logParametricSoftlistDebug,
} from '../src/components/SceneClickInteraction.js';

test('room panel opens, toggles off, and switches rooms', () => {
    assert.deepEqual(decideRoomPanelAction(null, false, 2), {
        action: 'show', roomIndex: 2,
    });
    assert.deepEqual(decideRoomPanelAction(2, true, 2), {
        action: 'hide', roomIndex: null,
    });
    assert.deepEqual(decideRoomPanelAction(2, true, 5), {
        action: 'show', roomIndex: 5,
    });
    assert.deepEqual(decideRoomPanelAction(2, true, null), {
        action: 'hide', roomIndex: null,
    });
});
```

- [ ] **Step 2: Run the room state test and verify RED**

Run: `node --test tests/scene-click-interaction.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `SceneClickInteraction.js`.

- [ ] **Step 3: Add failing tests for model-root lookup and debug logging**

Append to the same test file:

```js
test('a child mesh resolves to its parametric softlist instance root', () => {
    const root = new THREE.Group();
    root.userData = {
        type: 'parametric-softlist',
        debugInfo: { typeId: '101', softlistId: 'soft-1' },
    };
    const nested = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    root.add(nested);
    nested.add(mesh);

    assert.equal(findParametricSoftlistRoot(mesh), root);
    assert.equal(findParametricSoftlistRoot(new THREE.Mesh()), null);
});

test('model debug logging is gated by the exact #debug hash', () => {
    const root = new THREE.Group();
    root.userData.debugInfo = { typeId: '101', softlistId: 'soft-1' };
    const calls = [];
    const logger = {
        groupCollapsed: (...args) => calls.push(['groupCollapsed', ...args]),
        log: (...args) => calls.push(['log', ...args]),
        groupEnd: () => calls.push(['groupEnd']),
    };

    assert.equal(isSceneDebugEnabled(''), false);
    assert.equal(logParametricSoftlistDebug(root, '', logger), false);
    assert.equal(calls.length, 0);

    assert.equal(isSceneDebugEnabled('#debug'), true);
    assert.equal(logParametricSoftlistDebug(root, '#debug', logger), true);
    assert.equal(calls.filter(call => call[0] === 'log').length, 1);
    assert.deepEqual(calls.find(call => call[0] === 'log')[2], root.userData.debugInfo);
});
```

- [ ] **Step 4: Implement the minimal interaction helpers**

Create `src/components/SceneClickInteraction.js`:

```js
export function decideRoomPanelAction(activeRoomIndex, panelVisible, clickedRoomIndex) {
    if (clickedRoomIndex == null || (panelVisible && activeRoomIndex === clickedRoomIndex)) {
        return { action: 'hide', roomIndex: null };
    }
    return { action: 'show', roomIndex: clickedRoomIndex };
}

export function findParametricSoftlistRoot(object) {
    let current = object;
    while (current) {
        if (current.userData?.type === 'parametric-softlist' && current.userData?.debugInfo) {
            return current;
        }
        current = current.parent;
    }
    return null;
}

export function isSceneDebugEnabled(hash) {
    return hash === '#debug';
}

export function logParametricSoftlistDebug(root, hash, logger = console) {
    if (!isSceneDebugEnabled(hash) || !root?.userData?.debugInfo) return false;
    const info = root.userData.debugInfo;
    logger.groupCollapsed(`[软装调试] TypeId=${info.typeId ?? 'unknown'} 实例=${info.softlistId ?? 'unknown'}`);
    logger.log('模型信息', info);
    logger.groupEnd();
    return true;
}
```

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `node --test tests/scene-click-interaction.test.js`

Expected: 3 tests PASS.

- [ ] **Step 6: Commit the interaction helpers**

```powershell
git add -- src/components/SceneClickInteraction.js tests/scene-click-interaction.test.js
git commit -m "test: define scene click interaction states"
```

### Task 2: Serializable Parametric Model Debug Metadata

**Files:**
- Modify: `src/components/ParametricModelLoader.js:30-80, 414-505`
- Create: `tests/parametric-model-debug-info.test.js`

**Interfaces:**
- Produces: `createParametricDebugInfo(item, templateInfo, placement) -> object`
- Consumes in Task 3: `flipWrapper.userData.debugInfo`
- `placement` shape: `{ rawSize, baseScale, modelOffset, worldPosition, worldBox }`, where vector/box values may be Three.js objects and output is converted to plain numbers.

- [ ] **Step 1: Write the failing debug-info test**

Create `tests/parametric-model-debug-info.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { createParametricDebugInfo } from '../src/components/ParametricModelLoader.js';

test('parametric debug info captures source and placement data as plain values', () => {
    const item = {
        id: 'soft-7',
        typeId: '7001',
        basepoint: { x: 10, y: 20, z: 0 },
        footprint: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 200 }],
        rotate: 75,
        horizontalFlip: true,
        verticalFlip: false,
        modelParams: [{ name: 'width', value: 100 }],
    };
    const worldBox = new THREE.Box3(
        new THREE.Vector3(1, 2, 0),
        new THREE.Vector3(101, 202, 300),
    );

    const info = createParametricDebugInfo(
        item,
        { typeName: '测试柜体', resId: 'res-1', defaultSize: { x: 1, y: 2, z: 3 } },
        {
            rawSize: new THREE.Vector3(1, 2, 3),
            baseScale: 1000,
            modelOffset: new THREE.Vector3(-0.5, 0.25, 0),
            worldPosition: new THREE.Vector3(10, 20, 0),
            worldBox,
        },
    );

    assert.equal(info.typeId, '7001');
    assert.equal(info.softlistId, 'soft-7');
    assert.equal(info.typeName, '测试柜体');
    assert.equal(info.transform.rotate, 75);
    assert.equal(info.transform.horizontalFlip, true);
    assert.deepEqual(info.placement.rawSize, { x: 1, y: 2, z: 3 });
    assert.deepEqual(info.placement.worldBounds.size, { x: 100, y: 200, z: 300 });
    assert.doesNotThrow(() => JSON.stringify(info));
    assert.equal(Object.values(info).some(value => value?.isObject3D), false);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/parametric-model-debug-info.test.js`

Expected: FAIL because `createParametricDebugInfo` is not exported.

- [ ] **Step 3: Implement plain-value conversion and debug-info construction**

Add near the existing exported transform helpers in `ParametricModelLoader.js`:

```js
function vectorToPlain(vector) {
    return {
        x: Number(vector?.x ?? 0),
        y: Number(vector?.y ?? 0),
        z: Number(vector?.z ?? 0),
    };
}

function clonePlain(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function createParametricDebugInfo(item, templateInfo, placement) {
    const worldSize = placement.worldBox.getSize(new THREE.Vector3());
    return {
        typeId: String(item.typeId),
        softlistId: item.id ?? null,
        typeName: templateInfo.typeName ?? null,
        resId: templateInfo.resId ?? null,
        defaultSize: clonePlain(templateInfo.defaultSize ?? null),
        source: {
            basepoint: clonePlain(item.basepoint ?? null),
            footprint: clonePlain(item.footprint ?? []),
            modelParams: clonePlain(item.modelParams ?? []),
        },
        transform: {
            rotate: Number(item.rotate) || 0,
            horizontalFlip: item.horizontalFlip === true,
            verticalFlip: item.verticalFlip === true,
        },
        placement: {
            rawSize: vectorToPlain(placement.rawSize),
            baseScale: placement.baseScale,
            modelOffset: vectorToPlain(placement.modelOffset),
            worldPosition: vectorToPlain(placement.worldPosition),
            worldBounds: {
                min: vectorToPlain(placement.worldBox.min),
                max: vectorToPlain(placement.worldBox.max),
                size: vectorToPlain(worldSize),
            },
        },
    };
}
```

- [ ] **Step 4: Attach debug metadata after the instance has a world transform**

In `loadParametricModels`, keep the existing orientation/base-point placement code, then replace the current userData/add sequence with this ordering:

```js
flipWrapper.userData = {
    type: 'parametric-softlist',
    softlistId: item.id,
    typeId: tid,
};
flipWrapper.traverse(child => {
    if (child.isMesh) {
        child.userData.type = child.userData.type || 'parametric-softlist';
        child.userData.softlistId = child.userData.softlistId || item.id;
        child.userData.typeId = child.userData.typeId || tid;
    }
});

sceneGroup.add(flipWrapper);
flipWrapper.updateMatrixWorld(true);
const worldBox = new THREE.Box3().setFromObject(flipWrapper);
flipWrapper.userData.debugInfo = createParametricDebugInfo(
    item,
    templateModel.userData,
    {
        rawSize,
        baseScale,
        modelOffset: rawModel.position,
        worldPosition: flipWrapper.getWorldPosition(new THREE.Vector3()),
        worldBox,
    },
);
```

Keep `resultGroups.push(flipWrapper)` and `placedCount++` immediately afterward; remove the old duplicate `sceneGroup.add(flipWrapper)`.

- [ ] **Step 5: Run focused and existing model tests**

Run:

```powershell
node --test tests/parametric-model-debug-info.test.js tests/parametric-model-anchor.test.js tests/parametric-model-up-axis.test.js tests/softlist-orientation.test.js
```

Expected: all tests PASS.

- [ ] **Step 6: Commit the metadata change without staging unrelated files**

```powershell
git add -- src/components/ParametricModelLoader.js tests/parametric-model-debug-info.test.js
git diff --cached --check
git commit -m "feat: expose parametric model debug metadata"
```

### Task 3: Room Panel Toggle and Nearest-Hit Arbitration

**Files:**
- Modify: `src/components/RoomInfoView.js:1-92, 287-299`
- Modify: `tests/scene-click-interaction.test.js`

**Interfaces:**
- Consumes: `decideRoomPanelAction`, `findParametricSoftlistRoot`, and `logParametricSoftlistDebug` from Task 1.
- Consumes: instance-level `userData.debugInfo` from Task 2.
- Maintains: `RoomInfoView.activeRoomIndex: number|null`.

- [ ] **Step 1: Add a failing classification test for model-over-floor priority**

Extend `SceneClickInteraction.js` with the planned interface `classifySceneClick(object) -> { kind: 'model'|'room'|'none', ... }`, then first add this failing test to `tests/scene-click-interaction.test.js`:

```js
import { classifySceneClick } from '../src/components/SceneClickInteraction.js';

test('the nearest model hit is classified before an underlying room target', () => {
    const modelRoot = new THREE.Group();
    modelRoot.userData = {
        type: 'parametric-softlist',
        debugInfo: { typeId: '9', softlistId: 'soft-9' },
    };
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    modelRoot.add(mesh);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry());
    floor.userData = { type: 'floor', roomIndex: 3, roomInfo: { name: '客厅' } };

    assert.deepEqual(classifySceneClick(mesh), { kind: 'model', modelRoot });
    assert.deepEqual(classifySceneClick(floor), {
        kind: 'room', roomIndex: 3, roomInfo: floor.userData.roomInfo,
    });
    assert.deepEqual(classifySceneClick(new THREE.Object3D()), { kind: 'none' });
});
```

- [ ] **Step 2: Run the classification test and verify RED**

Run: `node --test tests/scene-click-interaction.test.js`

Expected: FAIL because `classifySceneClick` is not exported.

- [ ] **Step 3: Implement click classification**

Add to `SceneClickInteraction.js`:

```js
export function classifySceneClick(object) {
    const modelRoot = findParametricSoftlistRoot(object);
    if (modelRoot) return { kind: 'model', modelRoot };

    if (object?.userData?.type === 'floor' || object?.userData?.type === 'roomLabel') {
        return {
            kind: 'room',
            roomIndex: object.userData.roomIndex ?? null,
            roomInfo: object.userData.roomInfo ?? null,
        };
    }
    return { kind: 'none' };
}
```

- [ ] **Step 4: Replace RoomInfoView's room-only raycast with one merged nearest-hit decision**

At the top of `RoomInfoView.js`, import:

```js
import {
    classifySceneClick,
    decideRoomPanelAction,
    logParametricSoftlistDebug,
} from './SceneClickInteraction.js';
```

Initialize state in the constructor:

```js
this.activeRoomIndex = null;
```

Replace the target collection and hit handling in `_onClick` with:

```js
const targets = [];
this.sceneGroup.traverse(object => {
    const type = object.userData?.type;
    if (!object.visible) return;
    if (type === 'floor' || type === 'roomLabel' ||
        (type === 'parametric-softlist' && object.isMesh)) {
        targets.push(object);
    }
});

const hits = this.raycaster.intersectObjects(targets, false);
if (hits.length === 0) {
    this._hide();
    return;
}

const target = classifySceneClick(hits[0].object);
if (target.kind === 'model') {
    logParametricSoftlistDebug(target.modelRoot, window.location.hash);
    return;
}
if (target.kind !== 'room') {
    this._hide();
    return;
}
if (target.roomIndex == null || !target.roomInfo) {
    if (window.location.hash === '#debug') {
        console.warn('[房间信息] 命中对象缺少 roomIndex 或 roomInfo');
    }
    this._hide();
    return;
}

const decision = decideRoomPanelAction(
    this.activeRoomIndex,
    this._isPanelVisible(),
    target.roomIndex,
);
if (decision.action === 'hide') {
    this._hide();
    return;
}
this.activeRoomIndex = decision.roomIndex;
this._show(target.roomInfo, event.clientX, event.clientY);
```

- [ ] **Step 5: Make visibility and hide state explicit**

Add before `_hide()`:

```js
_isPanelVisible() {
    return this.panel?.style.display === 'block';
}
```

Replace `_hide()` with:

```js
_hide() {
    if (this.panel) this.panel.style.display = 'none';
    this.activeRoomIndex = null;
}
```

The existing close-button handler and `setEnabled(false)` already call `_hide()`, so they automatically clear state.

- [ ] **Step 6: Run all automated tests**

Run: `npm test`

Expected: all existing and new tests PASS with zero failures.

- [ ] **Step 7: Build the 3D frontend**

Run: `npm run build:3d -- --emptyOutDir=false`

Expected: Vite exits with code 0 and emits the 3D bundle without deleting `dist-3d/data`.

- [ ] **Step 8: Commit the room interaction change**

```powershell
git add -- src/components/RoomInfoView.js src/components/SceneClickInteraction.js tests/scene-click-interaction.test.js
git diff --cached --check
git commit -m "fix: toggle room info panel on repeated clicks"
```

### Task 4: Browser Interaction Verification

**Files:**
- Verify only: `index-3d.html`, `dist-3d/`
- Do not commit generated `dist-3d` files unless they are already tracked and intentionally changed by the repository workflow.

**Interfaces:**
- Consumes the complete behavior from Tasks 1-3.
- Produces manual verification evidence: console snapshot and observed panel state sequence.

- [ ] **Step 1: Start the 3D development server**

Run: `npm run dev:3d`

Expected: Vite reports `http://localhost:3030/` and remains running.

- [ ] **Step 2: Open the page in Debug mode and wait for model loading**

Open: `http://localhost:3030/index-3d.html#debug`

Wait until the status shows ready and parameterized-model loading completes. Preserve the existing viewport and camera unless a model is not visible.

- [ ] **Step 3: Verify room toggle and switching**

Perform and record this exact sequence:

1. Click room A: one `.room-info-panel` is visible and shows A.
2. Click room A again: the panel is hidden.
3. Click room A, then room B: the same panel element remains, content changes to B, and `document.querySelectorAll('.room-info-panel').length === 1`.
4. Click the close button: the panel hides; clicking B again reopens it.
5. Click empty scene space: the panel hides.

- [ ] **Step 4: Verify model debug output and click priority**

Click a visible parameterized soft model and confirm exactly one collapsed console group appears with:

- matching `typeId` and `softlistId`
- `source.basepoint`, `source.footprint`, and `source.modelParams`
- `transform.rotate`, `horizontalFlip`, and `verticalFlip`
- `placement.rawSize`, `baseScale`, `modelOffset`, `worldPosition`, and `worldBounds`

Confirm no room panel opens from the floor underneath the clicked model.

- [ ] **Step 5: Verify non-Debug mode and drag threshold**

Reload without the hash at `http://localhost:3030/index-3d.html`. Clear the console, click the same model, and confirm no `[软装调试]` group is added. Drag to orbit the camera by more than 5px and confirm it neither toggles a room panel nor logs a model.

- [ ] **Step 6: Run final verification from a clean command invocation**

Run:

```powershell
npm test
npm run build:3d -- --emptyOutDir=false
git diff --check
git status --short
```

Expected: tests and build exit 0; `git diff --check` reports no whitespace errors; status contains only the intended source/tests plus any previously existing user changes.

- [ ] **Step 7: Record verification in the final handoff**

Report the exact test count, successful 3D build, browser sequences verified, Debug URL used, and any unrelated pre-existing working-tree changes left untouched. Do not push without explicit user approval.
