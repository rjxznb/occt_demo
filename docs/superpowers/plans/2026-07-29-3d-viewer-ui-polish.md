# 3D Viewer UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make window glass transparent while keeping frames opaque, repair resource-sidebar closing, remove development-only UI, soften camera movement, and compact the 3D viewer's right-side controls.

**Architecture:** Introduce three small, independently testable policies: window-material normalization, sidebar presentation state, and OrbitControls configuration. Wire them into the existing placement, sidebar, and scene-manager paths, then simplify the existing HTML without changing application-facing element IDs.

**Tech Stack:** JavaScript ES modules, Three.js 0.178, Node.js built-in test runner, Vite 6, browser verification in the local OCCT preview.

## Global Constraints

- Modify only `D:\occt_demo\.worktrees\cad-renderer-parametric-bridge` on branch `codex/ue-typeid-rendering`.
- Do not modify, deploy, stage, or commit `C:\Users\User\Desktop\cad_plugin`.
- Preserve the draggable cube and other basic models inside the resource library; remove only the floating debug cube control.
- Preserve window frames and hardware as opaque.
- Do not change TypeId routing, model placement, parameter resolution, resource loading, or bridge contracts.
- Add no runtime dependency.
- Write each behavior test first and observe its expected failure before modifying production code.

---

## File Map

- Create `src/components/WindowGlassMaterial.js`: identify named glass meshes/materials and clone/normalize only their materials.
- Create `tests/window-glass-material.test.js`: unit coverage for window-only, name-based, non-mutating material normalization.
- Modify `src/components/ContentModelPlacement.js`: apply glass normalization to the cloned prototype of `window_list` instances.
- Modify `tests/content-model-placement.test.js`: integration coverage proving placement invokes the normalization boundary.
- Create `src/components/SidebarPresentation.js`: make visible/hidden sidebar presentation deterministic.
- Create `tests/sidebar-presentation.test.js`: unit coverage for class, inline style, and resize state transitions.
- Modify `src/components/MaterialSidebar.js`: delegate show/hide and resize presentation to the policy.
- Create `src/core/OrbitControlPolicy.js`: apply the agreed camera tuning to a controls object.
- Create `tests/orbit-control-policy.test.js`: unit coverage for tuned controls while preserving zoom speed.
- Modify `src/core/SceneManager.js`: use the controls policy at construction.
- Modify `src/components/DragDropManager.js`: remove the floating `#debug` cube button only.
- Modify `index-3d.html`: compact status and controls, remove shortcut help, and preserve required IDs.

---

### Task 1: Normalize Named Window Glass Materials

**Files:**
- Create: `src/components/WindowGlassMaterial.js`
- Create: `tests/window-glass-material.test.js`
- Modify: `src/components/ContentModelPlacement.js`
- Modify: `tests/content-model-placement.test.js`

**Interfaces:**
- Produces: `applyWindowGlassMaterials(root: THREE.Object3D, instance: object): THREE.Object3D`
- Consumes: `instance.sourceList`, mesh names, material names, and Three.js material cloning.

- [ ] **Step 1: Write failing unit tests for selective, non-mutating normalization**

Create `tests/window-glass-material.test.js` with literal expectations:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applyWindowGlassMaterials } from '../src/components/WindowGlassMaterial.js';

function mesh(name, materialName, opacity = 1) {
    const material = new THREE.MeshStandardMaterial({ opacity });
    material.name = materialName;
    const result = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    result.name = name;
    return result;
}

test('window glass is cloned and transparent while its frame remains opaque', () => {
    const root = new THREE.Group();
    const glass = mesh('WindowGlass', '玻璃');
    const frame = mesh('AluminiumFrame', 'frame');
    const originalGlass = glass.material;
    root.add(glass, frame);

    applyWindowGlassMaterials(root, { sourceList: 'window_list' });

    assert.notEqual(glass.material, originalGlass);
    assert.equal(glass.material.transparent, true);
    assert.equal(glass.material.opacity, 0.32);
    assert.equal(glass.material.depthWrite, false);
    assert.equal(glass.material.side, THREE.DoubleSide);
    assert.equal(frame.material.transparent, false);
    assert.equal(originalGlass.transparent, false);
});
```

Add two more tests:

```js
test('non-window models are not changed even when a material is named glass', () => {
    const root = mesh('glass', 'glass');
    const original = root.material;
    applyWindowGlassMaterials(root, { sourceList: 'soft_list' });
    assert.equal(root.material, original);
    assert.equal(root.material.transparent, false);
});

test('material arrays normalize only the named glass entry and retain lower source opacity', () => {
    const root = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [
        Object.assign(new THREE.MeshStandardMaterial({ opacity: 0.2 }), { name: 'Glass_Clear' }),
        Object.assign(new THREE.MeshStandardMaterial(), { name: 'handle' }),
    ]);
    const originals = root.material.slice();
    applyWindowGlassMaterials(root, { sourceList: 'window_list' });
    assert.notEqual(root.material[0], originals[0]);
    assert.equal(root.material[0].opacity, 0.2);
    assert.equal(root.material[0].transparent, true);
    assert.equal(root.material[1], originals[1]);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --test tests/window-glass-material.test.js
```

Expected: FAIL because `WindowGlassMaterial.js` or `applyWindowGlassMaterials` does not exist. This proves the test depends on the new policy.

- [ ] **Step 3: Implement the smallest material normalizer**

Create `src/components/WindowGlassMaterial.js`:

```js
import * as THREE from 'three';

const GLASS_MARKERS = ['glass', '玻璃', '窗玻璃'];

function isNamedGlass(mesh, material) {
    const label = `${mesh?.name ?? ''} ${material?.name ?? ''}`.toLowerCase();
    return GLASS_MARKERS.some(marker => label.includes(marker));
}

function normalizeMaterial(mesh, material) {
    if (!material?.isMaterial || !isNamedGlass(mesh, material)) return material;
    const clone = material.clone();
    clone.transparent = true;
    clone.opacity = Math.min(Number.isFinite(material.opacity) ? material.opacity : 1, 0.32);
    clone.depthWrite = false;
    clone.side = THREE.DoubleSide;
    clone.needsUpdate = true;
    return clone;
}

export function applyWindowGlassMaterials(root, instance) {
    if (!root?.isObject3D || instance?.sourceList !== 'window_list') return root;
    root.traverse(child => {
        if (!child.isMesh || !child.material) return;
        child.material = Array.isArray(child.material)
            ? child.material.map(material => normalizeMaterial(child, material))
            : normalizeMaterial(child, child.material);
    });
    return root;
}
```

- [ ] **Step 4: Run unit tests and verify GREEN**

Run:

```powershell
node --test tests/window-glass-material.test.js
```

Expected: 3 tests pass, 0 fail.

- [ ] **Step 5: Write a failing placement integration test**

In `tests/content-model-placement.test.js`, add a test that creates a prototype with one material named `glass`, calls `placeContentModel` using a `window_list` instance, finds the placed mesh, and asserts its material is transparent while the prototype's material remains opaque. Run only this test with:

```powershell
node --test --test-name-pattern="placed window glass" tests/content-model-placement.test.js
```

Expected: FAIL because placement does not yet invoke the normalizer.

- [ ] **Step 6: Wire the normalizer into placement and verify GREEN**

Import `applyWindowGlassMaterials` in `ContentModelPlacement.js`. Immediately after `clonePrototype(prototype)`, call:

```js
applyWindowGlassMaterials(clonedPrototype, instance);
```

Run:

```powershell
node --test tests/window-glass-material.test.js tests/content-model-placement.test.js
```

Expected: all focused tests pass.

- [ ] **Step 7: Commit the glass-material change**

```powershell
git add src/components/WindowGlassMaterial.js src/components/ContentModelPlacement.js tests/window-glass-material.test.js tests/content-model-placement.test.js
git commit -m "fix: render named window glass transparently"
```

---

### Task 2: Make Resource Sidebar Visibility Deterministic

**Files:**
- Create: `src/components/SidebarPresentation.js`
- Create: `tests/sidebar-presentation.test.js`
- Modify: `src/components/MaterialSidebar.js`

**Interfaces:**
- Produces: `showSidebar(sidebar)`, `hideSidebar(sidebar)`, and `resizeSidebar(sidebar, width)`.
- Consumes: an element-like object with `classList` and `style`, so the behavior is testable without a browser DOM dependency.

- [ ] **Step 1: Write failing state-policy tests**

Create `tests/sidebar-presentation.test.js` using a small element-like fixture whose `classList` is backed by a real `Set` and whose `style.removeProperty()` deletes the requested property. Assert these literal outcomes:

```js
test('hide removes visibility and stale horizontal positioning', () => {
    const sidebar = fakeSidebar(['visible'], { right: '0px', width: '360px' });
    hideSidebar(sidebar);
    assert.equal(sidebar.classList.contains('visible'), false);
    assert.equal(sidebar.style.right, undefined);
    assert.equal(sidebar.style.width, '360px');
});

test('show clears stale positioning and makes the sidebar visible', () => {
    const sidebar = fakeSidebar([], { right: '-360px' });
    showSidebar(sidebar);
    assert.equal(sidebar.classList.contains('visible'), true);
    assert.equal(sidebar.style.right, undefined);
});

test('resize changes width without writing right', () => {
    const sidebar = fakeSidebar(['visible'], {});
    resizeSidebar(sidebar, 420);
    assert.equal(sidebar.style.width, '420px');
    assert.equal(sidebar.style.right, undefined);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

```powershell
node --test tests/sidebar-presentation.test.js
```

Expected: FAIL because `SidebarPresentation.js` does not exist.

- [ ] **Step 3: Implement the presentation policy**

Create `src/components/SidebarPresentation.js`:

```js
function clearRight(sidebar) {
    sidebar?.style?.removeProperty?.('right');
}

export function showSidebar(sidebar) {
    clearRight(sidebar);
    sidebar?.classList?.add('visible');
}

export function hideSidebar(sidebar) {
    sidebar?.classList?.remove('visible');
    clearRight(sidebar);
}

export function resizeSidebar(sidebar, width) {
    if (!sidebar?.style || !Number.isFinite(width)) return;
    sidebar.style.width = `${width}px`;
}
```

- [ ] **Step 4: Integrate with `MaterialSidebar`**

Import the three functions. In the resize handler, replace direct width/right writes with `resizeSidebar(this.sidebar, newWidth)`. In `show()`, call `expand()`, set `isVisible = true`, then call `showSidebar(this.sidebar)`. In `hide()`, set `isVisible = false`, reset `isResizing = false`, and call `hideSidebar(this.sidebar)`.

- [ ] **Step 5: Run focused tests and verify GREEN**

```powershell
node --test tests/sidebar-presentation.test.js
```

Expected: 3 tests pass, 0 fail.

- [ ] **Step 6: Commit the sidebar repair**

```powershell
git add src/components/SidebarPresentation.js src/components/MaterialSidebar.js tests/sidebar-presentation.test.js
git commit -m "fix: make resource sidebar close reliably"
```

---

### Task 3: Tune Camera Controls and Remove the Floating Debug Cube

**Files:**
- Create: `src/core/OrbitControlPolicy.js`
- Create: `tests/orbit-control-policy.test.js`
- Modify: `src/core/SceneManager.js`
- Modify: `src/components/DragDropManager.js`

**Interfaces:**
- Produces: `configureOrbitControls(controls): controls`.
- Preserves: existing OrbitControls target, distance limits, polar limit, and zoom speed.

- [ ] **Step 1: Write a failing controls-policy test**

Create `tests/orbit-control-policy.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { configureOrbitControls } from '../src/core/OrbitControlPolicy.js';

test('camera controls rotate and pan more gently without changing zoom speed', () => {
    const controls = { zoomSpeed: 1 };
    assert.equal(configureOrbitControls(controls), controls);
    assert.equal(controls.enableDamping, true);
    assert.equal(controls.dampingFactor, 0.1);
    assert.equal(controls.rotateSpeed, 0.6);
    assert.equal(controls.panSpeed, 0.6);
    assert.equal(controls.zoomSpeed, 1);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

```powershell
node --test tests/orbit-control-policy.test.js
```

Expected: FAIL because `OrbitControlPolicy.js` does not exist.

- [ ] **Step 3: Implement and wire the controls policy**

Create `src/core/OrbitControlPolicy.js`:

```js
export function configureOrbitControls(controls) {
    if (!controls) return controls;
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.rotateSpeed = 0.6;
    controls.panSpeed = 0.6;
    return controls;
}
```

Import and call it immediately after constructing OrbitControls in `SceneManager.js`, then retain the existing target, polar-angle, and distance assignments.

- [ ] **Step 4: Remove only the floating debug control**

In `DragDropManager.js`, remove the `window.location.hash === '#debug'` branch from `init()` and delete `addDebugControls()`. Do not remove the `box` case from `createModel()` and do not remove the cube entry from `MaterialSidebar.loadModels()`.

- [ ] **Step 5: Verify controls tests and the browser-observable debug behavior**

Run:

```powershell
node --test tests/orbit-control-policy.test.js
```

Expected: 1 test passes.

In the local preview with `#debug`, verify that no fixed `测试创建立方体` button is created while the resource library still contains `立方体` in its Models tab.

- [ ] **Step 6: Commit controls and debug cleanup**

```powershell
git add src/core/OrbitControlPolicy.js src/core/SceneManager.js src/components/DragDropManager.js tests/orbit-control-policy.test.js
git commit -m "refactor: simplify 3d viewer controls"
```

---

### Task 4: Compact the Right-Side UI

**Files:**
- Modify: `index-3d.html`

**Interfaces:**
- Preserves DOM IDs: `fps-counter`, `auto-rotation-status`, `rotation-indicator`, `rotation-status-text`, `controls`, `mode-toggle`, `resource-toggle`, `template-toggle`, and `view-angle-group`.
- Preserves `.view-angle-btn[data-view]` buttons for `NW`, `NE`, `SW`, and `SE`.

- [ ] **Step 1: Record the browser RED state**

Open the combined fixture page and confirm the current observable failures: the shortcut-help block is visible, the status badges float separately from the controls card, and Resource Library / Apply Template are stacked. This is the RED observation for a presentation-only change; do not add a source-text change detector.

- [ ] **Step 2: Restructure the status and action markup**

Move the FPS and auto-rotation elements into a new `.viewer-status-row` immediately inside `#controls`. Keep their IDs and inner status nodes unchanged. Wrap `resource-toggle` and `template-toggle` in `.primary-action-grid`. Remove the entire Edit Shortcuts control group.

The resulting controls hierarchy should be:

```html
<div id="controls">
    <div class="viewer-status-row">
        <div id="fps-counter">...</div>
        <div id="auto-rotation-status">...</div>
    </div>
    <div class="control-group">...mode-toggle...</div>
    <div class="control-group">
        <div class="control-label">资源管理</div>
        <div class="primary-action-grid">...resource-toggle...template-toggle...</div>
    </div>
    <div class="control-group" id="view-angle-group">...four view buttons...</div>
</div>
```

- [ ] **Step 3: Replace obsolete styles with compact card styles**

Update the existing rules instead of appending conflicting overrides:

- `#controls`: width `208px`, padding `14px`, gap-driven vertical layout, `background: rgba(20, 24, 30, 0.88)`.
- `.viewer-status-row`: `display: grid; gap: 6px; margin-bottom: 12px`, with FPS in green and rotation status in neutral text.
- `#fps-counter` and `#auto-rotation-status`: reset fixed positioning, backgrounds, and standalone z-index values.
- `.control-group`: margin controlled by `gap`, not separate bottom margins.
- `.primary-action-grid`: `display: grid; grid-template-columns: 1fr 1fr; gap: 8px`.
- `.primary-action-grid button`: consistent height, padding, and wrapping.
- `.template-btn`: remove its old top margin.
- delete `.shortcuts-info` and `.shortcut-item` rules.

- [ ] **Step 4: Build and visually verify GREEN**

Run:

```powershell
npm run build:3d
```

Reload the combined fixture page and verify:

- status information is inside/aligned with the right controls card;
- the shortcut-help block is absent;
- Resource Library and Apply Template are aligned in one two-column row;
- all four quick-view buttons still work;
- the controls card does not block the resource-sidebar close button.

- [ ] **Step 5: Commit the UI layout**

```powershell
git add index-3d.html
git commit -m "style: compact the 3d viewer control panel"
```

---

### Task 5: Full Regression and Browser Verification

**Files:**
- Modify only if a verification failure identifies a defect in an earlier task.

**Interfaces:**
- Validates the complete OCCT 3D viewer and leaves CAD Plugin untouched.

- [ ] **Step 1: Run focused tests together**

```powershell
node --test tests/window-glass-material.test.js tests/content-model-placement.test.js tests/sidebar-presentation.test.js tests/orbit-control-policy.test.js
```

Expected: all focused tests pass, 0 fail.

- [ ] **Step 2: Run the full OCCT test suite**

```powershell
npm test
```

Expected: 0 failures. Existing CAD environment-dependent tests may remain skipped when their configured paths are unavailable.

- [ ] **Step 3: Build the 3D application and check the patch**

```powershell
npm run build:3d
git diff --check
git status --short
```

Expected: build succeeds, `git diff --check` reports no whitespace errors, and no uncommitted files remain after the task commits.

- [ ] **Step 4: Run real-browser acceptance checks**

Open:

```text
http://127.0.0.1:4179/index-3d.html?fixture=ue-specials&codex=viewer-ui-polish-20260729#debug
```

Verify in order:

1. Window glass is visibly transparent from both sides while frames remain opaque.
2. Open Resource Library, resize it once, and click the header ×; it fully leaves the viewport. Reopen it and confirm full-width content is shown.
3. The floating debug cube button is absent; Models → Cube remains available.
4. Drag rotation and panning are noticeably steadier; wheel zoom remains usable.
5. The right controls are compact, contain no shortcut list, and all buttons still work.
6. Console contains no new errors and the ContentLoader scene summary has no new failures.

- [ ] **Step 5: Review scope boundaries**

Confirm with read-only Git/status checks that every committed path belongs to the OCCT worktree and no file under `C:\Users\User\Desktop\cad_plugin` was modified by this plan.
