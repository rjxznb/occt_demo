# CAD Content Model Loader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load every supported CAD content instance through the UE-compatible template selection rules, render static type-1 resources as GLB and parameterized type-8 resources as OBJ, and run CAD without a Node backend.

**Architecture:** Raw CAD JSON is normalized into `ContentModelInstance` records by an explicit model-bearing list registry. A pure template resolver maps TypeId and size to ResId; a transport-neutral API client retrieves goods details in batches; a resource resolver dispatches static GLB and parameterized OBJ prototypes into one Z-up placement pipeline. CAD extends the existing lifecycle-safe C++ bridge with one fixed batch endpoint, while the standalone Demo keeps its current Node transport.

**Tech Stack:** JavaScript ES modules, Node test runner, Three.js 0.178 (`GLTFLoader`, `OBJLoader`), Vite 6, fzstd 0.1.1, WebView2, C++17, libcurl 7.87.0/OpenSSL, nlohmann/json, Visual Studio 2019/MSBuild.

## Global Constraints

- Canonical source, tests, specifications, and plans live in `D:\occt_demo\.worktrees\cad-renderer-parametric-bridge` on `codex/cad-renderer-parametric-bridge`.
- `D:\occt_demo` remains a complete, independently runnable Demo and keeps its current Node development transport.
- CAD runtime must render supported content without `localhost:3100`; a CAD bridge failure must not fall back to Node.
- The CAD repository stores compiled 3D/VR assets only; do not add npm/Vite source, `package.json`, or `node_modules` there.
- Do not add a deployment or synchronization script. Final copying is performed with reviewed, explicit PowerShell commands.
- Do not change WebView2 security flags, disable CORS, disable TLS verification, or expose an arbitrary native URL proxy.
- Keep the goods endpoint fixed at `https://biz-gateway.home.ke.com/utopia-render-platform/bim/pc/render/getResGoodsDetail`.
- Keep the existing parameter conversion endpoint and Windows native CA configuration unchanged.
- A goods-details batch contains at most 50 unique numeric ResIds.
- Static resources use `resourceList[].type === 1` and `data.webV2Url`; parameterized resources use `type === 8` and `data.parameterizedJsonUrl`.
- Never log complete signed model URLs, cookies, upstream bodies, GLB bytes, OBJ bodies, or Base64 bodies.
- Preserve procedural wall/opening generation. A real door/window model only replaces the corresponding visible fallback mesh after successful placement.
- Preserve the existing room-dialog toggle and model-click debug behavior.
- Do not modify, stage, commit, push, or create a PR for `C:\Users\User\Desktop\cad_plugin\README.md`.
- Do not run `git add`, `git commit`, `git push`, or create a PR anywhere in `C:\Users\User\Desktop\cad_plugin`.
- OCCT changes are committed task-by-task. CAD changes stay unstaged and uncommitted.
- Before replacing compiled assets, resolve and verify the target is under the explicitly named CAD renderer or runtime cache directory.

---

## File Map

### OCCT files

- Create `src/components/ContentModelRegistry.js`: explicit CAD list registry and raw-object normalization.
- Create `src/components/ContentTemplateResolver.js`: template parsing, TypeId compatibility mapping, and UE size selection.
- Create `src/services/ContentResourceResolver.js`: normalize batch goods responses and choose type-1/type-8 URLs without leaking them into logs.
- Create `src/components/ContentModelPlacement.js`: shared Y-up-to-Z-up, scale, anchor, rotation, flip, and debug metadata functions.
- Create `src/components/ContentModelLoader.js`: batch orchestration, GLB/OBJ prototype loading, caches, cloning, placement, and summary.
- Modify `src/utils/json_parse.js`: emit `content_models` while preserving current room/door/window/SoftLists data.
- Modify `src/core/GeometryService.js`: expose normalized content models.
- Modify `src/services/ParametricApiClient.js`: add `getGoodsDetails(resIds)` with CAD batch and Demo per-ID transports.
- Modify `src/components/ParametricModelLoader.js`: retain compatibility exports and remove the old parameter-only orchestration.
- Modify `src/components/RoomRenderer.js`: invoke the unified loader and switch door/window fallbacks after success.
- Modify `src/components/DoorWindowFactory.js`: attach stable `sourceList`/`sourceIndex` identity to visible fallback meshes.
- Modify `src/components/SceneClickInteraction.js` and `src/components/RoomInfoView.js`: support all content model roots and unified debug output.
- Modify `src/App.js`, `src/App3D.js`, and `src/App_VR.js`: load `contentModels` in the shared scene input.
- Add focused tests under `tests/` for every module and contract listed below.

### CAD files — never commit

- Modify `C:\Users\User\Desktop\cad_plugin\common\Net\k_parametric_api_client.h/.cpp`: fixed batch goods request.
- Modify `C:\Users\User\Desktop\cad_plugin\ui\window\bridge\k_parametric_model_bridge.cpp`: validate/register `getContentGoodsDetails` using existing safe async state.
- Modify `C:\Users\User\Desktop\cad_plugin\build_resource\PluginResource\html\renderer\render_preview.js`: add the new method to `NATIVE_METHODS`.
- Replace compiled files under `preview3d/**` and `preview-vr/**` only after tests/build pass.
- Copy the same compiled files to `C:\Users\User\AppData\Local\ke_arx_cache\2021\PluginResource\html\renderer\preview3d` and `preview-vr`.

---

### Task 1: Normalize UE Model-Bearing CAD Lists

**Files:**
- Create: `src/components/ContentModelRegistry.js`
- Create: `tests/content-model-registry.test.js`
- Modify: `src/utils/json_parse.js`
- Test: `tests/content-model-registry.test.js`

**Interfaces:**
- Consumes: raw CAD JSON records with `TypeId`, `BasePoint`, `Points`, `Size`, `Out*Scale`, `OutRotateRadian`, and `BlockInnerInfo`.
- Produces: `CONTENT_MODEL_LISTS: ReadonlyArray<{sourceList:string, category:string}>`.
- Produces: `collectContentModelInstances(json): ContentModelInstance[]`.
- Produces: `parse_data.content_models: ContentModelInstance[]` without changing existing `SoftLists`, `door_list`, or `window_list` shapes.

- [ ] **Step 1: Write the failing registry and normalization tests**

Create `tests/content-model-registry.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectContentModelInstances } from '../src/components/ContentModelRegistry.js';

const block = (TypeId, extra = {}) => ({
    TypeId,
    BasePoint: 'X=1000 Y=2000 Z=30',
    Points: [
        'X=900 Y=1900 Z=0', 'X=1100 Y=1900 Z=0',
        'X=1100 Y=2100 Z=0', 'X=900 Y=2100 Z=0',
    ],
    Size: 'X=200 Y=200 Z=800',
    OutXScale: 1,
    OutYScale: 1,
    OutZScale: 1,
    OutRotateRadian: 15,
    BlockInnerInfo: {
        旋转角度: 30,
        左右翻转: true,
        上下翻转: false,
        长: 200,
        宽: 200,
        高: 800,
        离地高度: 120,
    },
    ...extra,
});

test('collects only UE model-bearing lists', () => {
    const result = collectContentModelInstances({
        soft_list: [block('soft')],
        door_list: [block('door')],
        window_list: [block('window')],
        radiator_list: [block('radiator')],
        pillar_list: [block('must-not-load')],
        room_list: [block('must-not-load-either')],
    });
    assert.deepEqual(result.map(item => item.sourceList), [
        'soft_list', 'door_list', 'window_list', 'radiator_list',
    ]);
    assert.deepEqual(result.map(item => item.category), [
        'soft', 'door', 'window', 'radiator',
    ]);
});

test('normalizes CAD plan transform, dimensions, and parameters', () => {
    const [item] = collectContentModelInstances({ soft_list: [block('225903')] });
    assert.equal(item.instanceId, 'soft_list:0');
    assert.equal(item.typeId, '225903');
    assert.deepEqual(item.basePoint, { x: 1000, y: 2000, z: 30 });
    assert.deepEqual(item.size, { x: 200, y: 200, z: 800 });
    assert.equal(item.rotationDegrees, 45);
    assert.equal(item.horizontalFlip, true);
    assert.equal(item.verticalFlip, false);
    assert.equal(item.groundHeight, 120);
    assert.deepEqual(item.modelParams, [
        { name: '长度', value: 200 },
        { name: '宽度', value: 200 },
        { name: '高度', value: 800 },
        { name: '离地高度', value: 120 },
    ]);
    assert.equal(item.footprint.length, 4);
});

test('keeps invalid objects out of the request set', () => {
    const result = collectContentModelInstances({
        soft_list: [{ TypeId: '', BasePoint: 'bad' }, null],
    });
    assert.deepEqual(result, []);
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```powershell
node --test tests/content-model-registry.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `ContentModelRegistry.js`.

- [ ] **Step 3: Implement the explicit registry and normalizer**

Create `src/components/ContentModelRegistry.js` with these exported contracts and constants:

```js
export const CONTENT_MODEL_LISTS = Object.freeze([
    Object.freeze({ sourceList: 'soft_list', category: 'soft' }),
    Object.freeze({ sourceList: 'door_list', category: 'door' }),
    Object.freeze({ sourceList: 'window_list', category: 'window' }),
    Object.freeze({ sourceList: 'radiator_list', category: 'radiator' }),
]);

const PARAMETER_NAMES = Object.freeze({
    长: '长度', 宽: '宽度', 高: '高度', 自身高度: '自身高度',
    离地高度: '离地高度', 挡水条高度: '挡水条高度',
});

export function collectContentModelInstances(json) {
    const result = [];
    for (const descriptor of CONTENT_MODEL_LISTS) {
        const records = Array.isArray(json?.[descriptor.sourceList])
            ? json[descriptor.sourceList] : [];
        records.forEach((record, sourceIndex) => {
            const item = normalizeRecord(record, descriptor, sourceIndex);
            if (item) result.push(item);
        });
    }
    return result;
}
```

Implement private `parseVector`, `parsePoints`, `finiteNumber`, `readFlip`, and `normalizeRecord` helpers. `normalizeRecord` must return every property defined by `ContentModelInstance` in the design, use `BlockInnerInfo` flip fields before legacy `HorizontalFlip`/`VerticalFlip`, and reject a missing TypeId or unparseable BasePoint. Keep `rawBlockInnerInfo` as a shallow JSON-safe copy. Use `groundHeight: null` when the CAD object contains no explicit `离地高度`; preserve numeric zero when the field explicitly contains zero. This lets placement use template `GroundDist` only when CAD did not provide the value.

- [ ] **Step 4: Add `content_models` to `json_parse.js`**

Import the collector and append exactly one assignment before returning parsed data:

```js
import { collectContentModelInstances } from '../components/ContentModelRegistry.js';

parse_data.content_models = collectContentModelInstances(json);
```

Do not remove or restructure the existing door/window/SoftLists parsing in this task.

- [ ] **Step 5: Run focused and full tests**

Run:

```powershell
node --test tests/content-model-registry.test.js
npm test
```

Expected: all tests pass; existing room, door/window, orientation, anchor, and click tests remain green.

- [ ] **Step 6: Commit the OCCT task**

Run:

```powershell
git add -- src/components/ContentModelRegistry.js src/utils/json_parse.js tests/content-model-registry.test.js
git commit -m "feat: normalize CAD content model instances"
```

Expected: only OCCT files are committed; CAD status is unchanged.

---

### Task 2: Port UE Template Selection Semantics

**Files:**
- Create: `src/components/ContentTemplateResolver.js`
- Create: `tests/content-template-resolver.test.js`
- Test data: `public/data/template.json`
- Test data: `public/data/Drawing2.json`

**Interfaces:**
- Consumes: `ContentModelInstance` and raw `template.json`.
- Produces: `createTemplateCatalog(raw): Map<string, TemplateEntry>`.
- Produces: `mapCadTypeId(instance, catalog): string`.
- Produces: `selectTemplateResource(instance, catalog): {typeId,typeName,styleItemType,resId,referenceSize,selection,xMirror,groundDist,templateEntry}` or `{errorCode,...}`.
- Produces: `ContentTemplateResolver.load(path)` and `.select(instance)`.

- [ ] **Step 1: Write failing tests for fixed mappings and fallback mappings**

Create `tests/content-template-resolver.test.js` with a small catalog fixture and these assertions:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createTemplateCatalog, mapCadTypeId, selectTemplateResource,
} from '../src/components/ContentTemplateResolver.js';

const entry = (TypeId, StyleItemType, ResList) => ({
    TypeId, TypeName: TypeId, StyleItemType, ResList,
    SizeSampleModelMap: Object.fromEntries(ResList.map(r => [r.ResId, r])),
});

const catalog = createTemplateCatalog({ AllItemInfo: [
    entry('7314', 0, [{ ResId: 'fold-2', X: 100, Y: 20, Z: 220 }]),
    entry('1302', 0, [{ ResId: 'door-fallback', X: 90, Y: 20, Z: 220 }]),
    entry('203d', 1, [{ ResId: 'wine', X: 120, Y: 40, Z: 220 }]),
] });

test('ports UE folding-door, cabinet-style, and template fallback mappings', () => {
    assert.equal(mapCadTypeId({ typeId: '130402', rawBlockInnerInfo: {} }, catalog), '7314');
    assert.equal(mapCadTypeId({ typeId: '20dc', rawBlockInnerInfo: { 样式: '酒柜' } }, catalog), '203d');
    assert.equal(mapCadTypeId({ typeId: '1301', rawBlockInnerInfo: {} }, catalog), '1302');
});
```

Implement and test all source-visible UE mappings:

- folding door `1304xx`: 2→7314, 3→7324, 4→7312, 5→7325, 6→7313, otherwise 1304;
- barn door `1305*`→7319;
- pocket door `1311*`→7323;
- cabinet styles: 玄关柜→203c, 酒柜→203d, 书柜→203e, 餐边柜→203g, 开门柜→20db00, 斗柜→20db01, 开放格→20db02, 吊柜→20f200, 悬空储物柜→20f201, 悬空抽屉柜→20f202;
- template fallback: 1301→first existing of 1302/7317; 1303→7318.

Do not claim to decode UE's binary `TypeIdMapTable.uasset`. A CAD TypeId not covered by the source-visible rules remains unchanged and either resolves directly in the exported template or produces `TEMPLATE_TYPE_NOT_FOUND`.

- [ ] **Step 2: Write failing nearest-size and range-size tests**

Append:

```js
test('selects the UE minimum area-difference sample after mm-to-cm conversion', () => {
    const local = createTemplateCatalog({ AllItemInfo: [entry('chair', 0, [
        { ResId: 'small', X: 50, Y: 50, Z: 80 },
        { ResId: 'large', X: 100, Y: 60, Z: 90 },
    ])] });
    const selected = selectTemplateResource({
        typeId: 'chair', size: { x: 980, y: 590, z: 900 },
        footprint: [], rawBlockInnerInfo: {},
    }, local);
    assert.equal(selected.resId, 'large');
    assert.equal(selected.selection, 'nearest-area');
});

test('selects range entries with UE tolerance and falls back stably', () => {
    const local = createTemplateCatalog({ AllItemInfo: [{
        TypeId: 'cabinet', TypeName: '柜', StyleItemType: 1,
        ResList: [
            { ResId: 'default', X: 0, Y: 0, Z: 0 },
            { ResId: 'range', X: 0, Y: 0, Z: 0,
              SizeRangeX: '105,155', SizeRangeY: '30,40' },
        ],
    }] });
    assert.equal(selectTemplateResource({
        typeId: 'cabinet', size: { x: 1050.05, y: 350, z: 0 },
        footprint: [], rawBlockInnerInfo: {},
    }, local).resId, 'range');
    assert.equal(selectTemplateResource({
        typeId: 'cabinet', size: { x: 2000, y: 900, z: 0 },
        footprint: [], rawBlockInnerInfo: {},
    }, local).resId, 'default');
});
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```powershell
node --test tests/content-template-resolver.test.js
```

Expected: FAIL because the resolver module does not exist.

- [ ] **Step 4: Implement the catalog and UE selection functions**

Create `ContentTemplateResolver.js` with named style constants:

```js
export const STYLE_ITEM = Object.freeze({
    MOVEABLE: 0, CABINET: 1, CUPBOARD: 2, TABLE: 3,
    GROUP: 4, LAMP: 5, PAINTING: 6, HARD: 7, MATERIAL: 8, WINDOW: 9,
});

const NEAREST_TYPES = new Set([
    STYLE_ITEM.MOVEABLE, STYLE_ITEM.GROUP, STYLE_ITEM.LAMP,
    STYLE_ITEM.PAINTING, STYLE_ITEM.HARD,
]);
const RANGE_TYPES = new Set([
    STYLE_ITEM.CABINET, STYLE_ITEM.CUPBOARD, STYLE_ITEM.TABLE, STYLE_ITEM.WINDOW,
]);
```

Implement the exact UE area-difference formula, `0.01` cm four-sample tolerance, stable `ResList` ordering, nonzero sample filtering, and explicit `{errorCode:'TEMPLATE_TYPE_NOT_FOUND'}` / `{errorCode:'TEMPLATE_RESOURCE_MISSING'}` results. Derive missing `size.x/y` from adjacent footprint edge lengths before converting mm to cm.

`ContentTemplateResolver` must cache the fetch promise and catalog, expose `load(templatePath='data/template.json')`, and cache selections by `${mappedTypeId}|${sizeCm.x}|${sizeCm.y}`.

- [ ] **Step 5: Add a Drawing2 regression test**

Read `public/data/Drawing2.json` and `public/data/template.json`, normalize with `collectContentModelInstances`, and assert these audited cases do not regress to the first resource:

```js
const expected = new Map([
    ['225903', '1316568'],
    ['206902', '975654'],
    ['219102', '817646'],
    ['216002', '856945'],
    ['21f802', '962871'],
]);
```

For each key, locate an instance whose dimensions select the expected ResId and assert `selection === 'nearest-area'`. If multiple instances share a TypeId, assert at least one matching instance rather than assuming array order.

- [ ] **Step 6: Run focused and full tests**

Run:

```powershell
node --test tests/content-template-resolver.test.js
npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit the OCCT task**

Run:

```powershell
git add -- src/components/ContentTemplateResolver.js tests/content-template-resolver.test.js
git commit -m "feat: port UE content template selection"
```

---

### Task 3: Add Batch Goods Transport and Resource-Type Resolution

**Files:**
- Modify: `src/services/ParametricApiClient.js`
- Create: `src/services/ContentResourceResolver.js`
- Modify: `tests/parametric-api-client.test.js`
- Create: `tests/content-resource-resolver.test.js`

**Interfaces:**
- Consumes: `RendererHostClient.invoke(method,payload,options)` and existing Node `/api/getGoodsDetail?id=`.
- Produces: `ParametricApiClient.getGoodsDetails(resIds): Promise<{items:object[]}>`.
- Produces: `normalizeGoodsItems(raw): object[]`.
- Produces: `indexGoodsDetails(raw): Map<string,object>`.
- Produces: `resolveModelResource(resId, detail): ResolvedModelResource | {errorCode:string,resId:string}`.

- [ ] **Step 1: Write failing CAD batching and Demo compatibility tests**

Append to `tests/parametric-api-client.test.js`:

```js
test('CAD goods detail calls are deduplicated and split into batches of 50', async () => {
    const calls = [];
    const hostClient = {
        isAvailable: () => true,
        invoke: async (method, payload) => {
            calls.push({ method, payload });
            return { code: 2000, data: payload.resIds.map(id => ({ id })) };
        },
    };
    const client = new ParametricApiClient({ hostClient });
    const ids = [...Array.from({ length: 51 }, (_, i) => String(i + 1)), '1'];
    const result = await client.getGoodsDetails(ids);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].method, 'getContentGoodsDetails');
    assert.equal(calls[0].payload.resIds.length, 50);
    assert.deepEqual(result.items.map(item => String(item.id)),
        Array.from({ length: 51 }, (_, i) => String(i + 1)));
});

test('Demo batch transport reuses the existing per-ID Node endpoint', async () => {
    const urls = [];
    const client = new ParametricApiClient({
        hostClient: null,
        fetchImpl: async url => {
            urls.push(url);
            return { ok: true, status: 200, json: async () => ({ data: { id: url.split('=').at(-1) } }) };
        },
    });
    const result = await client.getGoodsDetails(['7', '8']);
    assert.equal(urls.length, 2);
    assert.deepEqual(result.items.map(item => item.id), ['7', '8']);
});
```

- [ ] **Step 2: Write failing static/parameterized resource tests**

Create `tests/content-resource-resolver.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveModelResource } from '../src/services/ContentResourceResolver.js';

test('type 1 chooses nested webV2Url as a static GLB', () => {
    const resource = resolveModelResource('1961100', {
        id: 1961100, modelType: 1,
        resourceList: [{ type: 1, data: {
            webV2Url: 'https://file.test/model.kb?signature=secret',
            webV2Md5: 'static-md5', url427: 'https://file.test/model.pak',
        } }],
    });
    assert.deepEqual(resource, {
        resId: '1961100', kind: 'static-glb',
        sourceUrl: 'https://file.test/model.kb?signature=secret',
        contentHash: 'static-md5', modelType: 1, resourceType: 1,
        rawSummary: {
            candidateCount: 1,
            hasStaticWebV2: true,
            hasParameterizedJson: false,
        },
    });
});

test('type 8 chooses parameterizedJsonUrl and never treats it as static', () => {
    const resource = resolveModelResource('2406734', {
        id: 2406734, modelType: 0,
        resourceList: [{ type: 8, data: {
            parameterizedJsonUrl: 'https://file.test/model.json?signature=secret',
            parameterizedJsonMd5: 'parameter-md5',
        } }],
    });
    assert.equal(resource.kind, 'parametric-obj');
    assert.equal(resource.resourceType, 8);
    assert.equal(resource.contentHash, 'parameter-md5');
});

test('unknown and incomplete resources return stable error codes', () => {
    assert.equal(resolveModelResource('1', { resourceList: [{ type: 1, data: {} }] }).errorCode,
        'RESOURCE_URL_MISSING');
    assert.equal(resolveModelResource('2', { resourceList: [{ type: 99, data: {} }] }).errorCode,
        'UNSUPPORTED_RESOURCE_TYPE');
});
```

- [ ] **Step 3: Run focused tests and verify failure**

Run:

```powershell
node --test tests/parametric-api-client.test.js tests/content-resource-resolver.test.js
```

Expected: FAIL because `getGoodsDetails` and `ContentResourceResolver.js` do not exist.

- [ ] **Step 4: Implement batch transport and response normalization**

Add to `ParametricApiClient`:

```js
async getGoodsDetails(resIds) {
    const ids = [...new Set((resIds || []).map(value => String(value).trim())
        .filter(value => /^\d+$/.test(value)))];
    if (ids.length === 0) return { items: [] };
    const batches = [];
    for (let index = 0; index < ids.length; index += 50) {
        batches.push(ids.slice(index, index + 50));
    }
    const responses = this.transport === 'cad'
        ? await Promise.all(batches.map(batch => this.hostClient.invoke(
            'getContentGoodsDetails', { resIds: batch }, { timeoutMs: GOODS_TIMEOUT_MS },
        )))
        : await Promise.all(ids.map(id => this.getGoodsDetail(id)));
    return { items: responses.flatMap(normalizeGoodsItems) };
}
```

Export `normalizeGoodsItems(raw)`. It must support batch `{code,data:[...]}`, `{data:{list:[...]}}`, single `{data:{modelDTO:{...}}}`, and already normalized `{items:[...]}` responses. Preserve requested order by indexing results after all batches, not by completion timing.

- [ ] **Step 5: Implement resource resolution**

Create `ContentResourceResolver.js`. Unwrap `detail.modelDTO ?? detail.data?.modelDTO ?? detail`, read `resourceList`, then read each candidate's nested `candidate.data ?? candidate`. Only accept non-empty HTTP(S) URLs. Return no signed URL in `rawSummary`; `rawSummary` may contain only candidate count and field-presence booleans.

`normalizeGoodsItems` must accept business code `1` or `2000`. A present business code outside that set throws `INVALID_RESPONSE` with the numeric code but without the response body. `indexGoodsDetails` keys items by `id`, `resGoodsId`, or the corresponding field inside `modelDTO`; a requested ResId absent from the map becomes `RESOURCE_DETAIL_MISSING` in Task 6.

- [ ] **Step 6: Run focused and full tests**

Run:

```powershell
node --test tests/parametric-api-client.test.js tests/content-resource-resolver.test.js
npm test
```

Expected: all tests pass and current zstd conversion tests remain green.

- [ ] **Step 7: Commit the OCCT task**

Run:

```powershell
git add -- src/services/ParametricApiClient.js src/services/ContentResourceResolver.js tests/parametric-api-client.test.js tests/content-resource-resolver.test.js
git commit -m "feat: resolve static and parametric goods resources"
```

---

### Task 4: Extend the CAD C++ Bridge with Fixed Batch Goods Details

**Files:**
- Modify: `tests/cad-parametric-api-client-contract.test.js`
- Modify: `tests/cad-parametric-model-bridge-contract.test.js`
- Modify: `tests/render-preview-rpc-contract.test.js`
- Modify without commit: `C:\Users\User\Desktop\cad_plugin\common\Net\k_parametric_api_client.h`
- Modify without commit: `C:\Users\User\Desktop\cad_plugin\common\Net\k_parametric_api_client.cpp`
- Modify without commit: `C:\Users\User\Desktop\cad_plugin\ui\window\bridge\k_parametric_model_bridge.cpp`
- Modify without commit: `C:\Users\User\Desktop\cad_plugin\build_resource\PluginResource\html\renderer\render_preview.js`

**Interfaces:**
- Consumes: validated `std::vector<std::string>` numeric ResIds.
- Produces: `KParametricApiClient::GetGoodsDetails(const std::vector<std::string>&)`.
- Produces: bridge binding `getContentGoodsDetails` accepting one JSON argument `{"resIds":[...]}`.
- Produces: renderer RPC payload `{resIds:string[]}`.

- [ ] **Step 1: Record and protect CAD status**

Run:

```powershell
git -C C:\Users\User\Desktop\cad_plugin status --short
git -C C:\Users\User\Desktop\cad_plugin diff -- README.md
```

Expected: existing renderer/C++ work and ` M README.md` are visible. Save the status output in the task notes; do not modify README.

- [ ] **Step 2: Add failing C++ source-contract tests**

Require these exact contracts in the existing test files:

```js
assert.match(header, /GetGoodsDetails\(\s*const std::vector<std::string>& res_ids\s*\) const/);
assert.match(source, /biz-gateway\.home\.ke\.com\/utopia-render-platform\/bim\/pc\/render\/getResGoodsDetail/);
assert.match(source, /resGoodsIdList=/);
assert.match(source, /CURLSSLOPT_NATIVE_CA/);
assert.match(bridge, /BindAsync\(\s*"getContentGoodsDetails"/);
assert.match(bridge, /kMaxGoodsDetailsCount\s*=\s*50/);
assert.doesNotMatch(source, /CURLOPT_SSL_VERIFYPEER\s*,\s*0/);
assert.doesNotMatch(source, /CURLOPT_SSL_VERIFYHOST\s*,\s*0/);
```

Extend the renderer harness test to invoke:

```js
harness.invoke({
    requestId: 'batch-goods', method: 'getContentGoodsDetails',
    payload: { resIds: ['1961100', '2406734'] },
});
assert.deepEqual(harness.calls.at(-1), {
    name: 'getContentGoodsDetails',
    args: ['{"resIds":["1961100","2406734"]}'],
});
```

Also test empty arrays, 51 IDs, nonnumeric IDs, and unknown payload properties produce `INVALID_ARGUMENT` before calling native code.

- [ ] **Step 3: Run contract tests and verify failure**

Run:

```powershell
node --test tests/cad-parametric-api-client-contract.test.js tests/cad-parametric-model-bridge-contract.test.js tests/render-preview-rpc-contract.test.js
```

Expected: FAIL because the batch method/binding/allowlist do not exist.

- [ ] **Step 4: Add the fixed C++ batch request**

Add to the header:

```cpp
KParametricApiResult GetGoodsDetails(
    const std::vector<std::string>& res_ids) const;
```

In the `.cpp`, define:

```cpp
const char kGoodsDetailsEndpoint[] =
    "https://biz-gateway.home.ke.com/utopia-render-platform/bim/pc/render/"
    "getResGoodsDetail?resGoodsIdList=";
```

`GetGoodsDetails` must reject an empty vector or more than 50 IDs, require every ID to contain only ASCII digits, join with literal commas, append only that validated string to the fixed endpoint, and call the existing `ExecuteRequest` with `kGoodsTimeoutSeconds`. Keep redirects disabled, protocols limited, response bytes capped, `CURLOPT_SSL_VERIFYPEER=1`, `CURLOPT_SSL_VERIFYHOST=2`, and `CURLSSLOPT_NATIVE_CA`.

- [ ] **Step 5: Register and validate the async bridge call**

Add constants:

```cpp
constexpr size_t kMaxGoodsDetailsCount = 50;
constexpr size_t kMaxGoodsDetailsSerializedBytes = 8192;
```

Implement `ParseGoodsDetailsRequest(args, &res_ids)` using nlohmann/json. Require exactly one argument, an object containing only `resIds`, an array length 1..50, each element a non-empty numeric string with maximum length 128, and total serialized bytes no more than 8192. Bind `getContentGoodsDetails` with the existing `SharedState`, `ResolveIfActive`, `EncodeApiSuccess`, `ApiErrorJson`, and `LogSummary` pattern. The summary method name is `getContentGoodsDetails`; no ID or response body is logged.

- [ ] **Step 6: Add the renderer allowlist entry**

Add:

```js
getContentGoodsDetails: Object.freeze({
  bridgeName: 'getContentGoodsDetails',
  createArgs: function (payload) {
    if (!isRecord(payload) || Object.keys(payload).length !== 1 ||
        !Array.isArray(payload.resIds) || payload.resIds.length < 1 ||
        payload.resIds.length > 50 ||
        payload.resIds.some(function (id) {
          return typeof id !== 'string' || !/^\d+$/.test(id) || id.length > 128;
        })) {
      throw createProtocolError('INVALID_ARGUMENT', 'resIds 参数无效');
    }
    return [JSON.stringify({ resIds: payload.resIds })];
  }
}),
```

- [ ] **Step 7: Run contracts and compile CAD Debug x64**

Run:

```powershell
node --test tests/cad-parametric-api-client-contract.test.js tests/cad-parametric-model-bridge-contract.test.js tests/render-preview-rpc-contract.test.js
& 'C:\Program Files (x86)\Microsoft Visual Studio\2019\Community\MSBuild\Current\Bin\amd64\MSBuild.exe' `
  'C:\Users\User\Desktop\cad_plugin\KeCADPlugin.sln' `
  /m /p:Configuration=Debug /p:Platform=x64
```

Expected: focused tests pass; MSBuild succeeds. The existing PostBuild step may refresh the Support ARX.

- [ ] **Step 8: Commit only OCCT contract tests**

Run from the OCCT worktree:

```powershell
git add -- tests/cad-parametric-api-client-contract.test.js tests/cad-parametric-model-bridge-contract.test.js tests/render-preview-rpc-contract.test.js
git commit -m "test: cover CAD batch goods bridge"
git -C C:\Users\User\Desktop\cad_plugin status --short
```

Expected: test changes are committed in OCCT. CAD C++/JS changes remain unstaged and uncommitted, including README.

---

### Task 5: Build the Shared Z-Up Placement Pipeline

**Files:**
- Create: `src/components/ContentModelPlacement.js`
- Create: `tests/content-model-placement.test.js`
- Modify: `src/components/ParametricModelLoader.js`
- Modify: existing orientation/anchor/debug tests to import the compatibility exports unchanged.

**Interfaces:**
- Consumes: prototype `THREE.Object3D`, `ContentModelInstance`, and selected template resource.
- Produces: `createYUpToZUpTransform(): THREE.Matrix4`.
- Produces: `createPlanTransform(instance): THREE.Matrix4`.
- Produces: `computeTargetScale(instance, selection, modelBox, resourceKind): THREE.Vector3`.
- Produces: `computeModelPlacementOffset(instance, modelBox, scale): THREE.Vector3`.
- Produces: `placeContentModel(prototype, instance, selection, resource): THREE.Group`.
- Produces: `createContentDebugInfo(...)` containing no resource URLs.

- [ ] **Step 1: Write failing tests for axis, size, anchor, and matrix order**

Create `tests/content-model-placement.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
    createYUpToZUpTransform, computeTargetScale, placeContentModel,
} from '../src/components/ContentModelPlacement.js';

const instance = {
    instanceId: 'soft_list:0', sourceList: 'soft_list', sourceIndex: 0,
    category: 'soft', typeId: 'chair',
    basePoint: { x: 1000, y: 2000, z: 0 },
    footprint: [
        { x: 900, y: 1900 }, { x: 1100, y: 1900 },
        { x: 1100, y: 2100 }, { x: 900, y: 2100 },
    ],
    size: { x: 200, y: 200, z: 800 }, rotationDegrees: 90,
    horizontalFlip: true, verticalFlip: false,
    outScale: { x: 1, y: 1, z: 1 }, groundHeight: 0, modelParams: [],
};

test('Y-up model height becomes positive world Z', () => {
    const vector = new THREE.Vector3(0, 1, 0).applyMatrix4(createYUpToZUpTransform());
    assert.ok(Math.abs(vector.z - 1) < 1e-9);
});

test('static scaling uses template reference centimeters and scene millimeters', () => {
    const scale = computeTargetScale(instance, {
        referenceSize: { x: 20, y: 20, z: 80 },
    }, new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(20, 20, 80)),
    'static-glb');
    assert.deepEqual(scale.toArray(), [10, 10, 10]);
});

test('template XMirror composes with CAD horizontal flip using XOR', () => {
    const prototype = new THREE.Mesh(
        new THREE.BoxGeometry(20, 80, 20), new THREE.MeshBasicMaterial(),
    );
    const root = placeContentModel(prototype, instance, {
        typeId: 'chair', typeName: '椅子', resId: '1', xMirror: true,
        referenceSize: { x: 20, y: 20, z: 80 }, selection: 'nearest-area',
    }, { kind: 'static-glb', resourceType: 1, modelType: 1, contentHash: 'm' });
    assert.equal(root.userData.debugInfo.transform.horizontalFlip, false);
});

test('placed models stay upright and align footprint center and bottom', () => {
    const prototype = new THREE.Mesh(
        new THREE.BoxGeometry(20, 80, 20), new THREE.MeshBasicMaterial(),
    );
    const root = placeContentModel(prototype, instance, {
        typeId: 'chair', typeName: '椅子', resId: '1',
        referenceSize: { x: 20, y: 20, z: 80 }, selection: 'nearest-area',
    }, { kind: 'static-glb', resourceType: 1, modelType: 1, contentHash: 'm' });
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    assert.ok(Math.abs(center.x - 1000) < 1e-6);
    assert.ok(Math.abs(center.y - 2000) < 1e-6);
    assert.ok(Math.abs(box.min.z) < 1e-6);
    assert.ok(box.getSize(new THREE.Vector3()).z > 700);
});
```

Add cases for BasePoint at a footprint corner, vertical flip, nonzero BasePoint Z plus ground height, empty/zero boxes returning `MODEL_SIZE_UNRESOLVED`, and `createContentDebugInfo` omitting `sourceUrl`.

- [ ] **Step 2: Run the placement tests and verify failure**

Run:

```powershell
node --test tests/content-model-placement.test.js
```

Expected: FAIL because the placement module does not exist.

- [ ] **Step 3: Implement placement in the required order**

Use this wrapper structure so matrix responsibilities remain explicit:

```text
contentRoot (world translation)
  planRotation (Rz)
    planFlip (local XY signs)
      sizeScale (positive resource/unit scaling)
        axisConvertedPrototype (Y-up -> Z-up and local anchor offset)
```

`placeContentModel` must deep-clone the prototype, apply the Y-up-to-Z-up matrix before calculating its bounding box, derive a positive unit/size scale from template reference size and CAD target size, offset the converted model so the scaled box center reaches the footprint center in block-local coordinates, and put the scaled box bottom on `basePoint.z + groundHeight`. Mark negative-flip materials DoubleSide. Reject non-finite/degenerate bounds with an Error whose `code` is `MODEL_SIZE_UNRESOLVED`.

Compute effective horizontal flip as `instance.horizontalFlip !== selection.xMirror` (boolean XOR). Use explicit CAD `groundHeight` when the field exists; otherwise use template `GroundDist` directly in scene millimeters. Footprint world dimensions are authoritative and already include CAD block scaling, so do not multiply them by `outScale` again. Only when footprint dimensions are unavailable may local `Size` be multiplied by the absolute `outScale` values.

For parameterized OBJ, use its converted bounds as the requested output size and only apply an explicit unit normalization inferred from nonzero template reference dimensions; do not distort it again to force the CAD footprint after `modelUrlToObj` has applied parameters.

- [ ] **Step 4: Preserve compatibility exports**

In `ParametricModelLoader.js`, re-export:

```js
export {
    createPlanTransform,
    createYUpToZUpTransform,
    computeModelPlacementOffset,
} from './ContentModelPlacement.js';
```

Keep `createParametricDebugInfo` as a compatibility adapter to `createContentDebugInfo` until Task 7 switches click/debug consumers.

- [ ] **Step 5: Run all placement/orientation/debug tests**

Run:

```powershell
node --test tests/content-model-placement.test.js tests/parametric-model-up-axis.test.js tests/parametric-model-anchor.test.js tests/softlist-orientation.test.js tests/parametric-model-debug-info.test.js
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit the OCCT task**

Run:

```powershell
git add -- src/components/ContentModelPlacement.js src/components/ParametricModelLoader.js tests/content-model-placement.test.js tests/parametric-model-up-axis.test.js tests/parametric-model-anchor.test.js tests/softlist-orientation.test.js tests/parametric-model-debug-info.test.js
git commit -m "feat: unify content model placement"
```

---

### Task 6: Load Static GLB and Parameterized OBJ Prototypes

**Files:**
- Create: `src/components/ContentModelLoader.js`
- Create: `tests/content-model-loader.test.js`
- Modify: `src/components/ParametricModelLoader.js`
- Modify: `tests/parametric-loader-api-boundary.test.js`

**Interfaces:**
- Consumes: instances, `ContentTemplateResolver`, `ParametricApiClient`, `resolveModelResource`, and `placeContentModel`.
- Produces: `ContentModelLoader.load(instances, sceneGroup, options): Promise<{groups,summary,failures,selections}>`.
- Produces: `loadContentModels(instances, sceneGroup, options)` singleton wrapper.
- Produces: `loadParametricModels(...)` compatibility wrapper delegated to the unified loader.

- [ ] **Step 1: Write failing loader dispatch and cache tests**

Create injected fakes in `tests/content-model-loader.test.js`. The first test provides one type-1 and one type-8 selection and asserts:

```js
assert.deepEqual(apiCalls.goods, [['100', '200']]);
assert.deepEqual(loaderCalls.gltf, ['https://file.test/static.kb']);
assert.deepEqual(apiCalls.convert, [{
    url: 'https://file.test/param.json', parameters: [{ name: '宽度', value: 800 }],
}]);
assert.equal(result.summary.staticLoaded, 1);
assert.equal(result.summary.parametricLoaded, 1);
assert.equal(result.groups.length, 2);
```

The second test creates two instances that select the same static cache key and asserts the GLTF prototype loader runs once but returns two different root objects. The third test creates two parameter arrays with different property order and asserts normalized parameters deduplicate conversion. The fourth test makes one GLTF load reject and asserts the parameterized model still loads and the failure code is `STATIC_MODEL_LOAD_FAILED`.

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```powershell
node --test tests/content-model-loader.test.js
```

Expected: FAIL because `ContentModelLoader.js` does not exist.

- [ ] **Step 3: Implement prototype loaders and caches**

Create one `GLTFLoader` and one `OBJLoader` by default, but accept `loadGltf`, `parseObj`, `templateResolver`, `apiClient`, and `placeModel` injections in the constructor for tests. Define:

```js
staticCacheKey(resource) {
    return `static:${resource.resId}:${resource.contentHash || 'unversioned'}`;
}

parametricCacheKey(resource, parameters) {
    return `parametric:${resource.resId}:${resource.contentHash || 'unversioned'}:${normalizeParameters(parameters)}`;
}
```

`loadGltf(url)` wraps `GLTFLoader.loadAsync(url)` and returns `gltf.scene`. Parameterized loading calls `apiClient.convertModel(resource.sourceUrl, parameters)`, extracts OBJ using the current response rules, and parses with `OBJLoader`. Both paths reject a prototype with no Mesh. Set shadows and only add a fallback material when a mesh lacks a usable material.

Do not include `sourceUrl` in cache diagnostics, group names, userData, failure objects, or console logs.

- [ ] **Step 4: Implement orchestration and summary**

The load sequence is:

1. `await templateResolver.load()`.
2. Select every valid instance; aggregate selection errors.
3. Fetch unique selected ResIds once through `apiClient.getGoodsDetails`.
4. Index details and resolve static/parameter resources.
5. Load prototypes with concurrency 3 and flight deduplication.
6. Clone/place each instance and add successful roots to `sceneGroup`.
7. Return exact summary keys:

```js
{
    instances, selected, detailsResolved, staticLoaded, parametricLoaded,
    fallbackVisible, skipped, failed,
}
```

Failures contain only `instanceId`, `sourceList`, `sourceIndex`, `typeId`, `resId`, `errorCode`, and a sanitized message. Log one summary object and one grouped error-count object after completion.

- [ ] **Step 5: Replace the parameter-only compatibility path**

Export `loadParametricModels` from `ParametricModelLoader.js` as a thin adapter that accepts old softlist records, converts them to the normalized subset expected by `loadContentModels`, and returns `result.groups`. Remove direct goods-detail calls, URL caches, model caches, OBJ parsing, and placement orchestration from that file. Retain only compatibility exports covered by existing tests.

Update `parametric-loader-api-boundary.test.js` to require that `ContentModelLoader` owns resource dispatch and that neither loader embeds upstream hostnames or native methods.

- [ ] **Step 6: Run focused and full tests**

Run:

```powershell
node --test tests/content-model-loader.test.js tests/parametric-loader-api-boundary.test.js
npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit the OCCT task**

Run:

```powershell
git add -- src/components/ContentModelLoader.js src/components/ParametricModelLoader.js tests/content-model-loader.test.js tests/parametric-loader-api-boundary.test.js
git commit -m "feat: load static and parametric content models"
```

---

### Task 7: Integrate Content Models, Door/Window Fallbacks, and Debug Clicking

**Files:**
- Modify: `src/core/GeometryService.js`
- Modify: `src/App.js`
- Modify: `src/App3D.js`
- Modify: `src/App_VR.js`
- Modify: `src/components/DoorWindowFactory.js`
- Modify: `src/components/RoomRenderer.js`
- Modify: `src/components/SceneClickInteraction.js`
- Modify: `src/components/RoomInfoView.js`
- Create: `tests/content-model-scene-integration.test.js`
- Modify: `tests/scene-click-interaction.test.js`

**Interfaces:**
- Consumes: `parseData.content_models` and `loadContentModels` result.
- Produces: `GeometryService.getContentModels(): Promise<{success:true,contentModels:ContentModelInstance[]}>`.
- Produces: visible fallback identity `userData.sourceList` + `userData.sourceIndex`.
- Produces: `findContentModelRoot`, `logContentModelDebug`, and model-first click classification.

- [ ] **Step 1: Write failing service and fallback identity tests**

In `tests/content-model-scene-integration.test.js`, construct parsed data with one door, one window, and four content models. Assert `getContentModels()` returns all four normalized records. Call `DoorWindowFactory.createDoorWindowBatch` and assert:

```js
assert.equal(door.userData.sourceList, 'door_list');
assert.equal(door.userData.sourceIndex, 0);
assert.equal(window.userData.sourceList, 'window_list');
assert.equal(window.userData.sourceIndex, 0);
```

Test a pure exported helper:

```js
const fallbackMap = indexDoorWindowFallbacks({ doors: [door], windows: [window] });
hidePlacedFallback(fallbackMap, { sourceList: 'door_list', sourceIndex: 0 });
assert.equal(door.visible, false);
assert.equal(window.visible, true);
```

- [ ] **Step 2: Write failing unified click/debug tests**

Update `scene-click-interaction.test.js` so a root with:

```js
root.userData = {
    type: 'content-model',
    contentModelRoot: true,
    debugInfo: {
        instanceId: 'soft_list:0', sourceList: 'soft_list', sourceIndex: 0,
        category: 'soft', typeId: '225903', mappedTypeId: '225903',
        resId: '1316568', resourceKind: 'static-glb',
    },
};
```

is classified as `{kind:'model', modelRoot:root}` and logs in exact `#debug` mode. Assert `JSON.stringify(debugInfo)` contains no `http`, `sourceUrl`, `webV2Url`, or `parameterizedJsonUrl`.

- [ ] **Step 3: Run focused tests and verify failure**

Run:

```powershell
node --test tests/content-model-scene-integration.test.js tests/scene-click-interaction.test.js
```

Expected: FAIL because the new service, fallback helpers, and content root markers do not exist.

- [ ] **Step 4: Expose content models through the app data flow**

Add:

```js
async getContentModels() {
    this.ensureReady();
    return { success: true, contentModels: this.parseData.content_models || [] };
}
```

In each app entry, include `geometryService.getContentModels()` in the existing `Promise.all` and pass `contentModels` in the object supplied to `RoomRenderer.render`. Keep `getSoftlists()` for 2D/legacy callers.

- [ ] **Step 5: Add stable fallback identity and visibility switching**

When `DoorWindowFactory` creates visible meshes, set `sourceList` and `sourceIndex`; do not attach those fields to CSG cutter meshes unless harmless. Export `indexDoorWindowFallbacks` and `hidePlacedFallback` from a focused helper location in `RoomRenderer.js` or `ContentModelLoader.js`.

In `RoomRenderer.render`, keep wall/outline CSG unchanged, replace the fire-and-forget `loadParametricModels` call with:

```js
const fallbackMap = indexDoorWindowFallbacks(doorWindowMeshes);
loadContentModels(data.contentModels?.contentModels || [], this.sceneGroup, {
    concurrency: 3,
    onInstancePlaced: (instance) => hidePlacedFallback(fallbackMap, instance),
}).then(({ summary, failures }) => {
    console.log('[ContentLoader] 户型模型汇总', summary);
    if (failures.length) console.warn('[ContentLoader] 未加载模型', failures);
}).catch(error => {
    console.warn('[ContentLoader] 内容模型管线失败', {
        code: error.code || 'UNKNOWN_ERROR', message: error.message,
    });
});
```

The callback runs only after a real model is in the scene, so failed door/window instances retain visible fallbacks and all CSG cutters remain untouched.

- [ ] **Step 6: Generalize click/debug behavior**

Rename the internal traversal helpers to `findContentModelRoot` and `logContentModelDebug`, while exporting aliases `findParametricSoftlistRoot` and `logParametricSoftlistDebug` for compatibility. `RoomInfoView` raycast targets visible Mesh children whose ancestor has `contentModelRoot === true`; the closest model still wins over the floor.

- [ ] **Step 7: Run focused and full tests**

Run:

```powershell
node --test tests/content-model-scene-integration.test.js tests/scene-click-interaction.test.js
npm test
```

Expected: all tests pass, including room-dialog toggle assertions.

- [ ] **Step 8: Commit the OCCT task**

Run:

```powershell
git add -- src/core/GeometryService.js src/App.js src/App3D.js src/App_VR.js src/components/DoorWindowFactory.js src/components/RoomRenderer.js src/components/SceneClickInteraction.js src/components/RoomInfoView.js tests/content-model-scene-integration.test.js tests/scene-click-interaction.test.js
git commit -m "feat: integrate CAD content models into scenes"
```

---

### Task 8: Verify Drawing2, Build Frontend, and Review the Implementation

**Files:**
- Create: `tests/drawing2-content-coverage.test.js`
- Inspect: all OCCT files changed in Tasks 1–7
- Build output: `dist-3d/**` (do not commit unless already tracked by project policy)

**Interfaces:**
- Consumes: complete content pipeline.
- Produces: deterministic coverage report for `Drawing2.json` and verified 3D/VR bundles.

- [ ] **Step 1: Add a data-level coverage test**

The test must load real Drawing2/template fixtures, then assert:

```js
assert.equal(instances.filter(item => item.sourceList === 'soft_list').length, 62);
assert.equal(new Set(instances.filter(item => item.sourceList === 'soft_list')
    .map(item => item.typeId)).size, 38);
assert.ok(selections.filter(item => item.resId).length >= 56);
assert.ok(selections.some(item => item.resId === '1316568'));
assert.ok(selections.some(item => item.resId === '975654'));
```

Generate the goods-request set from successful selections and assert it contains both audited static ResId `1961100` and audited parameterized ResId `2406734` when present in the selected fixture results. Do not call the network from this test.

- [ ] **Step 2: Run the complete test suite**

Run:

```powershell
npm test
```

Expected: zero failures. Record pass/fail/skip counts.

- [ ] **Step 3: Build the 3D/VR bundle**

Run:

```powershell
npm run build:3d
```

Expected: Vite succeeds; `dist-3d/index-3d.html`, `dist-3d/index-vr.html`, `dist-3d/assets`, and `dist-3d/data` exist. Search the bundles and assert they contain `getContentGoodsDetails` but do not contain raw signed URLs captured during investigation.

- [ ] **Step 4: Run standalone browser visual verification**

Start the existing Demo backend from `C:\Users\User\Desktop\parametric-lab\backend` and the OCCT 3D dev server. Open `http://127.0.0.1:3030/index-3d.html#debug` with the in-app browser and inspect the loaded `Drawing2.json` scene.

Verify:

- static and parameterized models both appear;
- models are upright;
- sampled furniture centers match their footprint/BasePoint;
- flips and rotations match the 2D plan from above;
- real door/window success hides only its corresponding fallback;
- clicking a model logs TypeId, selected ResId, resource kind, source list/index, and world bounds without a signed URL;
- repeated room clicks still toggle the existing panel.

Capture screenshots for at least one overall view and two problem instances. Do not add screenshots to git unless requested.

- [ ] **Step 5: Perform implementation review**

Review the complete diff against `docs/superpowers/specs/2026-07-28-cad-content-model-loader-design.md`. Check specifically for arbitrary URL proxies, Node fallback in CAD, URL leakage, unbounded caches/responses, automatic `*_list` discovery, door/window CSG removal, and mutable prototype sharing. Fix any finding with a failing regression test before continuing.

- [ ] **Step 6: Commit the coverage/review task**

Run:

```powershell
git add -- tests/drawing2-content-coverage.test.js
git commit -m "test: verify Drawing2 content coverage"
```

Expected: OCCT worktree is clean after the commit, excluding ignored build output.

---

### Task 9: Build CAD, Manually Deploy Assets, and Verify the Real WebView

**Files:**
- Build: `C:\Users\User\Desktop\cad_plugin\KeCADPlugin.sln`
- Replace without commit: `C:\Users\User\Desktop\cad_plugin\build_resource\PluginResource\html\renderer\preview3d/**`
- Replace without commit: `C:\Users\User\Desktop\cad_plugin\build_resource\PluginResource\html\renderer\preview-vr/**`
- Replace runtime cache: `C:\Users\User\AppData\Local\ke_arx_cache\2021\PluginResource\html\renderer\preview3d/**`
- Replace runtime cache: `C:\Users\User\AppData\Local\ke_arx_cache\2021\PluginResource\html\renderer\preview-vr/**`

**Interfaces:**
- Consumes: verified `dist-3d` build and CAD C++ working-tree changes.
- Produces: Debug/Release ARX builds and identical renderer artifacts in source resource and active cache locations.

- [ ] **Step 1: Recheck exact destination paths and current CAD status**

Run:

```powershell
$cadRenderer = (Resolve-Path 'C:\Users\User\Desktop\cad_plugin\build_resource\PluginResource\html\renderer').Path
$cacheRenderer = (Resolve-Path 'C:\Users\User\AppData\Local\ke_arx_cache\2021\PluginResource\html\renderer').Path
$cadRenderer
$cacheRenderer
git -C C:\Users\User\Desktop\cad_plugin status --short
```

Expected: both resolved paths exactly match the named renderer directories. The CAD status includes the intentional C++/renderer changes and original README modification. Stop if either path resolves elsewhere.

- [ ] **Step 2: Manually refresh `preview3d` and `preview-vr`**

For each destination separately, inspect its current direct children, remove only the old hashed files inside that destination's `assets` directory, copy the new `dist-3d/assets/*`, copy `index-3d.html` as `preview3d/index.html` and `index-vr.html` as `preview-vr/index.html`, and copy the required `data` tree. Use `Copy-Item -LiteralPath` for individual known files/directories after path validation; do not create or save a script.

Repeat the same explicit copies for the active cache renderer. Do not remove `render_preview.html`, `render_preview.css`, `render_preview.js`, `cartoon`, or any sibling directory.

Run the following in one PowerShell session after Step 1 has printed and verified both roots:

```powershell
$buildRoot = (Resolve-Path 'D:\occt_demo\.worktrees\cad-renderer-parametric-bridge\dist-3d').Path
$previewTargets = @(
  (Join-Path $cadRenderer 'preview3d'),
  (Join-Path $cadRenderer 'preview-vr'),
  (Join-Path $cacheRenderer 'preview3d'),
  (Join-Path $cacheRenderer 'preview-vr')
)
$expectedRoots = @($cadRenderer, $cacheRenderer)
foreach ($target in $previewTargets) {
  $resolvedTarget = (Resolve-Path -LiteralPath $target).Path
  if (-not ($expectedRoots | Where-Object {
    $resolvedTarget.StartsWith($_ + '\', [System.StringComparison]::OrdinalIgnoreCase)
  })) {
    throw "Unexpected renderer target: $resolvedTarget"
  }
  $assetDir = (Resolve-Path -LiteralPath (Join-Path $resolvedTarget 'assets')).Path
  Get-ChildItem -LiteralPath $assetDir -File | ForEach-Object {
    if ($_.Directory.FullName -ne $assetDir) {
      throw "Unexpected asset path: $($_.FullName)"
    }
    Remove-Item -LiteralPath $_.FullName -Force
  }
  Get-ChildItem -LiteralPath (Join-Path $buildRoot 'assets') -File | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $assetDir -Force
  }
  Copy-Item -LiteralPath (Join-Path $buildRoot 'data') -Destination $resolvedTarget -Recurse -Force
}
Copy-Item -LiteralPath (Join-Path $buildRoot 'index-3d.html') -Destination (Join-Path $cadRenderer 'preview3d\index.html') -Force
Copy-Item -LiteralPath (Join-Path $buildRoot 'index-vr.html') -Destination (Join-Path $cadRenderer 'preview-vr\index.html') -Force
Copy-Item -LiteralPath (Join-Path $buildRoot 'index-3d.html') -Destination (Join-Path $cacheRenderer 'preview3d\index.html') -Force
Copy-Item -LiteralPath (Join-Path $buildRoot 'index-vr.html') -Destination (Join-Path $cacheRenderer 'preview-vr\index.html') -Force
```

- [ ] **Step 3: Build Debug and Release x64**

Run:

```powershell
& 'C:\Program Files (x86)\Microsoft Visual Studio\2019\Community\MSBuild\Current\Bin\amd64\MSBuild.exe' `
  'C:\Users\User\Desktop\cad_plugin\KeCADPlugin.sln' `
  /m /p:Configuration=Debug /p:Platform=x64
& 'C:\Program Files (x86)\Microsoft Visual Studio\2019\Community\MSBuild\Current\Bin\amd64\MSBuild.exe' `
  'C:\Users\User\Desktop\cad_plugin\KeCADPlugin.sln' `
  /m /p:Configuration=Release /p:Platform=x64
```

Expected: both builds succeed with zero compiler/linker errors.

- [ ] **Step 4: Verify deployed file hashes**

Compare SHA-256 for each current hashed asset and index file across `dist-3d`, CAD renderer, and runtime cache. Compare the newly built Debug ARX with:

```text
C:\Users\User\AppData\Roaming\Autodesk\AutoCAD 2021\R24.0\chs\Support\ADSKKeCADPlugin.arx
```

Expected: corresponding hashes match. Account for the intentional index filename rename only; file contents remain identical.

- [ ] **Step 5: Verify real CAD WebView without Node**

Ensure the Node backend is stopped, launch/reload the CAD plugin, open the 3D preview, and load `Drawing2.json`. Verify:

- `[ParametricBridge] method=getContentGoodsDetails status=200` appears with batch count/bytes but no URL;
- both type-1 static and type-8 parameterized models render;
- models are upright and align with the plan;
- click debug identifies suspected missing instances by source/type/resId;
- door/window fallbacks disappear only where the real model succeeded;
- a failed/missing resource leaves the rest of the scene usable;
- closing and reopening preview produces no crash or late callback.

If a placement defect is found, return to Task 5 with a failing test. If a resource-selection defect is found, return to Task 2 or 3 with a failing test. Rebuild and redeploy only after the regression test passes.

- [ ] **Step 6: Final verification and repository audit**

Run:

```powershell
npm test
npm run build:3d
git status --short --branch
git -C C:\Users\User\Desktop\cad_plugin status --short
git -C C:\Users\User\Desktop\cad_plugin diff --cached --name-only
```

Expected:

- OCCT tests/build pass and the worktree is clean.
- CAD shows intended unstaged C++/renderer changes plus the pre-existing README modification.
- CAD cached diff is empty; there is no CAD commit or push.
- Final handoff lists loaded/skipped/failed model counts, build results, actual visual checks, CAD changed files, and runtime cache paths.
