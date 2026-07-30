# Zstd Material Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render converted parameterized OBJ materials from the zstd `material` metadata, with deterministic glass, paint, grout, frame, tiling, material-library, static-model, and parameterized-model semantics and no material-detail network request.

**Architecture:** `ContentMaterialSemantics.js` is a pure protocol adapter plus a small Three.js application layer. `ContentModelLoader` parses OBJ and invokes that adapter directly with `converted.material`; placement continues to clone glass materials per instance so cached prototypes stay immutable. Unsupported metadata preserves the source material and is exposed through `userData` for debugging.

**Tech Stack:** JavaScript ES modules, Three.js, Node.js built-in test runner, Vite.

## Global Constraints

- Modify only `D:\occt_demo\.worktrees\cad-renderer-parametric-bridge`; do not modify `cad_plugin`.
- Preserve unrelated working-tree changes and stage only the files named by each task.
- Remove `getMaterialDetails` and all dependency on `/api/getContentMaterialDetails`.
- Keep the existing `modelUrlToObj` request payload and model cache keys unchanged.
- Do not add a PAK converter, texture downloader, or new runtime dependency.
- Treat `BimRenderMat`, `IsModel`, `MatName`, and `ID` from the converted response as authoritative.
- Follow red-green-refactor: every production change requires a failing test observed first.

---

## File Structure

- `src/components/ContentMaterialSemantics.js`: normalize protocol entries, classify them, parse `MTLCOLOR`, attach metadata, and apply local paint/grout properties.
- `tests/content-material-semantics.test.js`: direct protocol and Three.js behavior tests.
- `src/components/ContentModelLoader.js`: call the semantic router without requesting material details.
- `tests/content-model-loader.test.js`: prove converted metadata is consumed and no secondary request is made.
- `src/services/ParametricApiClient.js`: remove the obsolete material-detail client surface.
- `tests/parametric-api-client.test.js`: remove the obsolete endpoint contract test while retaining existing goods/model tests.
- `src/components/WindowGlassMaterial.js`: consume semantic glass markers with legacy name fallback.
- `tests/window-glass-material.test.js`: prove glass cloning, opacity, frame preservation, and cache safety.
- `tests/content-model-placement.test.js`: integration coverage for per-instance glass cloning.

---

### Task 1: Normalize and classify converted material metadata

**Files:**
- Create: `tests/content-material-semantics.test.js`
- Modify: `src/components/ContentMaterialSemantics.js`

**Interfaces:**
- Produces: `normalizeContentMaterialEntries(raw): Array<NormalizedContentMaterial>`
- Produces: `classifyContentMaterial(entry): string`
- Produces: `parseMtlColor(matName): { color: number, opacity: number | null } | null`
- `NormalizedContentMaterial` contains `materialName`, `code`, `isModel`, `bimRenderMat`, `category`, and `source`.

- [ ] **Step 1: Write failing normalization and classification tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    classifyContentMaterial,
    normalizeContentMaterialEntries,
    parseMtlColor,
} from '../src/components/ContentMaterialSemantics.js';

test('normalizes object-map material metadata and uses the key when MatName is absent', () => {
    const entries = normalizeContentMaterialEntries({
        glass_uuid: { ID: 'PT1', IsModel: 'false', BimRenderMat: '3' },
    });
    assert.deepEqual(entries.map(({ materialName, code, isModel, bimRenderMat, category }) => ({
        materialName, code, isModel, bimRenderMat, category,
    })), [{
        materialName: 'glass_uuid', code: 'PT1', isModel: false,
        bimRenderMat: 3, category: 'glass',
    }]);
});

test('classifies every documented BimRender material combination', () => {
    const cases = [
        [0, false, 'tiling'], [1, false, 'paint'], [2, false, 'grout'],
        [3, false, 'glass'], [4, false, 'window-frame-loft'],
        [5, false, 'material-library'], [0, true, 'static-model'],
        [6, true, 'parametric-model'], [6, false, 'unknown'],
    ];
    for (const [bimRenderMat, isModel, expected] of cases) {
        assert.equal(classifyContentMaterial({ bimRenderMat, isModel }), expected);
    }
});

test('parses RRGGBB and AARRGGBB MTLCOLOR markers', () => {
    assert.deepEqual(parseMtlColor('MTLCOLOR336699_wall'), { color: 0x336699, opacity: null });
    assert.deepEqual(parseMtlColor('prefix_MTLCOLOR80336699_wall'), {
        color: 0x336699, opacity: 128 / 255,
    });
    assert.equal(parseMtlColor('MTLCOLOR-not-hex'), null);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test tests/content-material-semantics.test.js`

Expected: FAIL because the three named exports do not yet exist.

- [ ] **Step 3: Implement minimal normalization, classification, and color parsing**

```js
const CATEGORY_BY_KEY = new Map([
    ['0:false', 'tiling'], ['1:false', 'paint'], ['2:false', 'grout'],
    ['3:false', 'glass'], ['4:false', 'window-frame-loft'],
    ['5:false', 'material-library'], ['0:true', 'static-model'],
    ['6:true', 'parametric-model'],
]);

function booleanValue(value) {
    return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
}

export function classifyContentMaterial({ bimRenderMat, isModel }) {
    return CATEGORY_BY_KEY.get(`${Number(bimRenderMat)}:${Boolean(isModel)}`) ?? 'unknown';
}

export function parseMtlColor(matName) {
    const match = String(matName ?? '').match(/MTLCOLOR([0-9a-f]{6}|[0-9a-f]{8})(?:_|$)/i);
    if (!match) return null;
    const hex = match[1];
    return {
        color: Number.parseInt(hex.slice(-6), 16),
        opacity: hex.length === 8 ? Number.parseInt(hex.slice(0, 2), 16) / 255 : null,
    };
}
```

Normalize arrays with their `MatName`; normalize object maps with `MatName || objectKey`. Preserve the original entry as `source` and compute `category` using `classifyContentMaterial`.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `node --test tests/content-material-semantics.test.js`

Expected: PASS with three tests.

- [ ] **Step 5: Commit the protocol adapter**

```powershell
git add src/components/ContentMaterialSemantics.js tests/content-material-semantics.test.js
git commit -m "feat: classify converted material metadata"
```

---

### Task 2: Apply semantic metadata and local material properties

**Files:**
- Modify: `tests/content-material-semantics.test.js`
- Modify: `src/components/ContentMaterialSemantics.js`

**Interfaces:**
- Consumes: `normalizeContentMaterialEntries(raw)` from Task 1.
- Produces: `applyContentMaterialSemantics(root, raw): THREE.Object3D`.
- Stores unmatched model entries in `root.userData.contentModelMaterials`.

- [ ] **Step 1: Add failing application tests**

```js
import * as THREE from 'three';
import { applyContentMaterialSemantics } from '../src/components/ContentMaterialSemantics.js';

function meshWithMaterial(name) {
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 });
    material.name = name;
    return new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
}

test('applies paint, grout, glass, frame and PT semantics by MatName', () => {
    const root = new THREE.Group();
    const paint = meshWithMaterial('MTLCOLOR336699_wall');
    const grout = meshWithMaterial('MTLCOLORFFCCAA_joint');
    const glass = meshWithMaterial('glass_uuid');
    const frame = meshWithMaterial('frame_uuid');
    const library = meshWithMaterial('library_uuid');
    root.add(paint, grout, glass, frame, library);
    applyContentMaterialSemantics(root, {
        paint: { MatName: paint.material.name, BimRenderMat: 1, IsModel: false },
        grout: { MatName: grout.material.name, BimRenderMat: 2, IsModel: false },
        glass: { MatName: glass.material.name, BimRenderMat: 3, IsModel: false },
        frame: { MatName: frame.material.name, BimRenderMat: 4, IsModel: false },
        library: { MatName: library.material.name, ID: 'PT9', BimRenderMat: 5, IsModel: false },
    });
    assert.equal(paint.material.color.getHex(), 0x336699);
    assert.equal(grout.material.color.getHex(), 0xffccaa);
    assert.equal(grout.material.metalness, 0);
    assert.ok(grout.material.roughness >= 0.8);
    assert.equal(glass.material.userData.contentMaterialIsGlass, true);
    assert.equal(frame.material.transparent, false);
    assert.equal(frame.material.userData.contentMaterialCategory, 'window-frame-loft');
    assert.equal(library.material.userData.contentMaterialCode, 'PT9');
});

test('preserves unknown materials and records model-only entries on the root', () => {
    const root = new THREE.Group();
    const mesh = meshWithMaterial('source');
    const originalColor = mesh.material.color.getHex();
    root.add(mesh);
    applyContentMaterialSemantics(root, [
        { MatName: 'source', BimRenderMat: 99, IsModel: false },
        { MatName: '软硬装模型', ID: '123', BimRenderMat: 0, IsModel: true },
        { MatName: '参数化模型', ID: 'MX8', BimRenderMat: 6, IsModel: true },
    ]);
    assert.equal(mesh.material.color.getHex(), originalColor);
    assert.deepEqual(root.userData.contentModelMaterials.map(item => item.category), [
        'static-model', 'parametric-model',
    ]);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test tests/content-material-semantics.test.js`

Expected: FAIL because application currently depends on external detail records and does not implement the documented categories.

- [ ] **Step 3: Implement metadata application**

For every matched Three.js material, merge these values into `material.userData` without deleting existing keys:

```js
{
    contentMaterialCategory: entry.category,
    contentMaterialCode: entry.code,
    contentMaterialIsModel: entry.isModel,
    contentBimRenderMat: entry.bimRenderMat,
    contentMaterialIsGlass: entry.category === 'glass',
    contentMaterialSource: entry.source,
}
```

Apply parsed color only to `paint` and `grout`; for grout set `metalness = 0` and `roughness = Math.max(currentRoughness, 0.8)`. Force `window-frame-loft` to remain opaque only when the parsed source did not already define intentional transparency. Do not change tiling, material-library, static-model, parametric-model, or unknown material appearance.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `node --test tests/content-material-semantics.test.js`

Expected: PASS with all protocol and application tests.

- [ ] **Step 5: Commit semantic application**

```powershell
git add src/components/ContentMaterialSemantics.js tests/content-material-semantics.test.js
git commit -m "feat: apply converted material semantics"
```

---

### Task 3: Integrate routing and remove the material-detail API

**Files:**
- Modify: `tests/content-model-loader.test.js`
- Modify: `src/components/ContentModelLoader.js`
- Modify: `tests/parametric-api-client.test.js`
- Modify: `src/services/ParametricApiClient.js`

**Interfaces:**
- Consumes: `applyContentMaterialSemantics(root, converted.material)` from Task 2.
- Removes: `ParametricApiClient.getMaterialDetails(materialCodes)`.
- Removes: `normalizeMaterialItems(raw)` when no remaining caller exists.

- [ ] **Step 1: Replace the external-detail expectation with a failing direct-routing test**

Update the existing parameterized material test so its harness records unexpected material-detail calls and the test supplies direct glass metadata:

```js
test('parameterized OBJ consumes BimRenderMat without requesting material details', async () => {
    const materialName = '237e983c-f392-434a-be5c-7c695c60b00d';
    const parsedMaterial = new THREE.MeshStandardMaterial();
    parsedMaterial.name = materialName;
    const root = prototype(parsedMaterial);
    const { loader, calls } = makeHarness({
        selections: new Map([['1401', selection('2406313', '1401')]]),
        details: [parametricDetail('2406313')],
        parseObj: () => root,
        convertModel: async () => ({
            obj: validObj,
            material: {
                [materialName]: {
                    ID: 'PT527545889554403328', IsModel: false,
                    MatName: materialName, BimRenderMat: 3,
                },
            },
        }),
    });
    await loader.load([instance('1401', 0)], new THREE.Group());
    assert.deepEqual(calls.materials, []);
    assert.equal(parsedMaterial.userData.contentMaterialIsGlass, true);
});
```

- [ ] **Step 2: Run the loader test and verify RED**

Run: `node --test tests/content-model-loader.test.js`

Expected: FAIL because the current loader calls `getMaterialDetails` for the `PT` ID.

- [ ] **Step 3: Remove the secondary request from the loader**

Replace the current material-detail block with:

```js
const prototypeRoot = this.parseObj(content);
applyContentMaterialSemantics(prototypeRoot, converted?.material);
return preparePrototype(prototypeRoot, 'MODEL_PARSE_FAILED');
```

Remove `contentMaterialCodes` from the import.

- [ ] **Step 4: Run the loader test and verify GREEN**

Run: `node --test tests/content-model-loader.test.js`

Expected: PASS and `calls.materials` remains empty.

- [ ] **Step 5: Remove the obsolete client method and endpoint test**

Delete `getMaterialDetails` and `normalizeMaterialItems` from `ParametricApiClient.js`. Delete only the test named `standalone material details are deduplicated and POSTed to the material endpoint`; retain all model conversion and goods-detail tests.

- [ ] **Step 6: Verify the API client remains green**

Run: `node --test tests/parametric-api-client.test.js tests/content-model-loader.test.js`

Expected: PASS with no reference to `getContentMaterialDetails` or `getMaterialDetails` in `src` or `tests`.

Run: `rg -n "getContentMaterialDetails|getMaterialDetails|normalizeMaterialItems" src tests`

Expected: no matches and exit code 1.

- [ ] **Step 7: Commit loader integration and API removal**

```powershell
git add src/components/ContentModelLoader.js src/services/ParametricApiClient.js tests/content-model-loader.test.js tests/parametric-api-client.test.js
git commit -m "refactor: route converted materials without detail lookup"
```

---

### Task 4: Preserve instance-safe glass rendering

**Files:**
- Modify: `tests/window-glass-material.test.js`
- Modify: `src/components/WindowGlassMaterial.js`
- Modify: `tests/content-model-placement.test.js`

**Interfaces:**
- Consumes: `material.userData.contentMaterialIsGlass` from Task 2.
- Produces: `applyWindowGlassMaterials(root): THREE.Object3D` with cloned glass materials.

- [ ] **Step 1: Add a failing protocol-first glass test**

```js
test('BimRender glass semantics override an opaque UUID material name', () => {
    const root = mesh('window-part', '237e983c-f392-434a-be5c-7c695c60b00d');
    const source = root.material;
    source.userData.contentMaterialIsGlass = true;
    applyWindowGlassMaterials(root);
    assert.notEqual(root.material, source);
    assert.equal(root.material.transparent, true);
    assert.equal(root.material.opacity, 0.32);
    assert.equal(root.material.depthWrite, false);
    assert.equal(root.material.side, THREE.DoubleSide);
    assert.equal(source.transparent, false);
});
```

Retain the legacy-name test for resources without protocol metadata and the material-array test.

- [ ] **Step 2: Run the glass and placement tests and verify RED if any contract is missing**

Run: `node --test tests/window-glass-material.test.js tests/content-model-placement.test.js`

Expected: the new test fails if semantic markers are not prioritized or source materials are mutated. If it already passes because exploratory code implemented the contract, temporarily assert `contentMaterialIsGlass = false` blocks the legacy name fallback, observe that failure, and add the explicit-false behavior in Step 3.

- [ ] **Step 3: Make protocol metadata authoritative with legacy fallback**

Implement glass detection as:

```js
function isGlass(mesh, material) {
    if (material?.userData?.contentMaterialIsGlass === true) return true;
    if (material?.userData?.contentMaterialIsGlass === false) return false;
    const label = `${mesh?.name ?? ''} ${material?.name ?? ''}`.toLowerCase();
    return GLASS_MARKERS.some(marker => label.includes(marker));
}
```

Continue cloning only the matched material and leave frames and the cached source material untouched.

- [ ] **Step 4: Run glass and placement tests and verify GREEN**

Run: `node --test tests/window-glass-material.test.js tests/content-model-placement.test.js`

Expected: PASS, including the existing cached-prototype integration assertion.

- [ ] **Step 5: Commit placement-safe glass behavior**

```powershell
git add src/components/WindowGlassMaterial.js tests/window-glass-material.test.js tests/content-model-placement.test.js
git commit -m "fix: render protocol glass per model instance"
```

---

### Task 5: Full verification and browser checkpoint

**Files:**
- Modify only if a failing test or build identifies a defect in files already listed above.

**Interfaces:**
- Consumes: the completed material router, loader integration, and placement behavior.
- Produces: a test/build/browser verification record in the task handoff.

- [ ] **Step 1: Run the complete automated test suite**

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 2: Build the production 3D bundle**

Run: `npm run build:3d`

Expected: Vite exits with code 0 and writes the 3D distribution bundle.

- [ ] **Step 3: Audit the final diff**

Run: `git diff --check` and `git status --short`.

Expected: no whitespace errors; only intentional source/test changes remain. Confirm `cad_plugin` was not touched.

- [ ] **Step 4: Validate in the existing browser scene**

Open the local `index-3d.html` debug scene with a cache-busting query parameter. Verify:

- windows marked `BimRenderMat=3` are transparent;
- window frames remain opaque;
- wall-paint and grout color markers render without preventing model load;
- clicking a rendered model exposes normalized material metadata in debug output;
- the Network panel contains no `getContentMaterialDetails` request;
- the console contains no material-router exception.

- [ ] **Step 5: Stop at the user checkpoint**

Report the exact test and build results and provide the opened validation URL. Do not migrate to or commit `cad_plugin` until the user confirms the local OCCT result.
