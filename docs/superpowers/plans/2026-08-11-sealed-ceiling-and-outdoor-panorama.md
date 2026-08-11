# Sealed Ceiling and Outdoor Panorama Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seal indoor camera-preset previews with one outline-based ceiling slab and show a fully local procedural outdoor panorama through transparent windows.

**Architecture:** `RoomRenderer` will derive a primary ceiling mesh from the authoritative dwelling outline and retain room-floor clones only as a data fallback. A new focused `OutdoorPanorama` module will generate one deterministic equirectangular `CanvasTexture`; `SceneManager` will own that background separately from the existing PMREM lighting environment.

**Tech Stack:** Three.js 0.178, HTML Canvas 2D, Node.js built-in test runner, Vite 6, in-app browser validation.

## Global Constraints

- Work only in `D:\occt_demo\.worktrees\cad-renderer-parametric-bridge`.
- Do not modify, deploy, stage, or commit `C:\Users\User\Desktop\cad_plugin`.
- Do not request outdoor assets or material data from a server.
- Generate exactly one 2048 x 1024 outdoor panorama texture during scene initialization.
- Keep the existing PMREM `scene.environment` and material lighting behavior unchanged.
- Keep all ceilings hidden outside camera-preset preview.
- The primary ceiling elevation remains exactly `2800` mm.
- Do not cast shadows from the ceiling.
- Preserve the existing room-floor ceiling behavior only as a fallback for invalid or missing outline rings.
- Do not stage or commit overlapping production files while they contain pre-existing uncommitted work; leave implementation changes for the user's visual checkpoint.

---

### Task 1: Outline-based sealed ceiling

**Files:**
- Create: `tests/ceiling-geometry.test.js`
- Modify: `src/components/RoomRenderer.js:413-528`
- Verify: `tests/camera-preset-view.test.js`

**Interfaces:**
- Consumes: `data.outline.outlineRings` shaped as `{ outer: Point[], holes: Point[][] }`, the existing `RoomRenderer.buildContour(points, Ctor)`, and existing floor meshes.
- Produces: `RoomRenderer.createCeilingMeshes(outlineRings, floorMeshes, height = 2800): THREE.Mesh[]` and `this.ceilingMeshes` containing either one `ceilingSource: "outline"` mesh or room fallback meshes with `ceilingSource: "room-fallback"`.

- [ ] **Step 1: Write the failing primary-ceiling test**

Create `tests/ceiling-geometry.test.js` with this test setup and assertion logic:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RoomRenderer } from '../src/components/RoomRenderer.js';

function createRenderer() {
    return new RoomRenderer({
        getScene: () => new THREE.Scene(),
        invalidateShadow() {},
    });
}

function triangleCentroids(geometry) {
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex();
    const triangles = index ? index.count / 3 : position.count / 3;
    const point = i => new THREE.Vector2(position.getX(i), position.getY(i));
    const centroids = [];
    for (let triangle = 0; triangle < triangles; triangle += 1) {
        const offset = triangle * 3;
        const ia = index ? index.getX(offset) : offset;
        const ib = index ? index.getX(offset + 1) : offset + 1;
        const ic = index ? index.getX(offset + 2) : offset + 2;
        centroids.push(point(ia).add(point(ib)).add(point(ic)).multiplyScalar(1 / 3));
    }
    return centroids;
}

test('valid outline rings create one sealed ceiling and preserve real holes', () => {
    const renderer = createRenderer();
    const outlineRings = {
        outer: [[0, 0], [1000, 0], [1000, 800], [0, 800]],
        holes: [[[400, 300], [600, 300], [600, 500], [400, 500]]],
    };
    const floorA = new THREE.Mesh(new THREE.PlaneGeometry(380, 800));
    const floorB = new THREE.Mesh(new THREE.PlaneGeometry(380, 800));

    const ceilings = renderer.createCeilingMeshes(outlineRings, [floorA, floorB]);

    assert.equal(ceilings.length, 1);
    assert.equal(ceilings[0].userData.ceilingSource, 'outline');
    assert.equal(ceilings[0].position.z, 2800);
    assert.equal(ceilings[0].visible, false);
    assert.equal(ceilings[0].castShadow, false);
    assert.equal(ceilings[0].receiveShadow, true);

    const box = new THREE.Box3().setFromObject(ceilings[0]);
    assert.deepEqual(box.min.toArray(), [0, 0, 2800]);
    assert.deepEqual(box.max.toArray(), [1000, 800, 2800]);
    assert.equal(
        triangleCentroids(ceilings[0].geometry)
            .some(point => point.x > 400 && point.x < 600 && point.y > 300 && point.y < 500),
        false,
    );
});

test('missing outline keeps one room-based ceiling per floor as a fallback', () => {
    const renderer = createRenderer();
    const floorA = new THREE.Mesh(new THREE.PlaneGeometry(300, 200));
    const floorB = new THREE.Mesh(new THREE.PlaneGeometry(500, 400));
    floorA.userData.roomIndex = 3;
    floorB.userData.roomIndex = 7;

    const ceilings = renderer.createCeilingMeshes(null, [floorA, floorB]);

    assert.equal(ceilings.length, 2);
    assert.deepEqual(ceilings.map(mesh => mesh.userData.ceilingSource), [
        'room-fallback',
        'room-fallback',
    ]);
    assert.deepEqual(ceilings.map(mesh => mesh.userData.roomIndex), [3, 7]);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --test tests/ceiling-geometry.test.js
```

Expected: both tests FAIL with `renderer.createCeilingMeshes is not a function`.

- [ ] **Step 3: Implement the minimal outline-ceiling factory**

In `RoomRenderer`, add a method with this structure:

```js
createCeilingMeshes(outlineRings, floorMeshes, height = 2800) {
    const material = new THREE.MeshStandardMaterial({
        color: 0xF0ECE4,
        roughness: 0.95,
        metalness: 0,
        side: THREE.DoubleSide,
    });
    const outer = this.buildContour(outlineRings?.outer, THREE.Shape);
    if (outer) {
        for (const ring of outlineRings?.holes || []) {
            const hole = this.buildContour(ring, THREE.Path);
            if (hole) outer.holes.push(hole);
        }
        const ceiling = new THREE.Mesh(new THREE.ShapeGeometry(outer), material);
        ceiling.position.z = height;
        ceiling.visible = false;
        ceiling.castShadow = false;
        ceiling.receiveShadow = true;
        ceiling.userData.type = 'ceiling';
        ceiling.userData.ceilingSource = 'outline';
        return [ceiling];
    }

    return (floorMeshes || []).map((floor, index) => {
        const ceiling = new THREE.Mesh(floor.geometry.clone(), material);
        ceiling.position.copy(floor.position);
        ceiling.position.z = height;
        ceiling.visible = false;
        ceiling.castShadow = false;
        ceiling.receiveShadow = true;
        ceiling.userData.type = 'ceiling';
        ceiling.userData.ceilingSource = 'room-fallback';
        ceiling.userData.roomIndex = floor.userData.roomIndex ?? index;
        return ceiling;
    });
}
```

Make `buildContour` return `null` before calling `convertPointFormat` when `points` is not an array. Replace the current inline room-floor ceiling creation in `render()` with:

```js
this.ceilingMeshes = this.createCeilingMeshes(
    data.outline?.outlineRings,
    floorMeshes,
);
this.ceilingMeshes.forEach(ceiling => this.sceneGroup.add(ceiling));
result.ceilingMeshes = this.ceilingMeshes;
```

- [ ] **Step 4: Run both focused geometry tests and verify GREEN**

Run:

```powershell
node --test tests/ceiling-geometry.test.js
```

Expected: both tests PASS.

- [ ] **Step 5: Verify all ceiling behavior**

Run:

```powershell
node --test tests/ceiling-geometry.test.js tests/camera-preset-view.test.js
```

Expected: all ceiling geometry and visibility tests PASS.

- [ ] **Step 6: Record the task checkpoint without staging dirty production files**

Run:

```powershell
git diff --check -- src/components/RoomRenderer.js tests/ceiling-geometry.test.js tests/camera-preset-view.test.js
git status --short
```

Expected: no whitespace errors; production and test files remain unstaged for the user's visual checkpoint.

---

### Task 2: Deterministic local outdoor panorama

**Files:**
- Create: `src/components/OutdoorPanorama.js`
- Create: `tests/outdoor-panorama.test.js`

**Interfaces:**
- Produces: `drawOutdoorPanorama(context, width, height): void` and `createOutdoorPanoramaTexture({ canvasFactory } = {}): THREE.CanvasTexture | null`.
- Consumed by Task 3: `SceneManager.setupEnvironment()` calls `createOutdoorPanoramaTexture()` once and owns the returned texture.

- [ ] **Step 1: Write the failing texture-contract test**

Create `tests/outdoor-panorama.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createOutdoorPanoramaTexture } from '../src/components/OutdoorPanorama.js';

function recordingCanvas() {
    const calls = [];
    const gradient = () => ({
        addColorStop(offset, color) { calls.push(['colorStop', offset, color]); },
    });
    const context = {
        createLinearGradient(...args) { calls.push(['linearGradient', ...args]); return gradient(); },
        createRadialGradient(...args) { calls.push(['radialGradient', ...args]); return gradient(); },
        fillRect(...args) { calls.push(['fillRect', ...args]); },
        beginPath() { calls.push(['beginPath']); },
        moveTo(...args) { calls.push(['moveTo', ...args]); },
        lineTo(...args) { calls.push(['lineTo', ...args]); },
        closePath() { calls.push(['closePath']); },
        arc(...args) { calls.push(['arc', ...args]); },
        fill() { calls.push(['fill']); },
        set fillStyle(value) { calls.push(['fillStyle', value]); },
    };
    return {
        calls,
        canvas: { width: 0, height: 0, getContext: () => context },
    };
}

test('outdoor panorama is a local deterministic equirectangular sRGB texture', () => {
    const recording = recordingCanvas();
    const previousFetch = globalThis.fetch;
    globalThis.fetch = () => { throw new Error('network access is forbidden'); };
    try {
        const texture = createOutdoorPanoramaTexture({
            canvasFactory: () => recording.canvas,
        });

        assert.ok(texture?.isCanvasTexture);
        assert.equal(texture.image, recording.canvas);
        assert.equal(recording.canvas.width, 2048);
        assert.equal(recording.canvas.height, 1024);
        assert.equal(texture.mapping, THREE.EquirectangularReflectionMapping);
        assert.equal(texture.colorSpace, THREE.SRGBColorSpace);
        assert.ok(recording.calls.filter(call => call[0] === 'fillRect').length >= 50);
        assert.ok(recording.calls.some(call => call[0] === 'arc'));
    } finally {
        globalThis.fetch = previousFetch;
    }
});

test('outdoor panorama returns null when Canvas 2D is unavailable', () => {
    const texture = createOutdoorPanoramaTexture({
        canvasFactory: () => ({ getContext: () => null }),
    });
    assert.equal(texture, null);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --test tests/outdoor-panorama.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `OutdoorPanorama.js`.

- [ ] **Step 3: Implement deterministic canvas drawing**

Create `src/components/OutdoorPanorama.js` with these exports and drawing rules:

```js
import * as THREE from 'three';

export const OUTDOOR_PANORAMA_WIDTH = 2048;
export const OUTDOOR_PANORAMA_HEIGHT = 1024;

export function drawOutdoorPanorama(context, width, height) {
    const horizon = Math.round(height * 0.58);
    const sky = context.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#7eb6e8');
    sky.addColorStop(0.62, '#c9dff1');
    sky.addColorStop(1, '#edf0ec');
    context.fillStyle = sky;
    context.fillRect(0, 0, width, horizon);

    const sun = context.createRadialGradient(width * 0.72, height * 0.2, 0,
        width * 0.72, height * 0.2, height * 0.12);
    sun.addColorStop(0, 'rgba(255,248,220,0.72)');
    sun.addColorStop(1, 'rgba(255,248,220,0)');
    context.fillStyle = sun;
    context.fillRect(0, 0, width, horizon);

    context.fillStyle = '#a9b4b3';
    for (let index = 0; index < 48; index += 1) {
        const segment = width / 48;
        const buildingWidth = segment * (0.62 + (index % 4) * 0.08);
        const buildingHeight = height * (0.055 + ((index * 7) % 11) * 0.006);
        context.fillRect(index * segment, horizon - buildingHeight,
            buildingWidth, buildingHeight);
    }

    const ground = context.createLinearGradient(0, horizon, 0, height);
    ground.addColorStop(0, '#a9b39d');
    ground.addColorStop(0.45, '#8f9b84');
    ground.addColorStop(1, '#727b69');
    context.fillStyle = ground;
    context.fillRect(0, horizon, width, height - horizon);

    context.fillStyle = '#6f8971';
    for (let index = 0; index < 64; index += 1) {
        const x = (index + 0.35) * width / 64;
        const radius = height * (0.018 + (index % 5) * 0.0025);
        context.beginPath();
        context.arc(x, horizon + height * 0.015, radius, 0, Math.PI * 2);
        context.fill();
    }

    const haze = context.createLinearGradient(0, horizon - height * 0.08, 0,
        horizon + height * 0.09);
    haze.addColorStop(0, 'rgba(238,241,237,0)');
    haze.addColorStop(0.5, 'rgba(238,241,237,0.48)');
    haze.addColorStop(1, 'rgba(238,241,237,0)');
    context.fillStyle = haze;
    context.fillRect(0, horizon - height * 0.08, width, height * 0.17);
}

export function createOutdoorPanoramaTexture({
    canvasFactory = () => (typeof document === 'undefined'
        ? null : document.createElement('canvas')),
} = {}) {
    const canvas = canvasFactory?.();
    const context = canvas?.getContext?.('2d');
    if (!canvas || !context) return null;
    canvas.width = OUTDOOR_PANORAMA_WIDTH;
    canvas.height = OUTDOOR_PANORAMA_HEIGHT;
    drawOutdoorPanorama(context, canvas.width, canvas.height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.name = 'ProceduralOutdoorPanorama';
    texture.needsUpdate = true;
    return texture;
}
```

Preserve all listed colors, dimensions, loop counts, and deterministic formulas; do not use `Math.random()`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
node --test tests/outdoor-panorama.test.js
```

Expected: both tests PASS without any network access.

- [ ] **Step 5: Add and verify disposal behavior**

Append:

```js
test('outdoor panorama texture emits disposal and can release its canvas', () => {
    const recording = recordingCanvas();
    const texture = createOutdoorPanoramaTexture({ canvasFactory: () => recording.canvas });
    let disposed = false;
    texture.addEventListener('dispose', () => { disposed = true; });
    texture.dispose();
    assert.equal(disposed, true);
});
```

Run:

```powershell
node --test tests/outdoor-panorama.test.js
```

Expected: all three tests PASS; Three.js native `Texture.dispose()` supplies the required behavior without extra production code.

- [ ] **Step 6: Record the task checkpoint without staging dirty production files**

Run:

```powershell
git diff --check -- src/components/OutdoorPanorama.js tests/outdoor-panorama.test.js
git status --short
```

Expected: no whitespace errors; both files remain unstaged for the user checkpoint.

---

### Task 3: Scene ownership, fallback, and end-to-end verification

**Files:**
- Modify: `src/core/SceneManager.js:1-166`
- Modify: `src/core/SceneManager.js:973-1005`
- Modify: `tests/outdoor-panorama.test.js`
- Verify: `src/components/WindowGlassMaterial.js`

**Interfaces:**
- Consumes: `createOutdoorPanoramaTexture(): THREE.CanvasTexture | null` from Task 2.
- Produces: `SceneManager.outdoorPanoramaTexture: THREE.CanvasTexture | null`; `scene.background` uses that texture when available and retains the existing gradient fallback otherwise.

- [ ] **Step 1: Write the failing SceneManager ownership test**

Append to `tests/outdoor-panorama.test.js`:

```js
import { SceneManager } from '../src/core/SceneManager.js';

test('SceneManager releases the owned outdoor panorama during destruction', () => {
    const manager = Object.create(SceneManager.prototype);
    let disposed = false;
    manager.scene = { background: { id: 'outdoor' } };
    manager.outdoorPanoramaTexture = manager.scene.background;
    manager.outdoorPanoramaTexture.dispose = () => { disposed = true; };

    manager.disposeOutdoorPanorama();

    assert.equal(disposed, true);
    assert.equal(manager.scene.background, null);
    assert.equal(manager.outdoorPanoramaTexture, null);
});
```

- [ ] **Step 2: Run the focused ownership test and verify RED**

Run:

```powershell
node --test tests/outdoor-panorama.test.js
```

Expected: FAIL with `manager.disposeOutdoorPanorama is not a function`.

- [ ] **Step 3: Install and own the panorama in SceneManager**

At the top of `SceneManager.js`, import:

```js
import { createOutdoorPanoramaTexture } from '../components/OutdoorPanorama.js';
```

Initialize `this.outdoorPanoramaTexture = null` in the constructor. At the beginning of `setupEnvironment()` use:

```js
const outdoorPanorama = createOutdoorPanoramaTexture();
if (outdoorPanorama) {
    this.outdoorPanoramaTexture = outdoorPanorama;
    this.scene.background = outdoorPanorama;
} else {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#7BA7D9');
    gradient.addColorStop(0.4, '#C8D6E5');
    gradient.addColorStop(0.7, '#E8E8E8');
    gradient.addColorStop(1, '#CCCCCC');
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    this.scene.background = new THREE.CanvasTexture(canvas);
}
```

Move the existing gradient code into the `else` branch, and keep existing fog creation after the branch so both backgrounds use the same fog settings.

Add:

```js
disposeOutdoorPanorama() {
    const texture = this.outdoorPanoramaTexture;
    if (!texture) return;
    if (this.scene?.background === texture) this.scene.background = null;
    texture.dispose();
    this.outdoorPanoramaTexture = null;
}
```

Call `this.disposeOutdoorPanorama()` in `destroy()` after `restoreWhiteModelLighting()` and before composer disposal.

- [ ] **Step 4: Run the focused ownership tests and verify GREEN**

Run:

```powershell
node --test tests/outdoor-panorama.test.js
```

Expected: all outdoor panorama tests PASS.

- [ ] **Step 5: Run the full automated verification**

Run:

```powershell
npm.cmd test
npm.cmd run build:3d
git diff --check
```

Expected: all non-CAD tests pass, CAD-path tests remain explicitly skipped without their environment variables, Vite exits `0`, and `git diff --check` reports no whitespace errors.

- [ ] **Step 6: Validate the real browser behavior**

Use the existing local server and navigate the retained in-app browser tab to:

```text
http://127.0.0.1:4179/index-3d.html?fixture=cameras&codex=sealed-ceiling-outdoor-20260811#debug
```

Perform these checks in order:

1. In bird's-eye view, confirm room interiors remain visible from above.
2. Click `进入点位 1` and rotate in place toward at least one exterior window.
3. Confirm the ceiling has no visible wall-band or room-boundary gaps.
4. Confirm sky, distant buildings, and trees are visible behind transparent glass.
5. Click `退出全景图预览` and confirm the previous bird's-eye camera and open-top view return.
6. Read browser console error logs and confirm the list is empty.

- [ ] **Step 7: Stop at the user visual checkpoint**

Run:

```powershell
git status --short
```

Expected: implementation remains uncommitted. Keep the verified browser tab open and ask the user to validate the ceiling seal and outdoor appearance before any production commit or CAD migration.
