# Remaining UE TypeId Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port every remaining source-visible UE special door, window, bay-window, railing, and door-window TypeId rule into the OCCT unified content renderer and verify them together.

**Architecture:** Add a small TypeId rule registry as the single dispatch boundary, then keep geometry, parameter, composite-expansion, and placement calculations in their existing focused modules. Preserve the current discovery, template selection, static/parameterized classification, loading, atomic composite placement, fallback, and debug APIs.

**Tech Stack:** JavaScript ES modules, Three.js, Node test runner, Vite, existing Node parametric API bridge, browser-based visual verification.

## Global Constraints

- Work only in `D:\occt_demo\.worktrees\cad-renderer-parametric-bridge` on branch `codex/ue-typeid-rendering`.
- Do not modify, deploy, stage, or commit any file under `C:\Users\User\Desktop\cad_plugin`.
- Follow only source-visible rules from UE C++ and `public/data/template.json`; do not guess binary data-table contents.
- Preserve behavior for `1313`, `1407`, `1408`, `140c`, and `140d02`.
- Preserve the unified `*_list` content pipeline and visible fallback on every selection, resource, conversion, or placement failure.
- Implement each behavior test-first and commit each task independently.

---

## File Structure

- Create `src/components/ContentTypeRules.js`: normalized TypeId registry, family lookup, and documented template aliases.
- Create `tests/content-type-rules.test.js`: complete registry and alias audit.
- Modify `src/components/ContentTemplateResolver.js`: consume template aliases without changing existing folding-door or cabinet mapping priority.
- Modify `src/components/FreeWindowSegmentAdapter.js`: general paired-path expansion for both free windows and railings while retaining its compatibility export.
- Modify `src/utils/json_parse.js`: call the generalized composite expansion entry point.
- Modify `src/components/CompositeContentPlacement.js`: recognize any validated generated composite parent, not only `140d02`.
- Modify `src/components/ParametricParameterResolver.js`: remaining window, bay-window, railing, and door-window parameters.
- Modify `src/components/ContentModelPlacement.js`: remaining UE artificial anchors, scale overrides, and offsets.
- Modify `src/dev/SceneFixtures.js`: individual family fixtures and combined `ue-specials` fixture.
- Create `tests/remaining-typeid-fixtures.test.js`: exact individual and combined fixture coverage.

### Task 1: Central TypeId Rule Registry

**Files:**
- Create: `src/components/ContentTypeRules.js`
- Create: `tests/content-type-rules.test.js`
- Modify: `src/components/ContentTemplateResolver.js`
- Test: `tests/content-template-resolver.test.js`

**Interfaces:**
- Produces: `contentTypeRuleFor(typeId: unknown): Readonly<ContentTypeRule> | null`
- Produces: `templateTypeIdAliasFor(typeId: unknown): string`
- `ContentTypeRule` fields: `typeId`, `family`, optional `templateTypeId`, optional `compositeParent`.
- Consumed later by parameter, composite, and placement dispatch.

- [ ] **Step 1: Write failing registry and template-alias tests**

```js
import {
    contentTypeRuleFor, templateTypeIdAliasFor,
} from '../src/components/ContentTypeRules.js';

test('audits every remaining source-visible UE TypeId family', () => {
    assert.deepEqual([
        '1402', '140a',
        '1403', '140302', '140303', '1404', '1405', '1406',
        '140e', '140e01', '140e02', '140f',
        '1305', '1311',
    ].map(typeId => contentTypeRuleFor(typeId)?.family), [
        'standard-window', 'standard-window',
        'bay-window', 'bay-window', 'bay-window', 'bay-window',
        'arc-bay-window', 'corner-bay-window',
        'railing-composite', 'straight-railing', 'arc-railing',
        'door-window', 'barn-door', 'pocket-door',
    ]);
    assert.equal(templateTypeIdAliasFor('140e01'), '140e');
    assert.equal(templateTypeIdAliasFor('140e02'), '140e02');
    assert.equal(contentTypeRuleFor('ordinary-soft'), null);
});
```

Add a resolver test asserting a generated `140e01` selects the `140e` template while a direct catalog TypeId still wins for every other existing mapping.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
node --test tests/content-type-rules.test.js tests/content-template-resolver.test.js
```

Expected: FAIL because `ContentTypeRules.js` and the `140e01 -> 140e` alias do not exist.

- [ ] **Step 3: Implement the immutable registry and resolver alias**

```js
const RULES = new Map([
    ['1402', { family: 'standard-window' }],
    ['140a', { family: 'standard-window' }],
    ['1403', { family: 'bay-window' }],
    ['140302', { family: 'bay-window' }],
    ['140303', { family: 'bay-window' }],
    ['1404', { family: 'bay-window' }],
    ['1405', { family: 'arc-bay-window' }],
    ['1406', { family: 'corner-bay-window' }],
    ['140e', { family: 'railing-composite', compositeParent: true }],
    ['140e01', { family: 'straight-railing', templateTypeId: '140e' }],
    ['140e02', { family: 'arc-railing' }],
    ['140f', { family: 'door-window' }],
    ['1305', { family: 'barn-door' }],
    ['1311', { family: 'pocket-door' }],
]);
```

Normalize with `String(typeId ?? '').trim()`, freeze each returned rule, and call `templateTypeIdAliasFor` in `mapCadTypeId` only after the existing folding-door, cabinet-style, and direct-catalog checks that UE already gives higher priority.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all focused tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/components/ContentTypeRules.js src/components/ContentTemplateResolver.js tests/content-type-rules.test.js tests/content-template-resolver.test.js
git commit -m "feat: register remaining UE content type rules"
```

### Task 2: Generalized Atomic Composite Expansion for Railings

**Files:**
- Modify: `src/components/FreeWindowSegmentAdapter.js`
- Modify: `src/utils/json_parse.js`
- Modify: `src/components/CompositeContentPlacement.js`
- Test: `tests/free-window-segment-adapter.test.js`
- Test: `tests/composite-content-placement.test.js`
- Test: `tests/content-model-scene-integration.test.js`

**Interfaces:**
- Produces: `expandCompositeContentInstances(instances: unknown): ContentModelInstance[]`
- Retains: `expandFreeWindowInstances(instances)` as a compatibility alias.
- Generated children retain `parentInstanceId`, `compositeSegmentIndex`, `compositeSegmentCount`, and `generatedFromTypeId`.

- [ ] **Step 1: Write failing railing expansion tests**

```js
test('expands a 140e parent into ordered straight and arc railing children', () => {
    const [straight, arc] = expandCompositeContentInstances([railingParent()]);
    assert.deepEqual([straight.typeId, arc.typeId], ['140e01', '140e02']);
    assert.deepEqual([straight.generatedFromTypeId, arc.generatedFromTypeId], ['140e', '140e']);
    assert.deepEqual([straight.compositeSegmentIndex, arc.compositeSegmentIndex], [0, 1]);
    assert.equal(straight.parentInstanceId, 'window_list:fixture-140e');
    assert.equal(arc.parentInstanceId, 'window_list:fixture-140e');
});

test('invalid 140e geometry returns the untouched parent and no partial child', () => {
    const parent = railingParent({ cadPath: [{ x: 0, y: 0 }] });
    assert.deepEqual(expandCompositeContentInstances([parent]), [parent]);
});
```

Add atomic-placement tests proving a `generatedFromTypeId: '140e'` group commits only when every child is placed and rolls every staged root back otherwise.

- [ ] **Step 2: Run focused composite tests and verify RED**

```powershell
node --test tests/free-window-segment-adapter.test.js tests/composite-content-placement.test.js tests/content-model-scene-integration.test.js
```

Expected: FAIL because only `140d02` is expanded and recognized as composite.

- [ ] **Step 3: Generalize paired-path expansion and composite recognition**

Refactor the existing path pairing into one internal function:

```js
function expandPairedPath(instance, {
    parentTypeId, straightTypeId, arcTypeId,
}) {
    // normalize paired front/back vertices, build all segment paths,
    // then return children only when every segment is valid.
}

export function expandCompositeContentInstances(instances) {
    if (!Array.isArray(instances)) return [];
    return instances.flatMap(instance => {
        const typeId = String(instance?.typeId ?? '').trim();
        if (typeId === '140d02') {
            return expandPairedPath(instance, {
                parentTypeId: '140d02', straightTypeId: '1401', arcTypeId: '140c',
            }) ?? [instance];
        }
        if (typeId === '140e') {
            return expandPairedPath(instance, {
                parentTypeId: '140e', straightTypeId: '140e01', arcTypeId: '140e02',
            }) ?? [instance];
        }
        return [instance];
    });
}

export const expandFreeWindowInstances = expandCompositeContentInstances;
```

Railing straight-child `basePoint`, rotation, length, thickness, height, and ground height use the same adjusted four-point segment facts. Arc children keep the four-point bulge path. Replace the parser call with `expandCompositeContentInstances`.

Change `isCompositeChild` to accept any non-empty `generatedFromTypeId`, while retaining the strict parent id, count, index, and instance-id validation already performed by `createCompositeStates`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all focused tests PASS, including unchanged free-window tests.

- [ ] **Step 5: Commit**

```powershell
git add src/components/FreeWindowSegmentAdapter.js src/utils/json_parse.js src/components/CompositeContentPlacement.js tests/free-window-segment-adapter.test.js tests/composite-content-placement.test.js tests/content-model-scene-integration.test.js
git commit -m "feat: expand UE railing composites atomically"
```

### Task 3: Remaining Rectangular, Bay, Corner, and Door-Window Parameters

**Files:**
- Modify: `src/components/ParametricParameterResolver.js`
- Test: `tests/parametric-parameter-resolver.test.js`

**Interfaces:**
- Consumes: `contentTypeRuleFor(typeId)` from Task 1.
- Produces: the existing `resolveParametricParameters(instance, selection): Array<{name: string, value: number|string}>`.

- [ ] **Step 1: Write failing parameter tests**

Add exact tests using Unicode escapes to avoid source-encoding ambiguity:

```js
test('140302 selects the visible side from vertical flip', () => {
    const right = resolveParametricParameters(bayWindow('140302', false), selection({}));
    const left = resolveParametricParameters(bayWindow('140302', true), selection({}));
    assert.equal(valueOf(right, '\u7a97\u6237\u7c7b\u578b'), '\u53f3\u4fa7\u73bb\u7483');
    assert.equal(valueOf(left, '\u7a97\u6237\u7c7b\u578b'), '\u5de6\u4fa7\u73bb\u7483');
    assert.equal(valueOf(left, '\u6321\u677f'), '\u5de6\u4fa7\u6321\u677f');
});

test('1406 resolves UE left and right bay dimensions', () => {
    const values = resolveParametricParameters(cornerBayWindow(), selection({}));
    assert.equal(valueOf(values, '\u5de6\u5bbd'), 1200);
    assert.equal(valueOf(values, '\u53f3\u5bbd'), 900);
    assert.equal(valueOf(values, '\u5de6\u5899\u539a'), 240);
    assert.equal(valueOf(values, '\u53f3\u5899\u539a'), 180);
});

test('140f keeps UE door-window source and derived height values', () => {
    const values = resolveParametricParameters(doorWindow(), selection({}));
    assert.equal(valueOf(values, '\u95e8\u9ad8'), 2100);
    assert.equal(valueOf(values, '\u7a97\u9ad8'), 600);
    assert.equal(valueOf(values, '\u603b\u9ad8\u5ea6'), 2700);
});
```

Also test `1402`, `1403`, `140303`, `1404`, and `1405` receive standard width, height, ground, and wall-thickness values, and that missing required values are omitted rather than converted to zero.

- [ ] **Step 2: Run the parameter tests and verify RED**

```powershell
node --test tests/parametric-parameter-resolver.test.js
```

Expected: FAIL on the new type-family parameters and string-valued side selection.

- [ ] **Step 3: Add family parameter adapters**

Add a bounded text helper and dispatch by registry family:

```js
function setText(target, name, value) {
    if (!name || typeof value !== 'string' || value.length === 0) return;
    target.set(name, value);
}

function addBayWindowParameters(target, instance, block) {
    addStandardWindowParameters(target, block);
    if (String(instance?.typeId) !== '140302') return;
    const left = instance?.verticalFlip === true;
    setText(target, '\u7a97\u6237\u7c7b\u578b', left ? '\u5de6\u4fa7\u73bb\u7483' : '\u53f3\u4fa7\u73bb\u7483');
    setText(target, '\u6321\u677f', left ? '\u5de6\u4fa7\u6321\u677f' : '\u53f3\u4fa7\u6321\u677f');
}
```

For `1406`, reuse the winding-aware corner-side calculation already used by `1407`, including ground height. For `140f`, copy the named source values and derive total height exactly as UE: if the type contains `无副窗`, total height is door height; otherwise it is door height plus window height. Do not use coercible non-finite strings.

- [ ] **Step 4: Run the parameter tests and verify GREEN**

Run the Step 2 command. Expected: all parameter tests PASS and the 64-entry limit remains intact.

- [ ] **Step 5: Commit**

```powershell
git add src/components/ParametricParameterResolver.js tests/parametric-parameter-resolver.test.js
git commit -m "feat: resolve remaining UE opening parameters"
```

### Task 4: Arc Railing Parameters and Placement

**Files:**
- Modify: `src/components/ParametricParameterResolver.js`
- Modify: `src/components/ContentModelPlacement.js`
- Test: `tests/parametric-parameter-resolver.test.js`
- Test: `tests/content-model-placement.test.js`

**Interfaces:**
- Consumes: generated `140e02` four-point `cadPath` from Task 2.
- Produces: arc-railing parameter facts and a model-origin placement plan.

- [ ] **Step 1: Write failing arc-railing tests**

```js
test('140e02 adds UE radius and major-minor arc parameters', () => {
    const values = resolveParametricParameters(arcRailing(), selection({}));
    assertNear(valueOf(values, '\u534a\u5f84'), expectedRadius + 25);
    assert.equal(valueOf(values, '\u4f18\u52a3\u5f27'), '\u52a3\u5f27');
});

test('140e02 anchors at the chord midpoint instead of the arc apex', () => {
    const root = placeContentModel(prototype(), arcRailing(), selection(), resource());
    assertNear(root.position.x, (innerStart.x + innerEnd.x) / 2);
    assertNear(root.position.y, (innerStart.y + innerEnd.y) / 2);
    assertNear(worldBottom(root), arcRailing().groundHeight);
});
```

Include a major-arc case, a minor-arc case, and invalid/missing bulge geometry.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
node --test --test-name-pattern="140e02" tests/parametric-parameter-resolver.test.js tests/content-model-placement.test.js
```

Expected: FAIL because `140e02` has neither an arc adapter nor chord-center placement.

- [ ] **Step 3: Implement UE arc-railing rules**

Reuse `describeBulgeArc(path[3], path[0])` and add:

```js
setFinite(target, '\u5f26\u957f', arc.chordLength);
setFinite(target, '\u62f1\u9ad8', arc.sagitta);
setFinite(target, '\u7a97\u6247\u6570\u91cf', Math.max(1, Math.ceil(arc.arcLength / 600)));
setFinite(target, '\u534a\u5f84', arc.radius + 25);
setText(target, '\u4f18\u52a3\u5f27', Math.abs(arc.signedSweepRadians) > Math.PI
    ? '\u4f18\u5f27' : '\u52a3\u5f27');
```

For placement, retain the same imported-axis facing compensation as `140c`, but set base point to the midpoint of `path[3]` and `path[0]`, clear plan flips, clear the footprint, and anchor at `model-origin`. Invalid arc geometry throws `MODEL_SIZE_UNRESOLVED`, retaining the parent fallback through atomic placement.

- [ ] **Step 4: Run focused and related arc tests**

```powershell
node --test tests/arc-window-geometry.test.js tests/parametric-parameter-resolver.test.js tests/content-model-placement.test.js
```

Expected: all tests PASS, including existing `140c` orientation tests.

- [ ] **Step 5: Commit**

```powershell
git add src/components/ParametricParameterResolver.js src/components/ContentModelPlacement.js tests/parametric-parameter-resolver.test.js tests/content-model-placement.test.js
git commit -m "feat: render UE arc railing segments"
```

### Task 5: Bay and Corner-Bay Artificial Anchors

**Files:**
- Modify: `src/components/ContentModelPlacement.js`
- Test: `tests/content-model-placement.test.js`

**Interfaces:**
- Consumes: registry family and normalized `instance.size`, `instance.footprint`, rotation, flips, and raw side parameters.
- Produces: special placement plans with `anchor: 'model-origin'`.

- [ ] **Step 1: Write failing placement matrix tests**

```js
for (const typeId of ['1403', '140302', '140303', '1404']) {
    test(`${typeId} aligns the UE bay-window artificial bottom center`, () => {
        const root = placeContentModel(prototype(), bayWindow(typeId), selection(), resource());
        assertVectorNear(worldFootprintCenter(root), cadFootprintCenter(bayWindow(typeId)));
        assertNear(worldBottom(root), bayWindow(typeId).groundHeight);
    });
}

test('1406 aligns its left and right artificial spans after both plan flips', () => {
    const root = placeContentModel(prototype(), cornerBayWindow({
        horizontalFlip: true, verticalFlip: true,
    }), selection(), resource());
    assertVectorNear(worldArtificialCenter(root), cadFootprintCenter(cornerBayWindow()));
});
```

Add invalid geometry cases that prove the generic visible-fallback path remains available.

- [ ] **Step 2: Run focused placement tests and verify RED**

```powershell
node --test --test-name-pattern="1403|1404|1406" tests/content-model-placement.test.js
```

Expected: FAIL because generic bounds-center placement does not match UE artificial boxes.

- [ ] **Step 3: Implement bay and corner-bay placement plans**

For `1403`, `140302`, `140303`, and `1404`, compute the local artificial box:

```js
const boxMin = { x: -sizeX / 2, y: sizeY };
const boxMax = { x: sizeX / 2, y: 0 };
```

Apply effective local plan flips to its center, rotate it by CAD rotation, and shift model origin so the artificial center equals the CAD footprint bounds center.

For `1406`, derive winding-aware left/right values and compute:

```js
const boxMin = { x: 0, y: rightWidth + rightWallThickness };
const boxMax = { x: leftWidth + leftWallThickness, y: 0 };
```

Use the same flip/rotation compensation and model-origin anchor. Keep parameterized unit normalization; do not force the converted OBJ to the footprint a second time.

- [ ] **Step 4: Run the complete placement suite**

```powershell
node --test tests/content-model-placement.test.js
```

Expected: all placement tests PASS, including existing `1313`, `1407`, `1408`, and `140c` cases.

- [ ] **Step 5: Commit**

```powershell
git add src/components/ContentModelPlacement.js tests/content-model-placement.test.js
git commit -m "feat: align UE bay window model anchors"
```

### Task 6: Arc-Bay, Barn-Door, Pocket-Door, and Door-Window Placement

**Files:**
- Modify: `src/components/ContentModelPlacement.js`
- Test: `tests/content-model-placement.test.js`

**Interfaces:**
- Consumes: existing target-size, raw-model-bounds, output scale, TypeId family, and raw named parameters.
- Produces: scale and center-offset overrides without changing the public `placeContentModel` signature.

- [ ] **Step 1: Write failing UE scale and offset tests**

Cover these exact outcomes:

```js
test('1405 keeps parametric unit normalization and shifts from CAD box center to arc-bay center', () => {
    const root = placeContentModel(arcBayPrototype(), arcBayWindow(), selection(), parametricResource());
    assertUniformUnitNormalization(root);
    assertNear(localCenterOffset(root).y, -arcBayWindow().size.x / 4);
});

test('1305 ports UE barn-door tuned scale and wall-side offset', () => {
    const root = placeContentModel(prototype(), barnDoor(), selection(), staticResource());
    assertVectorNear(effectiveScale(root), expectedBarnDoorScale());
    assertVectorNear(worldCenter(root), expectedBarnDoorCenter());
});

test('1311 subtracts outer edge length and adds the UE 100mm clearance', () => {
    const root = placeContentModel(prototype(), pocketDoor(), selection(), staticResource());
    assertNear(worldWidth(root), pocketDoor().size.x - outerEdgeLength + 100);
});

test('140f uses the derived UE total height without applying CAD size twice', () => {
    const root = placeContentModel(prototype(), doorWindow(), selection(), parametricResource());
    assertNear(root.userData.debugInfo.placement.worldBounds.size.z, 2700);
});
```

Add flip variants for `1305` and `1311`, plus a `140f` `无副窗` case.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
node --test --test-name-pattern="1405|1305|1311|140f" tests/content-model-placement.test.js
```

Expected: FAIL on special center, scale, or derived height assertions.

- [ ] **Step 3: Implement minimal family overrides**

- `1405`: parameterized resources keep uniform unit normalization; static resources fit X/Z only and retain the imported semicircle Y proportion with UE Y sign. Shift the local target center by `-size.x / 4` along the model's corrected local Y direction.
- `1305`: port the UE tuned dimensions in scene millimeters: X uses `2 * size.x + 500`, Y uses `size.y + 50`, Z uses `size.z + 150`; apply the UE output-scale signs and shift by half wall depth and half opening length after rotation.
- `1311`: use opening length `size.x - outerEdgeLength + 100` and shift the local X center by `(outerEdgeLength - 100) / 2`.
- `140f`: use the Task 3 derived total height as the CAD Z target only for static content; parameterized content receives it as a conversion parameter and keeps uniform unit normalization.

Every override returns `null` when required numbers are absent so the existing generic plan or visible fallback handles the record deterministically.

- [ ] **Step 4: Run placement and loader regressions**

```powershell
node --test tests/content-model-placement.test.js tests/content-model-loader.test.js tests/parametric-parameter-resolver.test.js
```

Expected: all tests PASS and parameterized models are not double-scaled.

- [ ] **Step 5: Commit**

```powershell
git add src/components/ContentModelPlacement.js tests/content-model-placement.test.js
git commit -m "feat: port remaining UE model placement overrides"
```

### Task 7: Individual and Combined Debug Fixtures

**Files:**
- Modify: `src/dev/SceneFixtures.js`
- Modify: `tests/scene-fixtures.test.js`
- Create: `tests/remaining-typeid-fixtures.test.js`

**Interfaces:**
- Retains: `applySceneFixture(drawing, fixtureName)`.
- Adds exact fixture names: `140302`, `1405`, `1406`, `140e`, `140f`, `1305`, `1311`, and `ue-specials`.

- [ ] **Step 1: Write failing fixture tests**

```js
test('fixture=ue-specials appends every remaining geometric family without mutating Drawing2', async () => {
    const source = minimalDrawing();
    const result = await withFixture(drawingSource(source), '?fixture=ue-specials').loadDrawing();
    assert.deepEqual(result.window_list.slice(-6).map(item => item.TypeId), [
        '140302', '1405', '1406', '140e', '140f', '1402',
    ]);
    assert.deepEqual(result.door_list.slice(-2).map(item => item.TypeId), ['1305', '1311']);
    assert.notEqual(result, source);
    assert.deepEqual(source, minimalDrawing());
});
```

For every individual fixture, assert exact TypeId, point count, dimensions, asymmetric values, flips, and that similar query strings do not activate it.

- [ ] **Step 2: Run fixture tests and verify RED**

```powershell
node --test tests/scene-fixtures.test.js tests/remaining-typeid-fixtures.test.js
```

Expected: FAIL because the fixtures do not exist.

- [ ] **Step 3: Add wall-aware immutable fixtures**

Create frozen source records and clone helpers. Use known Drawing2 wall segments and keep each back strip within its wall slab. Use:

- asymmetric left/right spans for `1406`;
- explicit vertical-flip variants for `140302`;
- nonzero bulges for `1405` and `140e`;
- distinct door, window, and sub-window heights for `140f`;
- explicit outer-edge length for `1311`;
- a visible wall-side offset for `1305`.

`ue-specials` appends the same cloned records as the exact individual fixtures; it never reuses mutable object references.

- [ ] **Step 4: Run fixture, parser, and coverage tests**

```powershell
node --test tests/scene-fixtures.test.js tests/drawing2-content-coverage.test.js tests/content-model-registry.test.js
```

Expected: all tests PASS and the unmodified Drawing2 coverage remains unchanged.

- [ ] **Step 5: Commit**

```powershell
git add src/dev/SceneFixtures.js tests/scene-fixtures.test.js tests/remaining-typeid-fixtures.test.js
git commit -m "feat: add combined UE TypeId fixtures"
```

### Task 8: Full Audit, Real Resource Verification, and Browser Handoff

**Files:**
- Modify only if the audit finds a source-visible gap: files already listed in Tasks 1-7 and their focused tests.
- Update: `docs/superpowers/specs/2026-07-29-remaining-ue-typeid-rules-design.md` only when verified implementation facts differ from the approved design.

**Interfaces:**
- No new public API.
- Produces final evidence: clean diff, passing tests/build, per-TypeId resource outcomes, and browser handoff.

- [ ] **Step 1: Run the source-visible UE coverage audit**

```powershell
rg -n "TypeId\(\).*TEXT\(\"(13|14)|TypeId\s*==\s*TEXT\(\"(13|14)|TypeID\s*==\s*\"(13|14)" D:\view3d\BIMRunTime\Source\BIMRunTime\BuildHome\Private\Designer -g "*.cpp" -g "*.h"
node --test tests/content-type-rules.test.js tests/content-template-resolver.test.js
```

Compare every source-visible special branch with the registry test. Add a failing test before fixing any genuine gap. Do not decode or infer unavailable table rows.

- [ ] **Step 2: Run the complete automated verification**

```powershell
npm.cmd test
npm.cmd run build:3d
git diff --check
git status --short
```

Expected: all environment-independent tests PASS; CAD-native tests may skip only when their documented external path variables are absent; Vite build succeeds; diff check is clean.

- [ ] **Step 3: Verify real resource resolution and conversion**

Start or reuse the OCCT development backend on `127.0.0.1:3100`. Open:

```text
http://127.0.0.1:4179/index-3d.html?fixture=ue-specials&codex=remaining-ue-types-20260729#debug
```

For every fixture, record mapped template TypeId, ResId, static/parameterized kind, conversion result, placement result, and sanitized failure code. A backend resource unavailable for business reasons keeps its fallback and is reported separately; it must not hide failures in other types.

- [ ] **Step 4: Perform browser visual checks**

Verify:

- all loaded models stand upright;
- all wall-bound backs are inside or aligned with the wall slab;
- `140302` flip variants swap the correct side;
- `1405` remains a semicircle and is centered correctly;
- `1406` left/right spans are not swapped;
- `140e` straight and arc children form one continuous atomic railing;
- `140f` door, window, and optional sub-window heights are coherent;
- `1305` and `1311` sit on the intended wall side;
- clicking each loaded model under `#debug` reports its original and mapped TypeIds.

Keep the combined fixture tab as a handoff for user validation.

- [ ] **Step 5: Commit any audit-only corrections**

If Step 1 found and fixed a genuine gap:

```powershell
git add src/components/ContentTypeRules.js src/components/ContentTemplateResolver.js src/components/FreeWindowSegmentAdapter.js src/components/CompositeContentPlacement.js src/components/ParametricParameterResolver.js src/components/ContentModelPlacement.js src/dev/SceneFixtures.js src/utils/json_parse.js tests/content-type-rules.test.js tests/content-template-resolver.test.js tests/free-window-segment-adapter.test.js tests/composite-content-placement.test.js tests/content-model-scene-integration.test.js tests/parametric-parameter-resolver.test.js tests/content-model-placement.test.js tests/scene-fixtures.test.js tests/remaining-typeid-fixtures.test.js
git commit -m "fix: complete UE TypeId rule coverage"
```

If no correction was necessary, do not create an empty commit.

- [ ] **Step 6: Report the batch checkpoint**

Report:

- implemented TypeIds grouped by family;
- commit ids;
- exact automated test and build totals;
- real-resource successes and retained fallbacks;
- the combined validation URL;
- explicit confirmation that `cad_plugin` was untouched.
