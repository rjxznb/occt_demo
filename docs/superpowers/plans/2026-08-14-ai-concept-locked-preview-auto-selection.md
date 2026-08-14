# AI Concept Locked Preview and Automatic Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock mouse rotation and wheel zoom during ordinary AI concept preview, enable them only while editing, and submit every usable view without manual selection controls.

**Architecture:** `SceneManager` owns a backward-compatible fixed-camera interaction gate, while `AiConceptApp` maps its page phase to that gate. The store exposes readiness from usable views rather than legacy selection state, and the AI page derives its generation payload from all usable views while removing selection-only UI.

**Tech Stack:** JavaScript ES modules, Three.js, DOM APIs, Node.js built-in test runner, Vite.

## Global Constraints

- Work only in `D:\occt_demo\.worktrees\panorama-white-model-page`; do not modify CAD Plugin.
- Preserve panorama and 3D fixed-camera behavior by defaulting the new interaction gate to enabled.
- Ordinary AI preview disables mouse drag rotation and wheel zoom.
- AI edit mode enables drag rotation, wheel zoom, and the existing position movement.
- Saving, cancelling, leaving the ready/editing flow, or destroying the AI runtime leaves fixed-camera interaction disabled.
- Generation includes every view where `valid !== false` and `status` is neither `excluded` nor `disabled`.
- Retain the persisted `selected` field for draft compatibility, but do not use it in the AI page UI, readiness, or generation payload.
- Do not add runtime dependencies or refactor unrelated camera behavior.

---

### Task 1: Fixed-Camera Interaction Gate

**Files:**
- Modify: `src/core/SceneManager.js`
- Test: `tests/camera-preset-view.test.js`

**Interfaces:**
- Consumes: existing fixed-camera pointer and wheel handlers.
- Produces: `SceneManager.setCameraPresetInteractionEnabled(enabled): boolean`, where `true` means the stored permission changed.

- [ ] **Step 1: Write failing tests for disabled input and drag cleanup**

Append these tests to `tests/camera-preset-view.test.js`:

```js
test('disabled camera preset interaction ignores pointer drag and wheel zoom', () => {
    const manager = Object.create(SceneManager.prototype);
    manager.cameraPresetViewState = {};
    manager.cameraPresetInteractionEnabled = false;
    manager.cameraPresetPointer = { id: 7, x: 100, y: 100 };
    manager.cameraPresetYaw = 0;
    manager.cameraPresetPitch = 0;
    manager.cameraPresetHorizontalFov = 90;
    manager.perspectiveCamera = new THREE.PerspectiveCamera(90, 1, 1, 10000);
    manager.controls = { target: new THREE.Vector3() };
    manager.applyCameraPresetHorizontalFov = value => { manager.appliedFov = value; };

    manager.onCameraPresetPointerMove({
        pointerId: 7,
        clientX: 180,
        clientY: 60,
        preventDefault() { throw new Error('disabled drag must not be consumed'); },
        stopImmediatePropagation() { throw new Error('disabled drag must not be consumed'); },
    });
    manager.onCameraPresetWheel({
        deltaY: 120,
        preventDefault() { throw new Error('disabled wheel must not be consumed'); },
        stopImmediatePropagation() { throw new Error('disabled wheel must not be consumed'); },
    });

    assert.equal(manager.cameraPresetYaw, 0);
    assert.equal(manager.cameraPresetPitch, 0);
    assert.equal(manager.appliedFov, undefined);
});

test('disabling camera preset interaction clears an active pointer capture', () => {
    const removed = [];
    const manager = Object.create(SceneManager.prototype);
    manager.cameraPresetInteractionEnabled = true;
    manager.cameraPresetPointer = { id: 11, x: 20, y: 30 };
    manager.renderer = { domElement: {
        releasePointerCapture(id) { manager.releasedPointerId = id; },
        classList: { remove(name) { removed.push(name); } },
    } };

    assert.equal(manager.setCameraPresetInteractionEnabled(false), true);
    assert.equal(manager.cameraPresetPointer, null);
    assert.equal(manager.releasedPointerId, 11);
    assert.deepEqual(removed, ['camera-preset-dragging']);
    assert.equal(manager.setCameraPresetInteractionEnabled(false), false);
});
```

- [ ] **Step 2: Run the camera test and verify RED**

Run:

```powershell
node --test tests/camera-preset-view.test.js
```

Expected: FAIL because the handlers ignore no interaction gate and `setCameraPresetInteractionEnabled` does not exist.

- [ ] **Step 3: Implement the minimal interaction gate**

Initialize this field beside the existing camera-preset fields in `SceneManager`'s constructor:

```js
this.cameraPresetInteractionEnabled = true;
```

Add this method before `onCameraPresetPointerDown`:

```js
setCameraPresetInteractionEnabled(enabled) {
    const next = Boolean(enabled);
    if (this.cameraPresetInteractionEnabled === next) return false;
    this.cameraPresetInteractionEnabled = next;
    if (!next && this.cameraPresetPointer) {
        const pointerId = this.cameraPresetPointer.id;
        this.renderer?.domElement?.releasePointerCapture?.(pointerId);
        this.cameraPresetPointer = null;
        this.renderer?.domElement?.classList?.remove('camera-preset-dragging');
    }
    return true;
}
```

Add `this.cameraPresetInteractionEnabled === false` guards to `onCameraPresetPointerDown`, `onCameraPresetPointerMove`, and `onCameraPresetWheel`. Keep pointer-up cleanup available for an already active pointer.

- [ ] **Step 4: Run the camera test and verify GREEN**

Run:

```powershell
node --test tests/camera-preset-view.test.js
```

Expected: all camera-preset tests pass, including the existing enabled drag behavior.

- [ ] **Step 5: Commit the gate**

```powershell
git add src/core/SceneManager.js tests/camera-preset-view.test.js
git commit -m "feat: gate fixed-camera interaction"
```

---

### Task 2: Map AI Page Phases to Camera Permission

**Files:**
- Modify: `src/AiConceptApp.js`
- Modify: `tests/helpers/ai-concept-app-harness.js`
- Test: `tests/ai-concept-app-state.test.js`

**Interfaces:**
- Consumes: `SceneManager.setCameraPresetInteractionEnabled(enabled)` from Task 1.
- Produces: AI phase mapping where only `editing` enables fixed-camera mouse interaction.

- [ ] **Step 1: Make the harness record camera permission changes**

Add this method to the fake `sceneManager` in `tests/helpers/ai-concept-app-harness.js`:

```js
setCameraPresetInteractionEnabled(value) {
    this.cameraInteractionEnabled = Boolean(value);
    calls.push(['camera-interaction', Boolean(value)]);
    return true;
},
```

- [ ] **Step 2: Write failing AI phase tests**

Append this test to `tests/ai-concept-app-state.test.js`:

```js
test('camera interaction is locked in preview and enabled only while editing', async () => {
    const { app, calls, sceneManager } = createAiConceptHarness();
    await app.init();
    assert.equal(sceneManager.cameraInteractionEnabled, false);

    assert.equal(await app.enterEditMode(), true);
    assert.equal(sceneManager.cameraInteractionEnabled, true);

    assert.equal(app.cancelEdit(), true);
    assert.equal(sceneManager.cameraInteractionEnabled, false);

    assert.equal(await app.enterEditMode(), true);
    assert.notEqual(await app.saveEdit(), false);
    assert.equal(sceneManager.cameraInteractionEnabled, false);
    assert.deepEqual(
        calls.filter(call => call[0] === 'camera-interaction').map(call => call[1]),
        [false, true, false, true, false],
    );
});
```

- [ ] **Step 3: Run the AI state test and verify RED**

Run:

```powershell
node --test tests/ai-concept-app-state.test.js
```

Expected: FAIL because `AiConceptApp` never sets fixed-camera interaction permission.

- [ ] **Step 4: Centralize permission synchronization in `AiConceptApp`**

Add this method next to `_setPhase`:

```js
_syncCameraInteraction() {
    this.sceneManager?.setCameraPresetInteractionEnabled?.(this.phase === 'editing');
}
```

Call it from `_setPhase` immediately after assigning `this.phase`:

```js
this.phase = phase;
this._syncCameraInteraction();
```

Before destroying a live runtime in `_destroyRuntime`, explicitly disable interaction:

```js
this.sceneManager?.setCameraPresetInteractionEnabled?.(false);
```

Do not add permission calls to individual view-selection paths; phase remains the authority.

- [ ] **Step 5: Run the AI state and startup tests**

Run:

```powershell
node --test tests/ai-concept-app-state.test.js tests/ai-concept-app-startup.test.js
```

Expected: both files pass and existing camera transitions remain unchanged.

- [ ] **Step 6: Commit AI phase integration**

```powershell
git add src/AiConceptApp.js tests/helpers/ai-concept-app-harness.js tests/ai-concept-app-state.test.js
git commit -m "feat: lock AI preview camera interaction"
```

---

### Task 3: Remove Manual Selection and Submit Every Usable View

**Files:**
- Modify: `src/ai-concept/AiViewStore.js`
- Modify: `src/ai-concept/AiViewFilmstrip.js`
- Modify: `src/AiConceptApp.js`
- Modify: `src/ai-concept/ai-concept.css`
- Modify: `index-ai-concept.html`
- Modify: `tests/helpers/ai-concept-app-harness.js`
- Test: `tests/ai-view-store.test.js`
- Test: `tests/ai-view-filmstrip.test.js`
- Test: `tests/ai-concept-app-state.test.js`
- Test: `tests/ai-concept-page-contract.test.js`

**Interfaces:**
- Consumes: existing `canUse(view)` predicate in `AiViewStore` and the current ordered `state.views` array.
- Produces: `canContinue` based on any usable view, selection-free filmstrip UI, and `continueToConditions()` payload containing all usable views.

- [ ] **Step 1: Write failing store and payload tests**

Add this test to `tests/ai-view-store.test.js`:

```js
test('generation can continue when usable views are not manually selected', async () => {
    const store = await createStore();
    await store.toggleSelected('best');

    assert.deepEqual(store.getState().views.filter(view => view.selected), []);
    assert.equal(store.getState().canContinue, true);
});
```

Replace the payload length assertion in `tests/ai-concept-app-state.test.js` with:

```js
const usable = app.getState().views.filter(view => view.valid !== false
    && !['excluded', 'disabled'].includes(view.status));
assert.equal(payload.selectedViews.length, usable.length);
assert.deepEqual(payload.selectedViews.map(view => view.id), usable.map(view => view.id));
assert.ok(payload.selectedViews.some(view => view.selected === false));
```

- [ ] **Step 2: Write failing filmstrip and page-contract tests**

In `tests/ai-view-filmstrip.test.js`:

- Remove the `onToggleSelected` call recorder.
- Assert `findByDataset(active, 'action', 'toggle-selected') === null`.
- Remove the selection-button click and `['select', id]` expected call.
- Assert `active.classList.contains('is-selected') === false`.

In `tests/ai-concept-page-contract.test.js`:

- Remove `ai-concept-selection-count` from `requiredIds`.
- Add `assert.doesNotMatch(html, /id=["']ai-concept-selection-count["']/);`.
- Add `assert.doesNotMatch(css, /\.ai-view-card\.is-selected|toggle-selected/);`.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```powershell
node --test tests/ai-view-store.test.js tests/ai-view-filmstrip.test.js tests/ai-concept-app-state.test.js tests/ai-concept-page-contract.test.js
```

Expected: failures show that readiness and payload still depend on `selected`, and selection UI still exists.

- [ ] **Step 4: Make store readiness selection-independent**

Change `AiViewStore.getState()` to:

```js
canContinue: this.views.some(view => canUse(view)),
```

Keep `toggleSelected` and persisted `selected` fields intact for draft compatibility.

- [ ] **Step 5: Remove selection controls from the filmstrip**

In `AiViewFilmstrip`:

- Remove the `onToggleSelected` constructor option and handler field.
- Remove `card.classList.toggle('is-selected', ...)`.
- Remove creation and appending of the `toggle-selected` button.

Do not change activation, edit, delete, restore, add, or thumbnail retry handlers.

- [ ] **Step 6: Make the app derive all usable generation views**

Add this helper near `messageOf` in `src/AiConceptApp.js`:

```js
function canSubmitView(view) {
    return Boolean(view)
        && view.valid !== false
        && !['excluded', 'disabled'].includes(view.status);
}
```

Then:

- Remove `ai-concept-selection-count` from `_collectUi()`.
- Remove `onToggleSelected` from `_createRuntime()`.
- Remove selection-count rendering from `_renderState()`.
- Remove the `toggleSelected()` page method.
- Change `continueToConditions()` to filter with `canSubmitView` rather than `selected`.

The payload key remains `selectedViews` for downstream compatibility:

```js
selectedViews: clone(state.views.filter(canSubmitView)),
```

- [ ] **Step 7: Remove obsolete HTML and CSS**

Remove the selection-count `<span>` from `index-ai-concept.html` and remove both rules from `src/ai-concept/ai-concept.css`:

```css
.ai-view-card.is-selected::after { ... }
.ai-view-card > [data-action="toggle-selected"] { ... }
```

Remove `ai-concept-selection-count` from `REQUIRED_IDS` in `tests/helpers/ai-concept-app-harness.js`.

- [ ] **Step 8: Run the focused selection tests and verify GREEN**

Run:

```powershell
node --test tests/ai-view-store.test.js tests/ai-view-filmstrip.test.js tests/ai-concept-app-state.test.js tests/ai-concept-page-contract.test.js
```

Expected: all focused tests pass.

- [ ] **Step 9: Commit the automatic-selection behavior**

```powershell
git add src/ai-concept/AiViewStore.js src/ai-concept/AiViewFilmstrip.js src/AiConceptApp.js src/ai-concept/ai-concept.css index-ai-concept.html tests/helpers/ai-concept-app-harness.js tests/ai-view-store.test.js tests/ai-view-filmstrip.test.js tests/ai-concept-app-state.test.js tests/ai-concept-page-contract.test.js
git commit -m "feat: submit all usable AI views"
```

---

### Task 4: Full Regression, Build, and Browser Verification

**Files:**
- Verify: `src/core/SceneManager.js`
- Verify: `src/AiConceptApp.js`
- Verify: `src/ai-concept/AiViewFilmstrip.js`
- Verify: `src/ai-concept/AiViewStore.js`
- Verify: `dist-3d/index-ai-concept.html`

**Interfaces:**
- Consumes: the completed interaction gate, phase mapping, and automatic payload rules.
- Produces: verified production assets and browser behavior.

- [ ] **Step 1: Run the full test suite**

Run:

```powershell
npm.cmd test
```

Expected: zero failures; only the existing CAD environment-gated tests may be skipped.

- [ ] **Step 2: Build the 3D distribution**

Run:

```powershell
npm.cmd run build:3d
```

Expected: Vite emits `dist-3d/index-ai-concept.html` successfully.

- [ ] **Step 3: Verify the actual AI page in the browser**

Open or reload:

```text
http://127.0.0.1:4182/index-ai-concept.html?planId=ai-thumbnails-qa&version=1#debug
```

Verify:

1. Dragging the canvas in ordinary preview does not change yaw or pitch.
2. Wheel input in ordinary preview does not change FOV.
3. Clicking “微调” enables drag rotation, wheel zoom, and existing position movement.
4. Saving and cancelling micro-adjustment both lock drag and wheel again.
5. Cards show no selection button or checkmark, and the action area shows no selection count.
6. The generation action remains enabled while at least one usable view exists.
7. Thumbnail, mini-map, and previous/next view switching still work.
8. The browser console reports no new errors.

- [ ] **Step 4: Inspect final repository state**

Run:

```powershell
git status --short
git log -6 --oneline
```

Expected: a clean worktree with the three implementation commits above the design and plan commits.
