# Unified Content-Model Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route every TypeId-bearing record in every array-valued `*_list` through one template/detail decision, dispatch real resources as static or parameterized from detail data, and retain existing local geometry when no real model can be placed.

**Architecture:** `ContentModelRegistry` dynamically discovers source candidates without deciding resource kind. A pure classifier separates local geometry, opening-only objects, and resource selections; `ContentResourceResolver` remains the only static-versus-parameterized boundary. A new parameter resolver converts CAD semantics into model parameters, and `ContentModelLoader` becomes the sole 3D content pipeline, including soft content.

**Tech Stack:** JavaScript ES modules, Node.js `node:test`, Three.js 0.178, Vite 6, existing Node/CAD transports.

## Global Constraints

- Modify only `D:\occt_demo\.worktrees\cad-renderer-parametric-bridge` and, only for a verified transport defect, `C:\Users\User\Desktop\parametric-lab\backend`.
- Do not modify, synchronize, stage, commit, reset, or discard any file in `C:\Users\User\Desktop\cad_plugin`.
- List names never determine static versus parameterized resource kind.
- Resource type 1 uses `webV2Url`; resource type 8 prefers `parameterizedWebJsonUrl` and may fall back to `parameterizedJsonUrl`.
- Missing templates and missing template resources do not generate detail requests; they keep existing local geometry unless the type is intentionally opening-only.
- Models hide existing fallback geometry only after successful scene insertion.
- Do not invent fallback geometry where no fallback currently exists; TypeId `1307` and failed door models remain openings.
- Parameters are unique by final name, contain finite numeric values only at the current backend boundary, and contain at most 64 entries.
- Never log signed URLs, upstream bodies, raw responses, model contents, tokens, or unbounded exception messages.
- Each task ends with focused tests and its own commit. Stop after every runtime checkpoint for user visual review.

---

### Task 1: Dynamically discover every TypeId-bearing `*_list` record

**Files:**
- Modify: `src/components/ContentModelRegistry.js`
- Modify: `tests/content-model-registry.test.js`
- Modify: `tests/drawing2-content-coverage.test.js`

**Interfaces:**
- Produces: `collectContentModelInstances(json): ContentCandidate[]`.
- `ContentCandidate` retains `instanceId`, `sourceList`, `sourceIndex`, `category`, `typeId`, `basePoint`, `footprint`, `size`, outer transforms, `groundHeight`, and `rawBlockInnerInfo`.
- A candidate may have `basePoint: null` or `size: null`; discovery must not discard it before template/local-geometry classification.

- [ ] **Step 1: Replace the whitelist test with a failing dynamic-discovery test**

Update `tests/content-model-registry.test.js` so the first test includes model and structural lists plus ignored inputs:

```js
test('discovers every array-valued *_list record with a TypeId', () => {
    const result = collectContentModelInstances({
        soft_list: [block('soft')],
        door_list: [block('door')],
        pillar_list: [block('pillar')],
        final_room_list: [block('room')],
        malformed_list: null,
        metadata: [block('not-a-list')],
        ignored_list: [{ BasePoint: 'X=0 Y=0 Z=0' }],
    });
    assert.deepEqual(result.map(item => item.instanceId), [
        'soft_list:0', 'door_list:0', 'pillar_list:0', 'final_room_list:0',
    ]);
    assert.deepEqual(result.map(item => item.category), [
        'soft', 'door', 'pillar', 'final_room',
    ]);
});
```

Add a second failing assertion that a `140d02`-like record with zero Size and an irregular footprint is retained with `size === null` rather than removed.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
node --test tests/content-model-registry.test.js tests/drawing2-content-coverage.test.js
```

Expected: FAIL because the registry still uses `CONTENT_MODEL_LISTS` and drops candidates without usable rectangular dimensions.

- [ ] **Step 3: Implement dynamic discovery without resource classification**

Replace the list constant loop with deterministic object-entry scanning:

```js
export function collectContentModelInstances(json) {
    const result = [];
    for (const [sourceList, records] of Object.entries(json ?? {})) {
        if (!sourceList.endsWith('_list') || !Array.isArray(records)) continue;
        const category = sourceList.slice(0, -'_list'.length);
        records.forEach((record, sourceIndex) => {
            const item = normalizeRecord(record, { sourceList, category }, sourceIndex);
            if (item) result.push(item);
        });
    }
    return result;
}
```

Change `normalizeRecord` to require only a non-empty TypeId. Parse BasePoint,
Points, Size, and transforms when valid, but return null values instead of
dropping the candidate. Keep existing `modelParams` temporarily for compatibility;
Task 3 moves authoritative parameter resolution out of this registry.

- [ ] **Step 4: Update Drawing2 coverage to assert all discovered lists**

In `tests/drawing2-content-coverage.test.js`, derive expected counts directly
from every array-valued `*_list` record with TypeId and assert the registry has
the same `sourceList:sourceIndex` identities. Explicitly assert that the two
`window_list` TypeId `140d02` records remain discoverable despite zero Size.

- [ ] **Step 5: Run focused and full registry-related tests**

Run:

```powershell
node --test tests/content-model-registry.test.js tests/content-template-resolver.test.js tests/drawing2-content-coverage.test.js
npm.cmd test
```

Expected: all tests pass; only the documented CAD-environment tests are skipped.

- [ ] **Step 6: Commit dynamic discovery**

```powershell
git add src/components/ContentModelRegistry.js tests/content-model-registry.test.js tests/drawing2-content-coverage.test.js
git commit -m "feat: discover all CAD content lists"
```

---

### Task 2: Classify selections, local geometry, and intentional openings

**Files:**
- Create: `src/components/ContentModelClassifier.js`
- Create: `tests/content-model-classifier.test.js`
- Modify: `src/components/ContentModelLoader.js`
- Modify: `tests/content-model-loader.test.js`

**Interfaces:**
- Produces: `classifyContentCandidates(candidates, templateResolver): ContentClassification`.
- `ContentClassification` is `{ selectedRecords, localGeometry, openingOnly }`.
- `selectedRecords` entries are `{ instance, selection }`.
- `localGeometry` and `openingOnly` retain the original candidate plus a stable state and safe reason code.

- [ ] **Step 1: Write failing pure-classifier tests**

Create `tests/content-model-classifier.test.js` with a controlled resolver:

```js
test('classifies resources independently from source list names', () => {
    const candidates = [
        candidate('mixed_list', 0, 'static-type'),
        candidate('mixed_list', 1, 'parametric-type'),
        candidate('pillar_list', 0, 'no-template'),
        candidate('door_list', 0, '1307'),
    ];
    const result = classifyContentCandidates(candidates, resolverFor({
        'static-type': { resId: '1', typeId: 'static-type' },
        'parametric-type': { resId: '2', typeId: 'parametric-type' },
        'no-template': { errorCode: 'TEMPLATE_TYPE_NOT_FOUND' },
        '1307': { errorCode: 'TEMPLATE_RESOURCE_MISSING' },
    }));
    assert.deepEqual(result.selectedRecords.map(x => x.selection.resId), ['1', '2']);
    assert.deepEqual(result.localGeometry.map(x => x.instance.instanceId), ['pillar_list:0']);
    assert.deepEqual(result.openingOnly.map(x => x.instance.instanceId), ['door_list:0']);
});
```

Add cases proving `TEMPLATE_RESOURCE_MISSING` is local geometry for ordinary
types, resolver exceptions are isolated, and only exact TypeId `1307` is
opening-only.

- [ ] **Step 2: Run the new classifier test and verify RED**

Run:

```powershell
node --test tests/content-model-classifier.test.js
```

Expected: FAIL because `ContentModelClassifier.js` does not exist.

- [ ] **Step 3: Implement the pure classifier**

Implement an exact opening set and safe selection loop:

```js
const OPENING_ONLY_TYPE_IDS = new Set(['1307']);

export function classifyContentCandidates(candidates, templateResolver) {
    const selectedRecords = [];
    const localGeometry = [];
    const openingOnly = [];
    for (const instance of Array.isArray(candidates) ? candidates : []) {
        if (OPENING_ONLY_TYPE_IDS.has(String(instance?.typeId))) {
            openingOnly.push({ instance, state: 'opening-only', reasonCode: 'INTENTIONAL_OPENING' });
            continue;
        }
        let selection;
        try {
            selection = templateResolver.select(instance);
        } catch {
            selection = { errorCode: 'TEMPLATE_TYPE_NOT_FOUND' };
        }
        if (selection?.errorCode) {
            localGeometry.push({ instance, state: 'local-geometry', reasonCode: selection.errorCode });
        } else {
            selectedRecords.push({ instance, selection });
        }
    }
    return { selectedRecords, localGeometry, openingOnly };
}
```

- [ ] **Step 4: Integrate classification at the front of `ContentModelLoader.load`**

After `templateResolver.load`, call `classifyContentCandidates`. Remove the
existing behavior that reports missing template entries/resources as loader
failures. Only `selectedRecords` may contribute ResIds to `getGoodsDetails`.
Expose initial summary counts `localGeometry` and `openingOnly` while retaining
the existing loaded/failure counts until Task 4 completes the summary schema.

- [ ] **Step 5: Add a loader request-set regression**

Update `tests/content-model-loader.test.js` with candidates from different
lists and assert `apiClient.getGoodsDetails` receives only selected ResIds,
never local-geometry or opening-only candidates.

- [ ] **Step 6: Run focused and full tests**

```powershell
node --test tests/content-model-classifier.test.js tests/content-model-loader.test.js
npm.cmd test
```

Expected: all tests pass and existing partial-batch isolation remains green.

- [ ] **Step 7: Commit classification**

```powershell
git add src/components/ContentModelClassifier.js tests/content-model-classifier.test.js src/components/ContentModelLoader.js tests/content-model-loader.test.js
git commit -m "feat: classify CAD content fallbacks"
```

---

### Task 3: Resolve parameterized-model parameters by model semantics

**Files:**
- Create: `src/components/ParametricParameterResolver.js`
- Create: `tests/parametric-parameter-resolver.test.js`
- Modify: `src/components/ContentModelRegistry.js`
- Modify: `tests/content-model-registry.test.js`

**Interfaces:**
- Produces: `resolveParametricParameters(instance, selection): Array<{ name: string, value: number }>`.
- Consumes: normalized candidate fields plus `selection.templateEntry.ModelParamterMap`.
- Produces no scene-transform parameters.

- [ ] **Step 1: Write failing standard-window and generic tests**

Create `tests/parametric-parameter-resolver.test.js`:

```js
test('maps standard-window CAD dimensions to model semantics', () => {
    const parameters = resolveParametricParameters({
        typeId: '1401',
        rawBlockInnerInfo: { 长: 1100, 宽: 240, 高度: 1380, 离地高度: 890 },
    }, { templateEntry: { ModelParamterMap: {} } });
    assert.deepEqual(parameters, [
        { name: '宽度', value: 1100 },
        { name: '高度', value: 1380 },
        { name: '离地', value: 890 },
        { name: '墙厚', value: 240 },
    ]);
});

test('keeps generic soft aliases without scene transforms', () => {
    const parameters = resolveParametricParameters({
        typeId: '225903',
        rawBlockInnerInfo: { 长: 800, 宽: 600, 高: 900, 旋转角度: 90, 左右翻转: 1 },
    }, { templateEntry: { ModelParamterMap: {} } });
    assert.deepEqual(parameters, [
        { name: '长度', value: 800 },
        { name: '宽度', value: 600 },
        { name: '高度', value: 900 },
    ]);
});
```

Add tests for duplicate final names, non-finite values, numeric template
defaults, ignored string template defaults, and truncation to 64 unique names.

- [ ] **Step 2: Write a failing corner-window orientation test**

Use a six-point footprint whose BasePoint has a 435 mm previous edge and a
1080 mm next edge. Assert the adapter returns right width 435, left width 1080,
height 1500, ground 900, and corresponding 240 mm wall thickness values.
Add the same polygon in reversed winding and assert identical semantic output.

- [ ] **Step 3: Run parameter tests and verify RED**

```powershell
node --test tests/parametric-parameter-resolver.test.js
```

Expected: FAIL because the resolver does not exist.

- [ ] **Step 4: Implement bounded merge and generic aliases**

Build parameter maps from lowest to highest precedence: generic aliases,
finite numeric template defaults, then the type adapter. Use a helper:

```js
function setFinite(target, name, value) {
    const number = Number(value);
    if (!name || !Number.isFinite(number)) return;
    target.set(name, number);
}
```

Return the first 64 map entries as `{ name, value }`. Do not include rotation,
flip, BasePoint, resource identifiers, or string-valued material defaults.

- [ ] **Step 5: Implement 1401 and orientation-stable 1407 adapters**

For 1407, rotate the footprint so the point nearest BasePoint is first,
normalize its winding using signed polygon area, and use the two adjacent edge
lengths to validate and assign the CAD `长` and `宽` sides. Emit `右宽`, `左宽`,
`右墙厚`, and `左墙厚` in stable semantic order. If the footprint cannot
resolve orientation, fall back deterministically to `右宽=长`, `左宽=宽` and
the matching outer values rather than dropping the model.

- [ ] **Step 6: Remove authoritative parameter mapping from discovery**

Stop constructing `modelParams` from `PARAMETER_NAMES` in
`ContentModelRegistry`. Retain `rawBlockInnerInfo`; update registry tests to
assert source preservation rather than API parameter names. Compatibility code
that still reads `instance.modelParams` remains untouched until Task 4 removes
the legacy soft pipeline.

- [ ] **Step 7: Run focused and full tests**

```powershell
node --test tests/parametric-parameter-resolver.test.js tests/content-model-registry.test.js tests/content-model-placement.test.js
npm.cmd test
```

Expected: all tests pass.

- [ ] **Step 8: Commit semantic parameter resolution**

```powershell
git add src/components/ParametricParameterResolver.js tests/parametric-parameter-resolver.test.js src/components/ContentModelRegistry.js tests/content-model-registry.test.js
git commit -m "feat: resolve CAD parametric model parameters"
```

---

### Task 4: Make `ContentModelLoader` the single static/parameterized pipeline

**Files:**
- Modify: `src/components/ContentModelLoader.js`
- Modify: `tests/content-model-loader.test.js`
- Modify: `src/components/ContentModelPlacement.js`
- Modify: `tests/content-model-placement.test.js`

**Interfaces:**
- Consumes: `resolveModelResource(resId, detail)` as the only resource-kind decision.
- Consumes: `resolveParametricParameters(instance, selection)` only when `resource.kind === 'parametric-obj'`.
- Preserves: `loadContentModels(instances, sceneGroup, options): Promise<ContentLoadResult>`.
- `ContentLoadResult.summary` becomes `{ discovered, localGeometry, staticSelected, parametricSelected, placed, fallbackVisible, openingOnly, failed }`.
- Consumes: `options.hasFallback(instance): boolean` so fallback accounting uses an actual source-identity registration rather than a list-name check.

- [ ] **Step 1: Add a failing same-list mixed-resource test**

In `tests/content-model-loader.test.js`, place two candidates in
`mixed_list`, return a type-1 detail for one and type-8 detail for the other,
and assert the loader calls `loadGltf` once, `convertModel` once, and places both
roots. Assert the type-8 conversion receives parameters from the injected
`resolveParameters` dependency, not `instance.modelParams`.

- [ ] **Step 2: Add failing state-summary and fallback tests**

Create a batch containing one local-geometry candidate, one opening-only
candidate, one successful static model, one successful parameterized model,
and one selected model that fails parsing. Assert exact summary values and that
`onInstancePlaced` fires only for the two placed models. Inject `hasFallback`
for the failed instance and assert it alone increments `fallbackVisible`.

- [ ] **Step 3: Run loader tests and verify RED**

```powershell
node --test tests/content-model-loader.test.js
```

Expected: FAIL because the loader still reads `instance.modelParams` and emits
the old summary schema.

- [ ] **Step 4: Inject and use the parameter resolver only for type 8**

Add `resolveParameters = resolveParametricParameters` to constructor dependency
options. After resource resolution, increment `staticSelected` or
`parametricSelected`. For parameterized records call:

```js
const parameters = this.resolveParameters(record.instance, record.selection);
const model = await this.getPrototype(record.resource, parameters);
```

Static records must never call the parameter resolver or conversion endpoint.
Replace the existing door/window `isFallbackInstance` heuristic with
`options.hasFallback?.(instance) === true` wherever failure accounting needs to
know whether local geometry remains visible.

- [ ] **Step 5: Emit the new state summary and safe readable log line**

Return the exact summary interface and log it as a bounded string:

```js
this.logger.log(
    `[ContentLoader] discovered=${summary.discovered} ` +
    `localGeometry=${summary.localGeometry} staticSelected=${summary.staticSelected} ` +
    `parametricSelected=${summary.parametricSelected} placed=${summary.placed} ` +
    `fallbackVisible=${summary.fallbackVisible} openingOnly=${summary.openingOnly} ` +
    `failed=${summary.failed}`,
);
```

Failure detail remains restricted to sourceList, sourceIndex, typeId, resId,
resourceKind, and errorCode.

- [ ] **Step 6: Preserve source-list placement semantics without list-based dispatch**

Ensure placed root debug data retains source identity and resource kind.
Parameterized unit normalization remains uniform and static placement continues
to use its existing size/reference rules. Add a placement regression proving a
1401 model generated at approximately 1160 × 1400 × 300 model units is placed
upright at the 1100 × 240 footprint and 890 mm ground height without applying
the CAD dimensions twice.

- [ ] **Step 7: Run focused and full tests**

```powershell
node --test tests/content-model-loader.test.js tests/content-model-placement.test.js tests/content-resource-resolver.test.js
npm.cmd test
```

Expected: all tests pass and resource URL sanitization tests remain green.

- [ ] **Step 8: Commit the unified loader**

```powershell
git add src/components/ContentModelLoader.js tests/content-model-loader.test.js src/components/ContentModelPlacement.js tests/content-model-placement.test.js
git commit -m "feat: unify static and parametric content loading"
```

---

### Task 5: Retire the separate soft-only scene pipeline

**Files:**
- Modify: `src/components/RoomRenderer.js`
- Modify: `tests/content-model-scene-integration.test.js`
- Modify: `tests/cad-webview-diagnostic-stages.test.js`
- Modify: `src/utils/json_parse.js`
- Modify: `tests/parametric-loader-api-boundary.test.js`

**Interfaces:**
- `startSceneContentModelLoads(data, sceneGroup, fallbackMap, options)` returns `{ contentLoad }`.
- All records come from `data.contentModels.contentModels`.
- `ParametricModelLoader` remains available only as a compatibility module for isolated callers; RoomRenderer no longer invokes it.
- Fallback lookup uses `sourceList:sourceIndex` for any registered list, without a door/window allowlist.

- [ ] **Step 1: Replace the dual-pipeline orchestration test with a failing single-pipeline test**

In `tests/content-model-scene-integration.test.js`, pass a soft and a door
candidate through `contentModels`. Assert `loadContent` receives both in source
order, `loadSoft` is never called, and only `contentLoad` is returned.

- [ ] **Step 2: Run scene integration tests and verify RED**

```powershell
node --test tests/content-model-scene-integration.test.js tests/cad-webview-diagnostic-stages.test.js
```

Expected: FAIL because RoomRenderer still filters soft records and starts
`loadParametricModels` independently.

- [ ] **Step 3: Remove list-based filtering and the legacy scene invocation**

Remove `filterNonSoftContentModels`, the `loadParametricModels` import, soft
progress logging, and soft scene diagnostics from RoomRenderer. Invoke
`loadContentModels(data?.contentModels?.contentModels ?? [], ...)` once.
Keep the existing top-level catch so a content-pipeline exception remains
diagnostic and does not tear down the room.

Pass `hasFallback: instance => fallbackMap.has(sourceIdentity(instance))` into
the loader, and remove the `FALLBACK_SOURCE_LISTS` restriction from fallback-key
construction. Existing maps may still contain only renderers that currently
produce individual fallback meshes; the lookup API itself must be list-agnostic.

- [ ] **Step 4: Remove duplicate soft parameter production in `json_parse.js`**

Keep legacy `SoftLists` output for non-scene compatibility, but stop treating
its `modelParams` as the authoritative conversion input. `parse_data.content_models`
remains the single source for 3D content loading.

- [ ] **Step 5: Update diagnostics and compatibility tests**

Update the diagnostic allowlist to contain only content-load start, summary,
and error stages for this pipeline. Keep `ParametricModelLoader` unit tests as
module-level compatibility tests; add an assertion that importing/rendering
RoomRenderer never invokes it.

- [ ] **Step 6: Run focused and full tests**

```powershell
node --test tests/content-model-scene-integration.test.js tests/cad-webview-diagnostic-stages.test.js tests/parametric-loader-api-boundary.test.js
npm.cmd test
```

Expected: all tests pass with no duplicate soft model placements.

- [ ] **Step 7: Commit the single scene pipeline**

```powershell
git add src/components/RoomRenderer.js tests/content-model-scene-integration.test.js tests/cad-webview-diagnostic-stages.test.js src/utils/json_parse.js tests/parametric-loader-api-boundary.test.js
git commit -m "refactor: route soft content through unified loader"
```

---

### Task 6: Standalone runtime checkpoint for unified dispatch and window sizes

**Files:**
- Modify only if runtime evidence exposes a defect: the source file named by the failing trace plus its focused test.
- Update: `docs/superpowers/plans/2026-07-28-unified-content-model-discovery.md` checkboxes only after each verified step.

**Interfaces:**
- Consumes: backend health at `http://localhost:3100/health` and production assets at `http://127.0.0.1:4179/index-3d.html`.
- Produces: safe numeric evidence for discovery, classification, resource dispatch, placements, fallbacks, openings, and failures.

- [ ] **Step 1: Verify backend and production build**

Run:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:3100/health
npm.cmd run build:3d
```

Expected: health returns HTTP 200 and Vite exits 0.

- [ ] **Step 2: Verify unified request behavior in the browser**

Reload `index-3d.html`, wait for content completion, and confirm:

- one unified content summary is emitted;
- no legacy `[ParamLoader] scene` summary appears;
- at least one static and one parameterized resource dispatch occurs when the
  current Drawing2 data provides both kinds;
- no source identity is placed twice;
- no `[ContentLoader] scene pipeline failed` entry appears.

- [ ] **Step 3: Record safe exact state counts**

Record only the numeric summary fields and safe failure fields. Confirm the
discovered count equals every TypeId-bearing object from every array-valued
`*_list`. Confirm TypeId `1307` contributes to `openingOnly`, and the two
`140d02` objects contribute to `localGeometry` rather than failed model loads.

- [ ] **Step 4: Inspect standard and corner windows visually**

Confirm all successful 1401 and 1407 roots are upright, use the JSON ground
height, align to their Points footprint, and no longer use the model defaults.
Stop and ask the user to review this checkpoint before investigating 140d02.

- [ ] **Step 5: Run final automated verification**

Run backend and OCCT checks in their respective repositories:

```powershell
npm.cmd test
npm.cmd test
npm.cmd run build:3d
git diff --check
git status --short
```

Expected: backend tests, OCCT tests, and build exit 0; diff check is clean; only
intentional plan-checklist edits or an evidence-driven fix remain uncommitted.

- [ ] **Step 6: Commit only evidence-driven runtime fixes**

If Step 2–4 exposed a defect, add its failing regression first, implement the
minimal fix, rerun Step 5, then commit only the named OCCT/backend files. If no
defect was found, do not create an empty source commit.

- [ ] **Step 7: Stop for user review**

Report exact counts, test/build results, and the browser URL. Do not begin
140d02 free-window construction and do not deploy or synchronize to CAD until
the user approves the runtime checkpoint.
