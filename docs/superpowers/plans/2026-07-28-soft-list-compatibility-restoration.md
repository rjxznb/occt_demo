# Soft-list Compatibility Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore parameterized `soft_list` rendering through the proven per-resource bridge while keeping the unified loader for every other CAD content list.

**Architecture:** `RoomRenderer` partitions normalized content by `sourceList`. Legacy soft-list records are loaded by an independent `ParametricModelLoader` pipeline using `getGoodsDetail`, `convertModel`, OBJ parsing, and the shared placement utility; non-soft records continue through `ContentModelLoader`.

**Tech Stack:** JavaScript ES modules, Three.js, Node test runner, Vite.

## Global Constraints

- Do not modify the CAD WebView entry or native bridge API.
- Do not stage or commit `C:\Users\User\Desktop\cad_plugin`.
- Never send `sourceList === "soft_list"` to both loaders.
- Preserve click-debug metadata and the existing soft-list loader API.

---

### Task 1: Route soft and non-soft models independently

**Files:**
- Modify: `src/components/RoomRenderer.js`
- Test: `tests/content-model-scene-integration.test.js`

**Interfaces:**
- Consumes: `data.softlists.softlists`, `data.contentModels.contentModels`
- Produces: `filterNonSoftContentModels(instances): Array`, two isolated asynchronous loader calls

- [x] **Step 1: Write the failing routing test**

Add a test that passes literal `soft_list`, `door_list`, and `radiator_list` instances to `filterNonSoftContentModels` and expects only the latter two in their original order.

- [x] **Step 2: Run the routing test and verify RED**

Run: `node --test tests/content-model-scene-integration.test.js`

Expected: FAIL because `filterNonSoftContentModels` is not exported.

- [x] **Step 3: Implement the minimum routing change**

Export `filterNonSoftContentModels`; import `loadParametricModels`; invoke it with legacy softlists; invoke `loadContentModels` only with the filtered non-soft instances. Keep independent `.then/.catch` diagnostics.

- [x] **Step 4: Run the routing test and verify GREEN**

Run: `node --test tests/content-model-scene-integration.test.js`

Expected: PASS.

### Task 2: Restore independent per-resource soft-list loading

**Files:**
- Modify: `src/components/ParametricModelLoader.js`
- Test: `tests/parametric-loader-api-boundary.test.js`

**Interfaces:**
- Consumes: legacy softlist records, `apiClient.getGoodsDetail(resId)`, `apiClient.convertModel(url, parameters)`, template selection
- Produces: `Promise<THREE.Group[]>` with `parametric-softlist` roots and click-debug metadata

- [x] **Step 1: Replace the obsolete adapter test with a failing independent-pipeline test**

Use a complete template response, a fake per-resource client exposing `getGoodsDetail` and `convertModel`, and a real Three.js prototype parser hook. Assert the model is inserted, the selected `resId` is requested through `getGoodsDetail`, the parameterized URL is converted with CAD model parameters, and no batch method is required.

- [x] **Step 2: Run the loader test and verify RED**

Run: `node --test tests/parametric-loader-api-boundary.test.js`

Expected: FAIL because the current wrapper calls `getGoodsDetails` through `ContentModelLoader`.

- [x] **Step 3: Implement the minimum independent loader**

Use `ContentTemplateResolver` for selection, recursively locate `parameterizedJsonUrl`, call `getGoodsDetail`, call `convertModel`, parse OBJ with `OBJLoader` unless a parser is injected, place via `placeContentModel`, restore legacy metadata, cache prototype requests by selected resource and parameter values, and isolate individual failures.

- [x] **Step 4: Run the loader test and verify GREEN**

Run: `node --test tests/parametric-loader-api-boundary.test.js`

Expected: PASS.

### Task 3: Regression verification

**Files:**
- Verify only

**Interfaces:**
- Consumes: completed Tasks 1-2
- Produces: test and build evidence

- [x] **Step 1: Run all related tests**

Run: `node --test tests/parametric-loader-api-boundary.test.js tests/content-model-scene-integration.test.js tests/content-model-loader.test.js tests/parametric-model-anchor.test.js tests/parametric-model-up-axis.test.js tests/parametric-model-debug-info.test.js`

Expected: PASS.

- [x] **Step 2: Run the production build**

Run: `npm run build:3d`

Expected: exit code 0.

- [x] **Step 3: Review the final diff**

Confirm no CAD files changed, no soft record enters the unified loader, and no native bridge API changed.
