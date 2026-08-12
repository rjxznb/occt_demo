# Panorama Front-Hemisphere Hotspots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide panorama point hints behind the live camera while retaining visible and edge-clamped hints across the complete front hemisphere.

**Architecture:** Keep the geometric decision inside the pure `projectPanoramaHotspot()` boundary and expose it as a `visible` result flag. `PanoramaHotspots.update()` applies that flag to each existing button every frame, so camera rotation changes visibility without rebuilding point data or affecting other navigation systems.

**Tech Stack:** JavaScript ES modules, Three.js vectors and cameras, Node.js built-in test runner, Vite.

## Global Constraints

- Points at relative angles from -90 through +90 degrees remain visible.
- Points beyond the side plane in the rear hemisphere are hidden.
- Front-hemisphere points outside the screen frustum retain edge hints.
- A point coincident with the camera is hidden because it has no direction.
- Point data, mini-map, WASD navigation, hotspot styling, ordinary 3D and CAD Plugin remain unchanged.

---

### Task 1: Front-Hemisphere Projection and Live Visibility

**Files:**
- Modify: `src/panorama/PanoramaHotspots.js:1-108`
- Modify: `tests/panorama-hotspots.test.js`

**Interfaces:**
- Extends: `projectPanoramaHotspot(point, camera, viewport): { visible: boolean, inView: boolean, left: number, top: number, angle: number }`
- Preserves: `PanoramaHotspots.render({ points, activePointId, visible })`
- Preserves: `PanoramaHotspots.update(camera)` while adding per-button `hidden` updates.

- [ ] **Step 1: Write failing projection tests**

Replace the old rear-edge expectation with literal cases:

```js
assert.equal(projectPanoramaHotspot({ x: 0, y: 0, z: -10 }, camera, viewport).visible, true);
assert.equal(projectPanoramaHotspot({ x: 10, y: 0, z: 0 }, camera, viewport).visible, true);
assert.equal(projectPanoramaHotspot({ x: 0, y: 0, z: 10 }, camera, viewport).visible, false);
assert.equal(projectPanoramaHotspot({ x: 0, y: 0, z: 0 }, camera, viewport).visible, false);
```

Also assert that a front point outside the view frustum remains `visible: true` and `inView: false` with coordinates clamped inside the configured margin.

- [ ] **Step 2: Write the failing live-rotation component test**

Render front and back point buttons, call `update()` while looking toward `-Z`, and assert the back button is hidden. Rotate the real Three.js test camera toward `+Z`, call `update()` again, and assert the same button becomes visible and invokes `onSelect` when clicked.

- [ ] **Step 3: Run the focused test and verify RED**

Run: `node --test tests/panorama-hotspots.test.js`

Expected: FAIL because rear points currently return an edge projection and buttons never receive a per-point hidden state.

- [ ] **Step 4: Implement projection visibility**

In `projectPanoramaHotspot()`, calculate camera-local distance and classify:

```js
const coincident = local.lengthSq() <= 1e-12;
const inFrontHemisphere = local.z <= 1e-6;
const visible = !coincident && inFrontHemisphere;
```

Return `{ visible: false, inView: false, left: 0, top: 0, angle: 0 }` immediately for hidden points. Add `visible: true` to both in-view and edge-clamped front-hemisphere results. Remove the rear-direction reversal because rear results no longer reach edge projection.

- [ ] **Step 5: Apply live button visibility**

In `PanoramaHotspots.update()`, assign `button.hidden = !projection.visible` for every point. Continue to the next point when hidden; otherwise update position, arrow angle, and `is-offscreen` exactly as before.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `node --test tests/panorama-hotspots.test.js`

Expected: all projection and component tests PASS.

- [ ] **Step 7: Run full verification**

Run:

```powershell
npm.cmd test
npm.cmd run build:3d
git diff --check
```

Expected: full suite has zero failures, Vite build succeeds, and the diff check reports no whitespace errors.

- [ ] **Step 8: Verify in the browser**

Open `index-panorama.html?fixture=cameras#debug`, rotate the live fixed-point camera across a point's side plane, and verify the corresponding hint is visible in front/side, hidden behind, and restored when rotating back. Confirm point switching and the global hotspot toggle still work.

- [ ] **Step 9: Commit**

```powershell
git add src/panorama/PanoramaHotspots.js tests/panorama-hotspots.test.js
git commit -m "fix: hide panorama hotspots behind camera"
```
