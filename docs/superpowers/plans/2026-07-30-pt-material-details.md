# PT Material Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve `BimRenderMat=5` PT references into Web-readable material descriptors so real windows render transparent glass and available base material properties.

**Architecture:** Extend the existing API client with a batched material-detail request, parse `optimizeParam` in a pure descriptor module, and let `ContentModelLoader` resolve/caches PT details before applying semantics to parsed OBJ prototypes. Never fetch or parse UE PAK files.

**Tech Stack:** JavaScript ES modules, Three.js 0.178, Node test runner, Vite.

## Global Constraints

- Modify only `D:/occt_demo/.worktrees/cad-renderer-parametric-bridge`; do not modify `cad_plugin`.
- Batch at most 50 unique `PT\\d+` codes per request.
- Material-detail failures must not prevent model placement.
- Never request `pakFileUrl` from the browser.
- Clone a Three.js material before applying resolved PT properties.

---

### Task 1: Material Details API

**Files:**
- Modify: `src/services/ParametricApiClient.js`
- Test: `tests/parametric-api-client.test.js`

**Interfaces:**
- Produces: `ParametricApiClient.getMaterialDetails(materialCodes): Promise<{items: object[]}>`
- Produces: `normalizeMaterialItems(raw): object[]`
- Produces: `indexMaterialDetails(raw): Map<string, object>`

- [ ] **Step 1: Write failing standalone and CAD routing tests**

Add tests asserting that invalid codes are removed, unique PT codes are batched in groups of 50, standalone mode posts `{materialCodes}` to `/api/getContentMaterialDetails`, and CAD mode invokes `getContentMaterialDetails` with the same payload.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/parametric-api-client.test.js`

Expected: FAIL because `getMaterialDetails` is not defined.

- [ ] **Step 3: Implement the API methods**

Follow `getGoodsDetails`: validate with `/^PT\\d+$/`, deduplicate, batch, use bounded concurrency, tolerate a failed batch when another succeeds, normalize `data`, `data.list`, or `items`, and restore request order with `indexMaterialDetails`.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/parametric-api-client.test.js`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/services/ParametricApiClient.js tests/parametric-api-client.test.js
git commit -m "feat: fetch PT material details"
```

### Task 2: PT Descriptor Parser

**Files:**
- Create: `src/components/ContentMaterialDetails.js`
- Test: `tests/content-material-details.test.js`

**Interfaces:**
- Produces: `parseContentMaterialDetail(detail): descriptor | null`
- Produces: `resolveContentMaterialDetails(details, {fetchJson}): Promise<Map<string, descriptor>>`
- Descriptor fields: `{code, name, modelType, masterMaterial, isGlass, color, parameters, source}`

- [ ] **Step 1: Write failing parser tests**

Cover BOM-prefixed outer JSON, nested `materialParameter`, `SN:0_MI_V8_Glass`, `modelType: "4"`, `100*r-g-b` base color, invalid inline JSON with `optimizeFileUrl` fallback, and absence of PAK fetching.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/content-material-details.test.js`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure parser and resolver**

Parse only finite scalar/vector values. Strip the `SN:` prefix and optional numeric slot prefix from the master material name. Treat glass master names, model type 4, and material names containing the Unicode glass label as glass. Map protocol key `100` to normalized RGB; retain unknown numeric keys in `parameters` without assigning speculative PBR meanings. Fetch only `optimizeFileUrl`, never `pakFileUrl`.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/content-material-details.test.js`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/components/ContentMaterialDetails.js tests/content-material-details.test.js
git commit -m "feat: parse PT optimization metadata"
```

### Task 3: Three.js Material Application

**Files:**
- Modify: `src/components/ContentMaterialSemantics.js`
- Test: `tests/content-material-semantics.test.js`
- Test: `tests/window-glass-material.test.js`

**Interfaces:**
- Changes: `applyContentMaterialSemantics(root, convertedMaterials, detailByCode = new Map())`
- Consumes: descriptors indexed by exact PT code.

- [ ] **Step 1: Write failing application tests**

Create a mesh whose material name matches `MatName`, provide a `BimRenderMat=5` PT entry plus a glass descriptor, and assert that the material is cloned, marked as glass, and later becomes transparent. Add an opaque descriptor test asserting that protocol color `100` changes base color while unrelated slots remain untouched.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/content-material-semantics.test.js tests/window-glass-material.test.js`

Expected: FAIL because PT descriptors are ignored.

- [ ] **Step 3: Implement descriptor application**

Clone matched materials before mutation, attach sanitized descriptor metadata, mark resolved glass explicitly, apply available base color, and preserve the current direct `BimRenderMat=3` path and unknown-material fallback.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/content-material-semantics.test.js tests/window-glass-material.test.js`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/components/ContentMaterialSemantics.js tests/content-material-semantics.test.js tests/window-glass-material.test.js
git commit -m "feat: apply resolved PT materials"
```

### Task 4: Loader Resolution and Cache

**Files:**
- Modify: `src/components/ContentModelLoader.js`
- Test: `tests/content-model-loader.test.js`

**Interfaces:**
- Consumes: `apiClient.getMaterialDetails(codes)` and `resolveContentMaterialDetails(...)`.
- Adds: per-loader PT descriptor promise cache and optimization-JSON fetch cache.

- [ ] **Step 1: Replace the obsolete no-request test with failing integration tests**

Assert that `BimRenderMat=5` requests each PT code once, repeated prototypes reuse the descriptor cache, resolved glass metadata reaches the parsed prototype, failures keep the model placed, and `.pak` URLs are never fetched.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/content-model-loader.test.js`

Expected: FAIL because the loader does not request PT details.

- [ ] **Step 3: Implement loader resolution**

Collect PT codes from converted materials, resolve missing codes through the API, parse descriptors with cached `apiClient.fetchJson`, pass the descriptor map to `applyContentMaterialSemantics`, and warn with sanitized codes/errors without rejecting the prototype.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/content-model-loader.test.js`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/components/ContentModelLoader.js tests/content-model-loader.test.js
git commit -m "feat: resolve PT materials during model loading"
```

### Task 5: Full Verification

**Files:**
- Modify only if verification exposes a regression.

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test`

Expected: zero failures.

- [ ] **Step 2: Build the 3D application**

Run: `npm run build:3d`

Expected: Vite exits with code 0.

- [ ] **Step 3: Verify the real browser scene**

Open the existing 4179 preview with a cache-busting query. Confirm no console errors, the real `Drawing2.json` corner/standard windows retain correct geometry, glass panes are transparent, and frames remain opaque.

- [ ] **Step 4: Inspect repository scope**

Run: `git status --short` and `git diff HEAD~4 --stat`.

Expected: only intended `occt_demo` files changed; no `cad_plugin` files are touched.
