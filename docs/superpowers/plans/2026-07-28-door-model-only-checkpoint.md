# Door-model-only Checkpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove visible local door Box meshes while preserving window Boxes and all door/window CSG cutters.

**Architecture:** Add one pure render-set selector in `RoomRenderer.js`. The selector returns no visible doors, preserves visible windows, and leaves the independently created cutter arrays unchanged; scene insertion, result metadata, and fallback indexing all consume the selected visible set.

**Tech Stack:** JavaScript ES modules, Three.js, Node test runner, Vite.

## Global Constraints

- Process only `door_list` in this checkpoint.
- Keep `window_list` Box behavior unchanged.
- Preserve non-visible door and window CSG cutters.
- Door model failures leave empty openings and log only allowlisted fields.
- Do not change or commit the CAD native bridge.

---

### Task 1: Split visible fallbacks from CSG cutters

**Files:**
- Modify: `src/components/RoomRenderer.js`
- Test: `tests/content-model-scene-integration.test.js`

**Interfaces:**
- Consumes: `{ doors, windows }` visible Box meshes and `{ doors, windows }` processed cutter meshes
- Produces: `createDoorWindowRenderSets(visibleMeshes, cutterMeshes)` returning `{ visible: { doors: [], windows }, cutters }`

- [x] **Step 1: Write the failing render-set test**

Create distinct door Box, window Box, door cutter, and window cutter meshes. Assert that `visible.doors` is empty, `visible.windows` contains the original window Box, and both cutter arrays retain their original mesh identities.

- [x] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/content-model-scene-integration.test.js`

Expected: FAIL because `createDoorWindowRenderSets` is not exported.

- [x] **Step 3: Implement the minimum scene integration**

Add the selector and make `RoomRenderer.render()` use `renderSets.visible` for `result.doorMeshes`, `result.windowMeshes`, visible scene insertion, wall-selection registration, and `indexDoorWindowFallbacks()`. Continue using `renderSets.cutters` for outline and wall CSG operations.

- [x] **Step 4: Run focused and full verification**

Run:

```powershell
node --test tests/content-model-scene-integration.test.js tests/content-model-loader.test.js
npm.cmd test
npm.cmd run build:3d
```

Expected: all tests and build pass.

- [x] **Step 5: Synchronize and verify deployment**

Copy the new `dist-3d` assets, matching entry file, and data into both CAD `preview3d`/`preview-vr` directories under the project resource tree and `ke_arx_cache`. Verify the current hashed bundles in all four destinations match the source SHA-256 hashes.

- [x] **Step 6: Commit the OCCT checkpoint**

```powershell
git add src/components/RoomRenderer.js tests/content-model-scene-integration.test.js docs/superpowers/plans/2026-07-28-door-model-only-checkpoint.md
git commit -m "feat: render doors from backend models only"
```
