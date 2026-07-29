# 1407 Corner Window Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make both `TypeId=1407` instances in `Drawing2.json` use the same corner anchor and local plan-axis orientation as the UE implementation.

**Architecture:** Preserve the drawing-level external wall thickness during content-instance normalization, then add a 1407-only placement plan in `ContentModelPlacement.js`. The placement plan derives UE's `MiddlePos`, corrected L-window size, and corner pivot from immutable CAD facts; a separate TDD cycle composes the parameterized OBJ's Y-axis compensation with the CAD vertical-flip value.

**Tech Stack:** JavaScript ES modules, Three.js 0.178, Node.js built-in test runner, Vite 6.

## Global Constraints

- Modify only `D:/occt_demo/.worktrees/cad-renderer-parametric-bridge` source, tests, docs, and local build output.
- Do not modify or deploy to `C:/Users/User/Desktop/cad_plugin` or the AutoCAD runtime cache.
- Restrict new production behavior to `TypeId=1407`; keep 1401, 140c, 140d02, and generic placement behavior unchanged.
- Preserve original CAD fields; `externalWallThickness` is a normalized read-only fact derived from top-level `out_wall_thickness`.
- Do not change resource mapping, parameterized API payloads, resource classification, or cache keys.
- Follow strict RED-GREEN TDD for every production-code change.
- Stop after the local OCCT checkpoint and wait for the user's visual confirmation.

---

### Task 1: Preserve Drawing-Level External Wall Thickness

**Files:**
- Modify: `src/components/ContentModelRegistry.js:1-141`
- Test: `tests/content-model-registry.test.js`

**Interfaces:**
- Consumes: top-level CAD JSON field `out_wall_thickness`.
- Produces: normalized instance property `externalWallThickness: number | null` for every valid `*_list` record.

- [ ] **Step 1: Write the failing normalization test**

Append this behavior test to `tests/content-model-registry.test.js`:

```js
test('preserves drawing-level external wall thickness on normalized instances', () => {
    const [item] = collectContentModelInstances({
        out_wall_thickness: 240,
        window_list: [block('1407')],
    });

    assert.equal(item.externalWallThickness, 240);
});
```

This test catches removal, renaming, or omission of the drawing-level wall-thickness propagation. Its expected value is a literal from the input and does not reuse production calculations.

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
node --test --test-name-pattern="external wall thickness" tests/content-model-registry.test.js
```

Expected: FAIL because `item.externalWallThickness` is `undefined`, not `240`.

- [ ] **Step 3: Pass the normalized context into each record**

Update `collectContentModelInstances` and `normalizeRecord` in `src/components/ContentModelRegistry.js`:

```js
export function collectContentModelInstances(json) {
    const result = [];
    const externalWallThickness = finiteNumber(json?.out_wall_thickness);
    for (const [sourceList, records] of Object.entries(json ?? {})) {
        if (!sourceList.endsWith('_list') || !Array.isArray(records)) continue;

        const descriptor = {
            sourceList,
            category: sourceList.slice(0, -'_list'.length),
        };
        records.forEach((record, sourceIndex) => {
            const item = normalizeRecord(
                record,
                descriptor,
                sourceIndex,
                externalWallThickness,
            );
            if (item) result.push(item);
        });
    }
    return result;
}

function normalizeRecord(record, descriptor, sourceIndex, externalWallThickness) {
```

Add the normalized field to the existing return object between `groundHeight` and `rawBlockInnerInfo`:

```js
        groundHeight,
        externalWallThickness,
        rawBlockInnerInfo,
```

- [ ] **Step 4: Run the focused and complete registry tests**

Run:

```powershell
node --test --test-name-pattern="external wall thickness" tests/content-model-registry.test.js
node --test tests/content-model-registry.test.js
```

Expected: both commands PASS with zero failures.

- [ ] **Step 5: Commit Task 1**

```powershell
git add -- src/components/ContentModelRegistry.js tests/content-model-registry.test.js
git commit -m "feat: preserve external wall thickness for content models"
```

---

### Task 2: Anchor 1407 Models at the UE Corner Pivot

**Files:**
- Modify: `src/components/ContentModelPlacement.js:32-180`
- Test: `tests/content-model-placement.test.js`

**Interfaces:**
- Consumes: `instance.basePoint`, `instance.footprint`, `instance.size`, `instance.rotationDegrees`, and `instance.externalWallThickness`.
- Produces: a 1407-only placement instance whose `basePoint` is the UE-equivalent L-corner pivot and whose anchor mode is `model-origin`.

- [ ] **Step 1: Add a real asymmetric corner-window prototype and literal Drawing2 fixtures**

Add these test utilities after `makePrototype()` in `tests/content-model-placement.test.js`:

```js
function makeCornerWindowPrototype() {
    const prototype = new THREE.Group();
    const geometry = new THREE.BoxGeometry(700, 1500, 1380);
    geometry.translate(350, 750, 690);
    prototype.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));

    const origin = new THREE.Object3D();
    origin.name = 'cornerOrigin';
    prototype.add(origin);
    return prototype;
}

const cornerWindowSelection = {
    ...selection,
    typeId: '1407',
    typeName: '转角窗',
    resId: '2406314',
    referenceSize: { x: 0, y: 0, z: 120 },
    xMirror: false,
};

const cornerWindowResource = {
    kind: 'parametric-obj',
    resourceType: 8,
    modelType: 0,
    contentHash: 'corner-window',
};

const cornerWindowFixtures = [
    {
        instance: {
            ...instance,
            instanceId: 'window_list:6',
            sourceList: 'window_list',
            sourceIndex: 6,
            category: 'window',
            typeId: '1407',
            basePoint: { x: -6638.686324, y: 2561.954562, z: 0 },
            footprint: [
                { x: -6638.686324, y: 2561.954562 },
                { x: -6638.686756, y: 3641.954562 },
                { x: -6878.686756, y: 3641.954466 },
                { x: -6878.686228, y: 2321.954466 },
                { x: -6203.686228, y: 2321.954736 },
                { x: -6203.686324, y: 2561.954736 },
            ],
            size: { x: 435, y: 1080, z: 1500 },
            rotationDegrees: 0.000022918312048469448,
            horizontalFlip: false,
            verticalFlip: false,
            groundHeight: 900,
            externalWallThickness: 240,
        },
        expectedPivot: { x: -6878.686227999973, y: 2321.9544660000515 },
    },
    {
        instance: {
            ...instance,
            instanceId: 'window_list:7',
            sourceList: 'window_list',
            sourceIndex: 7,
            category: 'window',
            typeId: '1407',
            basePoint: { x: -5768.686324, y: 2561.95491, z: 0 },
            footprint: [
                { x: -5768.686324, y: 2561.95491 },
                { x: -6203.686324, y: 2561.954736 },
                { x: -6203.686228, y: 2321.954736 },
                { x: -5528.686228, y: 2321.955006 },
                { x: -5528.686356, y: 2641.955006 },
                { x: -5768.686356, y: 2641.95491 },
            ],
            size: { x: 80, y: 435, z: 1500 },
            rotationDegrees: 90.00002445354664,
            horizontalFlip: false,
            verticalFlip: false,
            groundHeight: 900,
            externalWallThickness: 240,
        },
        expectedPivot: { x: -5528.686223712844, y: 2321.9550092154036 },
    },
];
```

- [ ] **Step 2: Write the failing corner-pivot test**

Append this test:

```js
test('1407 models anchor their source origin at the UE L-corner pivot', () => {
    for (const { instance: current, expectedPivot } of cornerWindowFixtures) {
        const root = placeContentModel(
            makeCornerWindowPrototype(),
            current,
            cornerWindowSelection,
            cornerWindowResource,
        );
        root.updateMatrixWorld(true);
        const origin = root.getObjectByName('cornerOrigin')
            .getWorldPosition(new THREE.Vector3());
        const box = worldBox(root);

        assertNear(origin.x, expectedPivot.x, `${current.instanceId} pivot x`);
        assertNear(origin.y, expectedPivot.y, `${current.instanceId} pivot y`);
        assertNear(origin.z, 900, `${current.instanceId} pivot z`);
        assertNear(box.min.z, 900, `${current.instanceId} sill height`);
    }
});
```

This test catches fallback to arithmetic-centroid anchoring, actual-model-bounds anchoring, or use of the unmodified CAD BasePoint.

- [ ] **Step 3: Run the test and verify RED**

Run:

```powershell
node --test --test-name-pattern="UE L-corner pivot" tests/content-model-placement.test.js
```

Expected: FAIL on the first pivot assertion. The current origin is centered against the footprint rather than placed at the literal UE pivot.

- [ ] **Step 4: Expose the footprint bounding-box center without changing generic centering**

In `footprintMetrics`, keep the existing arithmetic `center` property unchanged and add a second world-space property derived from the local axis-aligned bounds:

```js
const localBoundsCenter = {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
};
const forwardAngle = THREE.MathUtils.degToRad(finiteNumber(rotationDegrees));
const forwardCosine = Math.cos(forwardAngle);
const forwardSine = Math.sin(forwardAngle);
const boundsCenter = {
    x: originX + localBoundsCenter.x * forwardCosine
        - localBoundsCenter.y * forwardSine,
    y: originY + localBoundsCenter.x * forwardSine
        + localBoundsCenter.y * forwardCosine,
};

return { x: spanX, y: spanY, center, boundsCenter };
```

Generic placement must continue reading `footprint.center`; only the new 1407 branch reads `footprint.boundsCenter`.

- [ ] **Step 5: Add the 1407 corner-pivot calculation**

Add this focused helper before `resolvePlacementPlan`:

```js
function resolveCornerWindowPlacement(instance) {
    const footprint = footprintMetrics(
        instance?.footprint,
        rotationDegreesOf(instance),
        basePointOf(instance),
    );
    const sizeX = positiveNumber(instance?.size?.x);
    const sizeY = positiveNumber(instance?.size?.y);
    const wallThickness = positiveNumber(instance?.externalWallThickness);
    if (!footprint?.boundsCenter || !sizeX || !sizeY || !wallThickness) return null;

    const rotation = THREE.MathUtils.degToRad(rotationDegreesOf(instance));
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    const halfX = (sizeX + wallThickness) / 2;
    const halfY = (sizeY + wallThickness) / 2;
    const rotatedHalfX = halfX * cosine - halfY * sine;
    const rotatedHalfY = halfX * sine + halfY * cosine;
    const sourceBasePoint = basePointOf(instance);

    return {
        ...instance,
        basePoint: {
            x: footprint.boundsCenter.x - rotatedHalfX,
            y: footprint.boundsCenter.y - rotatedHalfY,
            z: finiteNumber(sourceBasePoint.z),
        },
        footprint: [],
    };
}
```

In `resolvePlacementPlan`, compute the existing effective horizontal flip once, then select the special plan only when the helper returns a complete result:

```js
const effectiveHorizontalFlip = Boolean(instance?.horizontalFlip)
    !== Boolean(selection?.xMirror);
if (String(instance?.typeId ?? '').trim() === '1407') {
    const cornerInstance = resolveCornerWindowPlacement(instance);
    if (cornerInstance) {
        return {
            instance: { ...cornerInstance, horizontalFlip: effectiveHorizontalFlip },
            effectiveHorizontalFlip,
            anchor: 'model-origin',
            arc: null,
        };
    }
}
```

Leave the existing generic return as the fallback.

- [ ] **Step 6: Verify GREEN and generic placement regression coverage**

Run:

```powershell
node --test --test-name-pattern="UE L-corner pivot" tests/content-model-placement.test.js
node --test tests/content-model-placement.test.js
```

Expected: both commands PASS. The existing generic center, BasePoint-corner, 1401, and 140c tests remain green.

- [ ] **Step 7: Commit Task 2**

```powershell
git add -- src/components/ContentModelPlacement.js tests/content-model-placement.test.js
git commit -m "fix: anchor 1407 windows at UE corner pivots"
```

---

### Task 3: Compose the 1407 OBJ Y-Axis Compensation with CAD Flips

**Files:**
- Modify: `src/components/ContentModelPlacement.js:32-480`
- Test: `tests/content-model-placement.test.js`

**Interfaces:**
- Consumes: the valid 1407 placement plan from Task 2 and the source CAD `verticalFlip` value.
- Produces: effective plan-space vertical flip `CAD vertical flip XOR 1407 OBJ compensation`, reflected accurately in placement debug data.

- [ ] **Step 1: Extend the corner prototype with independent axis markers**

Add the following markers inside `makeCornerWindowPrototype()` before `return prototype`:

```js
const xAxis = new THREE.Object3D();
xAxis.name = 'cornerXAxis';
xAxis.position.x = 100;
prototype.add(xAxis);

const yAxis = new THREE.Object3D();
yAxis.name = 'cornerYAxis';
// Source OBJ is Y-up. Source +Z becomes plan -Y after Y-up -> Z-up conversion.
yAxis.position.z = 100;
prototype.add(yAxis);
```

- [ ] **Step 2: Write the failing axis-direction test**

Append this test with literal UE-plan directions:

```js
test('1407 placement maps the parameterized OBJ axes to UE local positive X and Y', () => {
    const expectedDirections = [
        { x: { x: 1, y: 0 }, y: { x: 0, y: 1 } },
        { x: { x: 0, y: 1 }, y: { x: -1, y: 0 } },
    ];

    cornerWindowFixtures.forEach(({ instance: current }, index) => {
        const root = placeContentModel(
            makeCornerWindowPrototype(),
            current,
            cornerWindowSelection,
            cornerWindowResource,
        );
        root.updateMatrixWorld(true);
        const origin = root.getObjectByName('cornerOrigin')
            .getWorldPosition(new THREE.Vector3());
        const xDirection = root.getObjectByName('cornerXAxis')
            .getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
        const yDirection = root.getObjectByName('cornerYAxis')
            .getWorldPosition(new THREE.Vector3()).sub(origin).normalize();

        assertNear(xDirection.x, expectedDirections[index].x.x,
            `${current.instanceId} local X world x`);
        assertNear(xDirection.y, expectedDirections[index].x.y,
            `${current.instanceId} local X world y`);
        assertNear(yDirection.x, expectedDirections[index].y.x,
            `${current.instanceId} local Y world x`);
        assertNear(yDirection.y, expectedDirections[index].y.y,
            `${current.instanceId} local Y world y`);
        assert.equal(root.userData.debugInfo.transform.verticalFlip, true);
    });
});
```

This test catches removal of the frontend-specific OBJ compensation, application on the wrong plan axis, and a misleading debug value.

- [ ] **Step 3: Run the test and verify RED**

Run:

```powershell
node --test --test-name-pattern="UE local positive X and Y" tests/content-model-placement.test.js
```

Expected: FAIL because the current converted source +Z marker points along local negative Y and debug reports the source CAD `verticalFlip=false`.

- [ ] **Step 4: Compose the compensation only inside the valid 1407 plan**

In the valid 1407 branch from Task 2, change the effective instance construction to:

```js
instance: {
    ...cornerInstance,
    horizontalFlip: effectiveHorizontalFlip,
    verticalFlip: !Boolean(instance?.verticalFlip),
},
```

This is an XOR with the mandatory 1407 OBJ compensation: source `false` becomes effective `true`; source `true` becomes effective `false`. Invalid 1407 geometry still uses the generic branch and therefore receives no compensation.

- [ ] **Step 5: Make placement and debug use the same effective vertical flip**

In `placeContentModel`, derive the effective value once after `effectiveInstance`:

```js
const effectiveVerticalFlip = effectiveInstance?.verticalFlip === true;
```

Use it for the plan flip, double-sided material decision, and placement facts:

```js
planFlip.scale.set(
    effectiveHorizontalFlip ? -1 : 1,
    effectiveVerticalFlip ? -1 : 1,
    1,
);

if (effectiveHorizontalFlip || effectiveVerticalFlip) {
    markDoubleSide(clonedPrototype);
}

const placement = {
    rawSize,
    targetScale,
    modelOffset,
    worldPosition: contentRoot.getWorldPosition(new THREE.Vector3()),
    worldBox: new THREE.Box3().setFromObject(contentRoot),
    effectiveHorizontalFlip,
    effectiveVerticalFlip,
    rotationDegrees: rotationDegreesOf(effectiveInstance),
    arc: placementPlan.arc,
};
```

In `createContentDebugInfo`, derive and report the placement value with the same fallback convention used for horizontal flip:

```js
const effectiveVerticalFlip = typeof placement.effectiveVerticalFlip === 'boolean'
    ? placement.effectiveVerticalFlip
    : instance?.verticalFlip === true;

// In transform:
verticalFlip: effectiveVerticalFlip,
```

- [ ] **Step 6: Add the invalid-data fallback assertion**

Append this regression test:

```js
test('invalid 1407 geometry keeps generic placement without OBJ axis compensation', () => {
    const malformed = {
        ...cornerWindowFixtures[0].instance,
        footprint: [],
        externalWallThickness: null,
    };
    const root = placeContentModel(
        makeCornerWindowPrototype(),
        malformed,
        cornerWindowSelection,
        cornerWindowResource,
    );

    assert.equal(root.userData.debugInfo.transform.verticalFlip, false);
});
```

This passes before the compensation change and protects the documented fallback after the valid 1407 branch is changed.

- [ ] **Step 7: Verify GREEN and all placement tests**

Run:

```powershell
node --test --test-name-pattern="1407 placement|invalid 1407" tests/content-model-placement.test.js
node --test tests/content-model-placement.test.js
```

Expected: all focused and complete placement tests PASS with zero failures.

- [ ] **Step 8: Commit Task 3**

```powershell
git add -- src/components/ContentModelPlacement.js tests/content-model-placement.test.js
git commit -m "fix: align 1407 parameterized model axes with UE"
```

---

### Task 4: Full Regression, Build, and Local OCCT Checkpoint

**Files:**
- Verify only: all `tests/*.test.js`
- Build only: `dist-3d/`

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: a tested local OCCT 3D build ready for user visual confirmation; no CAD deployment.

- [ ] **Step 1: Run the directly related suites together**

Run:

```powershell
node --test tests/content-model-registry.test.js tests/parametric-parameter-resolver.test.js tests/content-model-placement.test.js
```

Expected: every test passes, including both existing 1407 parameter tests, existing 1401/140c placement tests, and the new 1407 placement tests.

- [ ] **Step 2: Run the complete Node test suite**

Run:

```powershell
npm.cmd test
```

Expected: exit code 0, zero failed tests, zero cancelled tests.

- [ ] **Step 3: Build the local 3D frontend**

Run:

```powershell
npm.cmd run build:3d
```

Expected: Vite exits with code 0 and writes the OCCT `dist-3d` build. Do not copy it into CAD or the AutoCAD cache.

- [ ] **Step 4: Start or reuse the local OCCT server**

If port 4179 is not already serving this worktree, run:

```powershell
npm.cmd run dev:3d -- --host 127.0.0.1 --port 4179
```

Open:

```text
http://127.0.0.1:4179/index-3d.html?codex=1407-ue-placement-20260729#debug
```

- [ ] **Step 5: Perform the automated browser sanity check**

Confirm in the local page that:

- the scene reaches the ready state;
- both `window_list[6]` and `window_list[7]` load as `typeId=1407`;
- no new model-loading or placement failure is logged;
- 1401 and 140c windows remain present.

- [ ] **Step 6: Hand the visual checkpoint to the user**

Ask the user to inspect the two adjoining 1407 corner-window pieces and confirm that both arms follow the wall openings instead of pointing into the room. Do not begin another TypeId change or any CAD deployment until the user confirms this checkpoint.
