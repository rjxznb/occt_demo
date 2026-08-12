# Panorama Horizontal FOV Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Interpret CAD/UE panorama point FOV as horizontal degrees while supplying Three.js with an aspect-correct vertical FOV.

**Architecture:** Add pure projection conversion helpers under `src/core`, then make `SceneManager` retain the active panorama horizontal FOV as authoritative state. Every preset entry, transition, reset, wheel zoom, pose read and resize flows through one projection method; ordinary 3D camera state remains untouched.

**Tech Stack:** JavaScript ES modules, Three.js `PerspectiveCamera`, Node.js built-in test runner, Vite.

## Global Constraints

- Persisted panorama point `fov` values remain horizontal FOV values.
- Three.js `PerspectiveCamera.fov` receives only a vertical FOV.
- Live viewport aspect controls projection; saved historical `AspectRatio` does not.
- Horizontal panorama FOV is clamped to 30–120 degrees.
- Invalid aspect ratios fall back to 16:9.
- Ordinary 3D camera behavior and CAD Plugin are out of scope.

---

### Task 1: Pure FOV Projection Helpers

**Files:**
- Create: `src/core/CameraFov.js`
- Create: `tests/camera-fov.test.js`

**Interfaces:**
- Produces: `normalizeAspect(aspect): number`
- Produces: `horizontalToVerticalFov(horizontalDegrees, aspect): number`
- Produces: `verticalToHorizontalFov(verticalDegrees, aspect): number`
- Produces: `clampPanoramaHorizontalFov(degrees): number`

- [ ] **Step 1: Write the failing conversion tests**

Add tests asserting that horizontal 90 degrees becomes approximately 58.7155 vertical degrees at 16:9, round-trips at 4:3, invalid aspect falls back to 16:9, and panorama FOV clamps to 30–120.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/camera-fov.test.js`

Expected: FAIL because `src/core/CameraFov.js` does not exist.

- [ ] **Step 3: Implement the pure helpers**

Use the projection equations:

```js
const verticalRadians = 2 * Math.atan(Math.tan(horizontalRadians / 2) / safeAspect);
const horizontalRadians = 2 * Math.atan(Math.tan(verticalRadians / 2) * safeAspect);
```

Normalize non-finite or non-positive aspect values to `16 / 9` and clamp horizontal panorama values with `THREE.MathUtils.clamp`-equivalent numeric logic without introducing a Three.js dependency into the helper.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test tests/camera-fov.test.js`

Expected: all conversion tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/core/CameraFov.js tests/camera-fov.test.js
git commit -m "feat: add panorama fov projection helpers"
```

### Task 2: SceneManager Horizontal FOV State

**Files:**
- Modify: `src/core/SceneManager.js:1-130,383-405,565-815`
- Modify: `tests/panorama-scene-view.test.js`
- Modify: `tests/camera-preset-view.test.js`

**Interfaces:**
- Consumes: `horizontalToVerticalFov(horizontalDegrees, aspect)` and `clampPanoramaHorizontalFov(degrees)` from Task 1.
- Produces: `SceneManager.cameraPresetHorizontalFov: number | null`
- Produces: `SceneManager.applyCameraPresetHorizontalFov(horizontalDegrees): boolean`
- Preserves: `getCameraPresetPose().fov` as horizontal degrees.

- [ ] **Step 1: Write failing preset projection tests**

Update the test manager to use aspect 16:9. Assert that entering/resetting a 90-degree preset exposes pose FOV 90 while the Three.js camera vertical FOV is approximately 58.7155. Assert that a transition midpoint interpolates horizontal FOV, not vertical FOV.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/panorama-scene-view.test.js tests/camera-preset-view.test.js`

Expected: FAIL because the camera still stores preset FOV directly as vertical FOV.

- [ ] **Step 3: Implement authoritative horizontal FOV state**

Initialize `cameraPresetHorizontalFov` to `null`. Add `applyCameraPresetHorizontalFov()` to clamp/store the horizontal value, convert it with `perspectiveCamera.aspect`, assign the vertical result, and update the projection matrix. Use it in `setCameraPreset`, transition frames, reset/update operations and wheel zoom. Make `getCameraPresetPose()` return the stored horizontal value. Clear it in `exitCameraPreset()` after restoring the ordinary camera's saved vertical FOV.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/panorama-scene-view.test.js tests/camera-preset-view.test.js`

Expected: all fixed-point camera tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/core/SceneManager.js tests/panorama-scene-view.test.js tests/camera-preset-view.test.js
git commit -m "fix: interpret panorama point fov as horizontal"
```

### Task 3: Resize Stability and Final Verification

**Files:**
- Modify: `tests/panorama-scene-view.test.js`
- Modify: `src/core/SceneManager.js:383-405`

**Interfaces:**
- Consumes: `SceneManager.cameraPresetHorizontalFov` and `applyCameraPresetHorizontalFov()` from Task 2.
- Produces: resize behavior that preserves the active horizontal FOV while recomputing vertical projection.

- [ ] **Step 1: Write the failing resize regression test**

Create an active preset manager with horizontal FOV 90 and aspect 16:9, change its viewport aspect to 4:3 through the resize path, and assert pose FOV remains 90 while camera vertical FOV becomes approximately 73.7398.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/panorama-scene-view.test.js`

Expected: FAIL because resize changes aspect without recomputing the vertical FOV.

- [ ] **Step 3: Reapply horizontal FOV during resize**

After assigning the new perspective aspect in `onWindowResize()`, call `applyCameraPresetHorizontalFov(cameraPresetHorizontalFov)` only when fixed-point mode is active; otherwise keep the existing ordinary 3D projection update.

- [ ] **Step 4: Run focused and full verification**

Run:

```powershell
node --test tests/camera-fov.test.js tests/panorama-scene-view.test.js tests/camera-preset-view.test.js
npm.cmd test
npm.cmd run build:3d
git diff --check
```

Expected: focused tests PASS, full suite has zero failures, Vite build succeeds, and `git diff --check` reports no errors.

- [ ] **Step 5: Browser visual verification**

Open the panorama fixture at `index-panorama.html?fixture=cameras#debug`. Verify that a 90-degree point no longer stretches side walls at the viewport edges, point switching remains smooth, wheel zoom remains bounded, saving an entry view preserves the visible field of view, and resizing the viewport preserves horizontal composition.

- [ ] **Step 6: Commit**

```powershell
git add src/core/SceneManager.js tests/panorama-scene-view.test.js
git commit -m "fix: preserve panorama horizontal fov on resize"
```
