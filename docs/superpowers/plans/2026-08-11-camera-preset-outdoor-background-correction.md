# Camera-Preset Outdoor Background Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide the procedural outdoor panorama in ordinary 3D viewing, show it only during camera-preset preview, and orient it upright in the project's Z-up world.

**Architecture:** `SceneManager` continues to create and own one local panorama texture, but its neutral gradient remains the ordinary background. Camera-preset entry saves the current background state, installs the panorama with a Y-up-to-Z-up rotation, and exit restores the exact saved background and rotation.

**Tech Stack:** Three.js 0.178, Node.js built-in test runner, Vite 6, in-app browser validation.

## Global Constraints

- Work only in `D:\occt_demo\.worktrees\cad-renderer-parametric-bridge`.
- Do not modify, stage, commit, or deploy `C:\Users\User\Desktop\cad_plugin`.
- Do not stage or commit this correction before the user's visual checkpoint.
- Do not add network requests or new outdoor assets.
- Keep `scene.environment` and material lighting unchanged.
- Preserve the background that white-model mode or another caller had installed before preset entry.

---

### Task 1: Lock the camera-preset background lifecycle with tests

**Files:**
- Modify: `tests/outdoor-panorama.test.js`
- Verify: `tests/camera-preset-view.test.js`

**Interfaces:**
- Consumes: a real `THREE.Scene`, `SceneManager.prototype`, and an owned `outdoorPanoramaTexture`.
- Produces: behavioral coverage for `activateOutdoorPanorama(): boolean` and `restoreOutdoorPanorama(): boolean`.

- [ ] **Step 1: Write the failing activation test**

Append a test that creates a real `THREE.Scene` with a literal ordinary background and rotation, calls the wished-for activation method, and expects the owned panorama plus a `-Math.PI / 2` X rotation:

```js
test('camera preset activation installs a Z-up outdoor panorama', () => {
    const manager = Object.create(SceneManager.prototype);
    const ordinary = new THREE.Color(0x123456);
    const outdoor = new THREE.Texture();
    manager.scene = new THREE.Scene();
    manager.scene.background = ordinary;
    manager.scene.backgroundRotation.set(0.1, 0.2, 0.3);
    manager.outdoorPanoramaTexture = outdoor;
    manager.outdoorPanoramaState = null;

    assert.equal(manager.activateOutdoorPanorama(), true);
    assert.equal(manager.scene.background, outdoor);
    assert.ok(Math.abs(manager.scene.backgroundRotation.x + Math.PI / 2) < 1e-12);
    assert.equal(manager.scene.backgroundRotation.y, 0);
    assert.equal(manager.scene.backgroundRotation.z, 0);
});
```

- [ ] **Step 2: Write the failing restoration test**

Append a second test that activates and restores, then asserts the original object identity and exact Euler values:

```js
test('camera preset exit restores the exact ordinary background state', () => {
    const manager = Object.create(SceneManager.prototype);
    const ordinary = new THREE.Color(0x123456);
    manager.scene = new THREE.Scene();
    manager.scene.background = ordinary;
    manager.scene.backgroundRotation.set(0.1, 0.2, 0.3);
    manager.outdoorPanoramaTexture = new THREE.Texture();
    manager.outdoorPanoramaState = null;

    manager.activateOutdoorPanorama();
    assert.equal(manager.restoreOutdoorPanorama(), true);
    assert.equal(manager.scene.background, ordinary);
    assert.deepEqual(manager.scene.backgroundRotation.toArray(), [0.1, 0.2, 0.3, 'XYZ']);
    assert.equal(manager.outdoorPanoramaState, null);
});
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```powershell
node --test tests/outdoor-panorama.test.js tests/camera-preset-view.test.js
```

Expected: the new tests FAIL because `activateOutdoorPanorama` and `restoreOutdoorPanorama` do not exist; prior tests remain passing.

---

### Task 2: Make the panorama preset-only and Z-up

**Files:**
- Modify: `src/core/SceneManager.js:30-47`
- Modify: `src/core/SceneManager.js:125-165`
- Modify: `src/core/SceneManager.js:563-675`
- Modify: `src/core/SceneManager.js:950-956`

**Interfaces:**
- Consumes: `outdoorPanoramaTexture: THREE.Texture | null`.
- Produces: `outdoorPanoramaState: { background: THREE.Texture | THREE.Color | null, backgroundRotation: THREE.Euler } | null`, `activateOutdoorPanorama(): boolean`, and `restoreOutdoorPanorama(): boolean`.

- [ ] **Step 1: Keep the neutral background active during initialization**

Initialize `this.outdoorPanoramaState = null`. In `setupEnvironment()`, retain the texture returned by `createOutdoorPanoramaTexture()` in `this.outdoorPanoramaTexture`, but remove the early return and never assign that texture to `scene.background`. Always create the existing neutral gradient background and fog.

- [ ] **Step 2: Implement minimal activation and restoration**

Add:

```js
activateOutdoorPanorama() {
    if (!this.scene || !this.outdoorPanoramaTexture) return false;
    if (!this.outdoorPanoramaState) {
        this.outdoorPanoramaState = {
            background: this.scene.background,
            backgroundRotation: this.scene.backgroundRotation.clone(),
        };
    }
    this.scene.background = this.outdoorPanoramaTexture;
    this.scene.backgroundRotation.set(-Math.PI / 2, 0, 0);
    return true;
}

restoreOutdoorPanorama() {
    const state = this.outdoorPanoramaState;
    if (!state || !this.scene) return false;
    this.scene.background = state.background;
    this.scene.backgroundRotation.copy(state.backgroundRotation);
    this.outdoorPanoramaState = null;
    return true;
}
```

- [ ] **Step 3: Bind the lifecycle to camera-preset entry and exit**

Call `activateOutdoorPanorama()` after `setCameraPreset()` accepts a preset. Call `restoreOutdoorPanorama()` inside `exitCameraPreset()` before restoring orbit state. Switching directly between preset points must not overwrite the first saved ordinary state.

Update `disposeOutdoorPanorama()` to call `restoreOutdoorPanorama()` before disposing the owned texture, so destroying the scene cannot leave a disposed texture installed as the background.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```powershell
node --test tests/outdoor-panorama.test.js tests/camera-preset-view.test.js
```

Expected: every focused test PASS.

---

### Task 3: Regression and visual verification

**Files:**
- Verify: `src/core/SceneManager.js`
- Verify: `tests/outdoor-panorama.test.js`
- Verify: `tests/camera-preset-view.test.js`

**Interfaces:**
- Consumes: the completed background lifecycle.
- Produces: an uncommitted browser checkpoint for user validation.

- [ ] **Step 1: Run complete automated verification**

Run:

```powershell
npm.cmd test
npm.cmd run build:3d
git diff --check
```

Expected: zero test failures, Vite exits `0`, and no whitespace errors.

- [ ] **Step 2: Validate the real UI states**

Navigate to `index-3d.html?fixture=cameras&codex=outdoor-preset-only-20260811#debug` and verify in order:

1. Before selecting a point, no city buildings or tree line appear around the dwelling.
2. Enter point 2 and rotate toward its curved exterior window.
3. Buildings and trees are vertical in world Z rather than horizontal bars.
4. Exit preview and confirm the panorama disappears again.
5. Confirm browser warning/error logs remain empty.

- [ ] **Step 3: Preserve the visual checkpoint**

Run `git status --short`. Do not stage or commit the correction. Keep the verified browser page available for the user.
