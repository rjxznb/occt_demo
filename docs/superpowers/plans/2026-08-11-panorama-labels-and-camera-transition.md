# Panorama Labels and Camera Transition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide room-name/area Sprite labels only on the standalone panorama page and animate user-initiated panorama point changes with an interruptible 0.8-second camera transition.

**Architecture:** `PanoramaApp` owns page-specific policy: it disables room labels after room rendering, uses immediate camera placement during startup, and requests an animated transition for later point selections. `SceneManager` owns camera mechanics through a focused `transitionCameraPreset()` API and advances its private transition state inside the existing animation loop.

**Tech Stack:** JavaScript ES modules, Three.js, Node test runner, Vite, Codex in-app Browser.

## Global Constraints

- Only the standalone panorama page changes; the existing 3D preview and VR pages retain their label behavior.
- Hide only `roomLabel` name/area Sprite objects; panorama hotspots, mini-map markers, and helpers remain visible.
- User-initiated point transitions last exactly 0.8 seconds and use an ease-in-out curve.
- Position, shortest-path yaw, pitch, and FOV transition together.
- A new point selection or pointer drag interrupts the active transition from the current live pose.
- Initial point entry and edit-mode position previews remain immediate.
- Do not add an animation dependency and do not modify CAD Plugin.

---

### Task 1: Standalone Panorama Room-Label Policy

**Files:**
- Modify: `tests/helpers/panorama-app-harness.js`
- Modify: `tests/panorama-app-startup.test.js`
- Modify: `src/PanoramaApp.js`

**Interfaces:**
- Consumes: `RoomRenderer.setRoomLabelsVisible(visible: boolean): boolean`.
- Produces: Panorama startup always requests `setRoomLabelsVisible(false)` after `RoomRenderer.render()` resolves.

- [ ] **Step 1: Extend the harness and write the failing startup test**

Add the real room-renderer interface to the harness:

```js
const roomRenderer = {
    async render(data) { calls.push(['render', data]); return { contentFailures: 0 }; },
    setRoomLabelsVisible(value) { calls.push(['room-labels', value]); return value; },
    setCeilingsVisible(value) { calls.push(['ceilings', value]); return value; },
    dispose() { calls.push(['room-dispose']); },
};
```

Add to `tests/panorama-app-startup.test.js`:

```js
test('hides only room labels after the standalone panorama scene renders', async () => {
    const { app, calls } = createHarness();

    assert.equal(await app.init(), true);
    assert.deepEqual(calls.filter(call => call[0] === 'room-labels'), [
        ['room-labels', false],
    ]);
});
```

- [ ] **Step 2: Run the test to verify RED**

Run: `node --test tests/panorama-app-startup.test.js`

Expected: FAIL because no `room-labels` call is recorded.

- [ ] **Step 3: Add the minimal panorama-only policy**

Immediately after the awaited room render in `PanoramaApp._initialize()`:

```js
await this.roomRenderer.render(clone(data), PASSIVE_WALL_REGISTRY);
this.roomRenderer.setRoomLabelsVisible(false);
this.sceneManager.setMaterialRestorationEnabled(false);
```

Do not change `RoomRenderer` defaults or `App3D`.

- [ ] **Step 4: Run the focused tests to verify GREEN**

Run: `node --test tests/panorama-app-startup.test.js tests/room-label-visibility.test.js`

Expected: PASS; the standalone app hides labels and the shared visibility API still supports both states.

- [ ] **Step 5: Commit**

```bash
git add src/PanoramaApp.js tests/helpers/panorama-app-harness.js tests/panorama-app-startup.test.js
git commit -m "feat: hide room labels in panorama view"
```

### Task 2: Interruptible Fixed-Point Camera Transition

**Files:**
- Modify: `tests/panorama-scene-view.test.js`
- Modify: `src/core/SceneManager.js`

**Interfaces:**
- Consumes: active fixed-point state from `setCameraPreset()` and target objects shaped as `{x, y, z, yaw, pitch, fov}`.
- Produces: `transitionCameraPreset(point, { duration = 0.8 } = {}): boolean`.
- Produces: `_updateCameraPresetTransition(deltaSeconds: number): void`, called by `animate()`.
- Maintains: `_cameraPresetTransition: null | { elapsed, duration, from, to, yawDelta }`.

- [ ] **Step 1: Write failing tests for interpolation and shortest yaw**

Extend `createActiveManager()` so `manager.controls.enabled = false` and `manager._cameraPresetTransition = null`, then add:

```js
test('transitions a fixed-point camera with eased position, shortest yaw, pitch, and FOV', () => {
    const manager = createActiveManager();
    manager.cameraPresetYaw = THREE.MathUtils.degToRad(170);

    assert.equal(manager.transitionCameraPreset({
        x: 900, y: 600, z: 1700,
        yaw: -170, pitch: 10, fov: 80,
    }), true);

    manager._updateCameraPresetTransition(0.4);
    const halfway = manager.getCameraPresetPose();
    assert.deepEqual([halfway.x, halfway.y, halfway.z], [500, 400, 1600]);
    assert.equal(Math.abs(Math.abs(halfway.yaw) - 180) < 1e-8, true);
    assert.equal(halfway.pitch, 0);
    assert.equal(halfway.fov, 90);

    manager._updateCameraPresetTransition(0.4);
    assert.deepEqual(manager.getCameraPresetPose(), {
        x: 900, y: 600, z: 1700,
        yaw: -170, pitch: 10, fov: 80,
    });
    assert.equal(manager._cameraPresetTransition, null);
});
```

- [ ] **Step 2: Write failing tests for interruption and inactive fallback**

Add:

```js
test('replaces an active transition from the current live camera pose', () => {
    const manager = createActiveManager();
    manager.transitionCameraPreset({ x: 900, y: 200, z: 1500, yaw: 90, pitch: 0, fov: 90 });
    manager._updateCameraPresetTransition(0.4);
    const interruptedAt = manager.getCameraPresetPose();

    assert.equal(manager.transitionCameraPreset({
        x: 300, y: 800, z: 1600, yaw: 0, pitch: 5, fov: 70,
    }), true);
    assert.deepEqual(manager._cameraPresetTransition.from, interruptedAt);
});

test('falls back to immediate preset entry when fixed-point mode is inactive', () => {
    const manager = createActiveManager();
    manager.cameraPresetViewState = null;
    manager.setCameraPreset = point => {
        manager.fallbackPoint = point;
        return true;
    };
    const point = { x: 1, y: 2, z: 3, yaw: 4, pitch: 5, fov: 90 };

    assert.equal(manager.transitionCameraPreset(point), true);
    assert.equal(manager.fallbackPoint, point);
});
```

- [ ] **Step 3: Run the tests to verify RED**

Run: `node --test tests/panorama-scene-view.test.js`

Expected: FAIL with `manager.transitionCameraPreset is not a function`.

- [ ] **Step 4: Implement minimal transition creation**

Add a finite-number target normalizer and the public method near the other fixed-point APIs:

```js
transitionCameraPreset(point, { duration = 0.8 } = {}) {
    if (!this.cameraPresetViewState) return this.setCameraPreset(point);
    const from = this.getCameraPresetPose();
    const to = {
        x: Number(point?.x),
        y: Number(point?.y),
        z: Number(point?.z),
        yaw: Number(point?.yaw),
        pitch: Number(point?.pitch),
        fov: Number(point?.fov),
    };
    if (!Object.values(to).every(Number.isFinite)) return false;
    const seconds = Number(duration);
    if (!Number.isFinite(seconds) || seconds <= 0) return this.setCameraPreset(to);
    let yawDelta = to.yaw - from.yaw;
    yawDelta = ((yawDelta + 180) % 360 + 360) % 360 - 180;
    this._cameraPresetTransition = { elapsed: 0, duration: seconds, from, to, yawDelta };
    return true;
}
```

- [ ] **Step 5: Implement frame advancement**

Add and call `_updateCameraPresetTransition(dt)` from `animate()` immediately after `_updateViewTween(dt)`:

```js
_updateCameraPresetTransition(deltaSeconds) {
    const transition = this._cameraPresetTransition;
    if (!transition || !this.cameraPresetViewState) return;
    transition.elapsed = Math.min(transition.duration, transition.elapsed + Math.max(0, deltaSeconds));
    const progress = transition.elapsed / transition.duration;
    const eased = progress * progress * (3 - 2 * progress);
    const mix = (from, to) => THREE.MathUtils.lerp(from, to, eased);
    this.perspectiveCamera.position.set(
        mix(transition.from.x, transition.to.x),
        mix(transition.from.y, transition.to.y),
        mix(transition.from.z, transition.to.z),
    );
    this.cameraPresetYaw = THREE.MathUtils.degToRad(
        transition.from.yaw + transition.yawDelta * eased,
    );
    this.cameraPresetPitch = THREE.MathUtils.degToRad(
        mix(transition.from.pitch, transition.to.pitch),
    );
    this.perspectiveCamera.fov = mix(transition.from.fov, transition.to.fov);
    this.perspectiveCamera.updateProjectionMatrix();
    this.updateCameraPresetOrientation();
    if (progress >= 1) {
        this.cameraPresetYaw = THREE.MathUtils.degToRad(transition.to.yaw);
        this._cameraPresetTransition = null;
    }
}
```

- [ ] **Step 6: Add cancellation points**

Set `this._cameraPresetTransition = null` in `setCameraPreset()`, at the start of `onCameraPresetPointerDown()`, in `exitCameraPreset()`, and in `destroy()`. Initialize it to `null` beside the other camera preset fields in the constructor.

- [ ] **Step 7: Run focused camera tests to verify GREEN**

Run: `node --test tests/panorama-scene-view.test.js tests/camera-preset-view.test.js`

Expected: PASS with exact final poses and no regression in fixed-point drag behavior.

- [ ] **Step 8: Commit**

```bash
git add src/core/SceneManager.js tests/panorama-scene-view.test.js
git commit -m "feat: animate panorama point transitions"
```

### Task 3: Route User Point Selection Through the Transition

**Files:**
- Modify: `tests/helpers/panorama-app-harness.js`
- Modify: `tests/panorama-app-state.test.js`
- Modify: `src/PanoramaApp.js`

**Interfaces:**
- Consumes: `SceneManager.transitionCameraPreset(point, { duration: 0.8 }): boolean` from Task 2.
- Produces: startup calls `setCameraPreset()` exactly once; `selectPoint()` calls `transitionCameraPreset()` for a changed valid point.

- [ ] **Step 1: Extend the harness and change the interaction test to fail**

Add to the scene-manager harness:

```js
transitionCameraPreset(point, options) {
    this.pose = { ...point };
    calls.push(['camera-transition', point.name, options]);
    return true;
},
```

Replace the final assertion in the switching test with:

```js
assert.deepEqual(calls.filter(call => call[0] === 'camera'), [
    ['camera', first.name],
]);
assert.deepEqual(calls.filter(call => call[0] === 'camera-transition'), [
    ['camera-transition', second.name, { duration: 0.8 }],
]);
```

- [ ] **Step 2: Run the test to verify RED**

Run: `node --test tests/panorama-app-state.test.js`

Expected: FAIL because `selectPoint()` still records a second immediate `camera` call and no `camera-transition` call.

- [ ] **Step 3: Add a dedicated user-transition method and wire selection**

Add beside `_enterPoint()`:

```js
_transitionToPoint(point) {
    if (!point) return false;
    this.roomRenderer.setCeilingsVisible(true);
    return this.sceneManager.transitionCameraPreset(this._pointWithView(point), {
        duration: 0.8,
    });
}
```

In `selectPoint()`, replace only the user-selection call:

```js
this._transitionToPoint(this._activePoint());
```

Keep startup, reset, edit cancel, point restoration, and newly created point placement on `_enterPoint()` so those state corrections remain immediate.

- [ ] **Step 4: Run focused app tests to verify GREEN**

Run: `node --test tests/panorama-app-state.test.js tests/panorama-app-startup.test.js`

Expected: PASS; startup enters immediately and later selection transitions.

- [ ] **Step 5: Run the complete automated verification**

Run: `npm.cmd test`

Expected: 0 failures; environment-dependent native CAD tests may remain skipped.

Run: `npm.cmd run build:3d`

Expected: Vite exits 0 and emits `dist-3d/index-panorama.html`, `dist-3d/index-3d.html`, and `dist-3d/index-vr.html`.

Run: `git diff --check`

Expected: exit 0 with no whitespace errors.

- [ ] **Step 6: Verify in the real browser**

Open the existing local page:

`http://127.0.0.1:4181/index-panorama.html?fixture=cameras&planId=demo&version=1#debug`

Confirm all of the following:

1. No room-name/area Sprite panels are visible at the initial point.
2. Hotspots and mini-map point markers remain visible.
3. Selecting point 2 from the mini-map moves and rotates smoothly for about 0.8 seconds.
4. Selecting point 3 before that transition completes redirects smoothly from the current pose.
5. Point-list, hotspot, previous, and next controls share the same transition behavior.
6. Editing a point still previews movement immediately.
7. Browser console contains no new errors or warnings.

- [ ] **Step 7: Commit**

```bash
git add src/PanoramaApp.js tests/helpers/panorama-app-harness.js tests/panorama-app-state.test.js
git commit -m "feat: smooth panorama point navigation"
```
