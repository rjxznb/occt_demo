# Panorama Entry View Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users author the panorama page's persistent entry point and live view, remove the top bar, reposition the mini-map, and add a lower-right adjustment/render action dock with a subtle edit-state glow.

**Architecture:** Extend `PanoramaPointStore` with one atomic entry-view write while changing only fresh initialization to prefer `initialPointId`. `PanoramaMiniMap` reports the new intent, and `PanoramaApp` captures the live camera pose and coordinates action availability. The standalone HTML/CSS owns the simplified upper-right and lower-right layout; submit rendering remains intentionally side-effect free.

**Tech Stack:** JavaScript ES modules, Three.js, Node test runner, fake DOM test harness, CSS, Vite.

## Global Constraints

- Modify only `D:/occt_demo/.worktrees/panorama-white-model-page`; do not modify CAD Plugin.
- Preserve the existing persisted draft schema: `initialPointId`, `lastActivePointId`, and `views` remain authoritative.
- Every fresh page initialization must prefer a valid `initialPointId` over `lastActivePointId`.
- `提交渲染` is a UI-only placeholder: no network, native bridge, capture, or offline-render side effect.
- Keep existing bottom-center browse and edit controls.
- Use the approved `A · 雾蓝边缘` low-saturation edit-state treatment.
- Follow red-green-refactor: observe each new test fail before changing production code.

---

### Task 1: Atomic entry-view persistence and startup priority

**Files:**
- Modify: `tests/panorama-point-store.test.js`
- Modify: `src/panorama/PanoramaPointStore.js`

**Interfaces:**
- Consumes: existing normalized draft fields `initialPointId`, `lastActivePointId`, and `views`.
- Produces: `PanoramaPointStore.setEntryView(id, view): Promise<boolean>`; fresh `initialize()` selects the valid initial point.

- [ ] **Step 1: Change the draft-selection assertion to specify fresh-entry behavior**

In `keeps original points immutable while applying draft overrides`, change the final active-point expectation from the remembered point to the configured initial point:

```js
assert.equal(state.initialPointId, 'draft:new');
assert.equal(state.activePointId, 'draft:new');
```

- [ ] **Step 2: Add a failing atomic entry-view test**

Append this behavior test, using the existing `createStore` helper:

```js
test('sets the entry point and complete live view in one observable change', async () => {
    const { store } = await createStore();
    let notifications = 0;
    const unsubscribe = store.subscribe(() => { notifications += 1; });

    assert.equal(await store.setEntryView('camera:b', {
        yaw: 137,
        pitch: -8,
        fov: 102,
    }), true);

    const state = store.getState();
    assert.equal(state.initialPointId, 'camera:b');
    assert.deepEqual(state.views['camera:b'], { yaw: 137, pitch: -8, fov: 102 });
    assert.equal(notifications, 1);
    unsubscribe();
});
```

- [ ] **Step 3: Add invalid-input coverage**

```js
test('rejects invalid entry points and incomplete live views without notifying', async () => {
    const { store } = await createStore();
    let notifications = 0;
    store.subscribe(() => { notifications += 1; });

    assert.equal(await store.setEntryView('missing', { yaw: 0, pitch: 0, fov: 90 }), false);
    assert.equal(await store.setEntryView('camera:b', { yaw: 0, pitch: NaN, fov: 90 }), false);
    assert.equal(store.getState().initialPointId, 'camera:a');
    assert.equal(notifications, 0);
});
```

- [ ] **Step 4: Run the focused test and verify red**

Run: `node --test tests/panorama-point-store.test.js`

Expected: the fresh-selection assertion receives `camera:a`, and both new tests fail because `setEntryView` does not exist.

- [ ] **Step 5: Prefer the valid initial point only during initialization**

Change the private selection helper to accept an explicit fresh-initialization option:

```js
_ensureSelection({ preferInitial = false } = {}) {
    const validPoints = this._validPoints();
    const validIds = new Set(validPoints.map(point => point.id));
    const firstId = validPoints[0]?.id ?? null;
    if (!validIds.has(this.draft.initialPointId)) this.draft.initialPointId = firstId;
    if (preferInitial) this.activePointId = this.draft.initialPointId;
    if (!validIds.has(this.activePointId)) {
        this.activePointId = validIds.has(this.draft.lastActivePointId)
            ? this.draft.lastActivePointId
            : this.draft.initialPointId;
    }
    this.draft.lastActivePointId = this.activePointId;
}
```

Call it from `initialize` as:

```js
this._ensureSelection({ preferInitial: true });
```

Leave `_commitChange` calling `_ensureSelection()` without the option so in-session selections are not reset.

- [ ] **Step 6: Implement one atomic store mutation**

Add after `setInitialPoint`:

```js
async setEntryView(id, view = {}) {
    const point = this._pointById(id);
    const nextView = Object.fromEntries(
        ['yaw', 'pitch', 'fov'].map(key => [key, Number(view[key])]),
    );
    if (!point || point.valid === false) return false;
    if (!Object.values(nextView).every(Number.isFinite)) return false;

    const current = this.draft.views[id] ?? {};
    const changed = this.draft.initialPointId !== id
        || ['yaw', 'pitch', 'fov'].some(key => !sameValue(current[key], nextView[key]));
    if (!changed) return false;
    this.draft.initialPointId = id;
    this.draft.views[id] = nextView;
    return this._commitChange(true);
}
```

- [ ] **Step 7: Run the store tests and verify green**

Run: `node --test tests/panorama-point-store.test.js tests/panorama-point-model.test.js tests/panorama-point-repository.test.js`

Expected: all tests pass; startup priority changes only where explicitly asserted.

- [ ] **Step 8: Commit the store behavior**

```powershell
git add tests/panorama-point-store.test.js src/panorama/PanoramaPointStore.js
git commit -m "feat: persist panorama entry views"
```

---

### Task 2: Mini-map entry-view action

**Files:**
- Modify: `tests/panorama-minimap.test.js`
- Modify: `src/panorama/PanoramaMiniMap.js`

**Interfaces:**
- Consumes: `PanoramaMiniMap` constructor options.
- Produces: `onSetEntryView(): void` callback and a `data-action="set-entry-view"` button in the mini-map action area.

- [ ] **Step 1: Extend the mini-map callback test first**

In `reports collapse and world-space create intents through callbacks`, add the callback and assertion:

```js
onSetEntryView: () => actions.push('entry'),
```

Then locate and click the new button:

```js
const entry = findByDataset(container, 'action', 'set-entry-view');
assert.ok(entry);
entry.click();
assert.deepEqual(actions, ['add', 'restore', 'entry']);
```

- [ ] **Step 2: Run the mini-map test and verify red**

Run: `node --test tests/panorama-minimap.test.js`

Expected: FAIL because no element has `data-action="set-entry-view"`.

- [ ] **Step 3: Add the constructor callback and button**

Add the default option and instance field:

```js
onSetEntryView = () => {},
// ...
this.onSetEntryView = onSetEntryView;
```

Create the third action after `restoreButton`:

```js
const entryButton = this._element('button', 'panorama-button');
entryButton.type = 'button';
entryButton.dataset.action = 'set-entry-view';
entryButton.textContent = '设为进入视角';
entryButton.addEventListener('click', event => {
    event.stopPropagation();
    this.onSetEntryView();
});
actions.appendChild(entryButton);
```

- [ ] **Step 4: Run the mini-map tests and verify green**

Run: `node --test tests/panorama-minimap.test.js`

Expected: all mini-map tests pass, including collapse hiding the whole action area.

- [ ] **Step 5: Commit the mini-map action**

```powershell
git add tests/panorama-minimap.test.js src/panorama/PanoramaMiniMap.js
git commit -m "feat: add panorama entry view action"
```

---

### Task 3: App entry-view workflow and action availability

**Files:**
- Modify: `tests/helpers/panorama-app-harness.js`
- Modify: `tests/panorama-app-state.test.js`
- Modify: `tests/panorama-app-startup.test.js`
- Modify: `src/PanoramaApp.js`

**Interfaces:**
- Consumes: `store.setEntryView(id, view)` and `sceneManager.getCameraPresetPose()`.
- Produces: `PanoramaApp.setCurrentEntryView(): Promise<boolean>`; synchronized lower-right button availability.

- [ ] **Step 1: Update the fake page contract in the harness**

Remove the obsolete top-bar presentation IDs from `REQUIRED_IDS` and add:

```js
'panorama-primary-actions', 'panorama-submit-render',
```

Keep `panorama-edit-toggle` because the renamed button retains this stable app-facing ID.

- [ ] **Step 2: Add a failing app entry-view test**

Append to `tests/panorama-app-state.test.js`:

```js
test('sets the active live camera pose as the persistent entry view', async () => {
    const { app, sceneManager } = createHarness({
        cameraList: [
            cameraRecord(1000, 1000, 'Point A'),
            cameraRecord(2500, 1500, 'Point B'),
        ],
    });
    await app.init();
    const [, second] = app.getState().points;
    await app.selectPoint(second.id);
    sceneManager.pose = { ...sceneManager.pose, yaw: 137, pitch: -8, fov: 102 };

    assert.equal(await app.setCurrentEntryView(), true);
    assert.equal(app.getState().initialPointId, second.id);
    assert.deepEqual(app.getState().views[second.id], {
        yaw: 137,
        pitch: -8,
        fov: 102,
    });
});
```

- [ ] **Step 3: Add failing edit-state availability assertions**

Extend `edit cancel restores its entry snapshot and save commits a valid preview`:

```js
const submit = documentRef.getElementById('panorama-submit-render');
assert.equal(submit.disabled, false);
assert.equal(app.enterEditMode(), true);
assert.equal(submit.disabled, true);
// after cancel
assert.equal(submit.disabled, false);
// after entering again and save
assert.equal(submit.disabled, false);
```

Also assert that the edit button is disabled in edit mode and restored afterward.

- [ ] **Step 4: Remove obsolete startup presentation assertion**

Delete the `panorama-point-name` text assertion from `tests/panorama-app-startup.test.js`; retain all scene, phase, loading, error, and empty-state assertions.

- [ ] **Step 5: Run focused app tests and verify red**

Run: `node --test tests/panorama-app-state.test.js tests/panorama-app-startup.test.js`

Expected: FAIL because `setCurrentEntryView` and the submit-button synchronization do not exist.

- [ ] **Step 6: Wire the mini-map callback and live-pose write**

In `_createRuntime`, pass:

```js
onSetEntryView: () => void this.setCurrentEntryView(),
```

Add the app method:

```js
async setCurrentEntryView() {
    const active = this._activePoint();
    const pose = this.sceneManager?.getCameraPresetPose?.();
    const view = {
        yaw: Number(pose?.yaw),
        pitch: Number(pose?.pitch),
        fov: Number(pose?.fov),
    };
    if (!active || !Object.values(view).every(Number.isFinite)) {
        this.showToast('当前视角不可保存');
        return false;
    }
    const changed = await this.store.setEntryView(active.id, view);
    this.showToast(changed ? '已设为进入视角' : '当前已是进入视角');
    return changed;
}
```

- [ ] **Step 7: Synchronize lower-right action availability**

Collect `panorama-submit-render` and add:

```js
_syncPrimaryActions(editing = this.inputPolicy?.mode === 'edit') {
    const enabled = this.phase === 'ready' && Boolean(this._activePoint());
    if (this.ui.editToggle) this.ui.editToggle.disabled = !enabled || editing;
    if (this.ui.submitRender) this.ui.submitRender.disabled = !enabled || editing;
}
```

Call it at the end of `_setPhase`, `_renderState`, and `_setEditingUi`. Do not add a click listener for `submitRender`.

- [ ] **Step 8: Remove top-bar-only UI writes**

Remove `planName`, `planVersion`, `roomName`, and `pointName` from `_collectUi`; remove their text assignments in initialization and `_renderState`. Keep document context resolution because storage isolation still requires `planId` and `version`.

- [ ] **Step 9: Run app tests and verify green**

Run: `node --test tests/panorama-app-state.test.js tests/panorama-app-startup.test.js tests/panorama-minimap.test.js`

Expected: all tests pass; the submit button has no registered click behavior.

- [ ] **Step 10: Commit the app workflow**

```powershell
git add tests/helpers/panorama-app-harness.js tests/panorama-app-state.test.js tests/panorama-app-startup.test.js src/PanoramaApp.js
git commit -m "feat: author panorama entry views"
```

---

### Task 4: Standalone page layout and approved adjustment glow

**Files:**
- Modify: `tests/panorama-page-contract.test.js`
- Modify: `index-panorama.html`
- Modify: `src/panorama/panorama.css`

**Interfaces:**
- Consumes: stable IDs `panorama-edit-toggle`, `panorama-submit-render`, and body class `panorama-editing`.
- Produces: upper-right mini-map, lower-right primary action dock, and reduced-motion-safe edit glow.

- [ ] **Step 1: Change the HTML contract test before markup**

Update `requiredIds` to remove `panorama-topbar` and add:

```js
'panorama-primary-actions', 'panorama-edit-toggle', 'panorama-submit-render',
```

Add explicit absence and copy assertions:

```js
assert.doesNotMatch(html, /id=["']panorama-topbar["']/);
assert.match(html, />\s*位置微调\s*</);
assert.match(html, />\s*提交渲染\s*</);
assert.doesNotMatch(html, /生成全景图/);
```

- [ ] **Step 2: Specify layout and glow contracts in the CSS test**

Add:

```js
assert.match(css, /\.panorama-minimap\s*\{[\s\S]*?right:\s*16px/);
assert.match(css, /\.panorama-primary-actions\s*\{[\s\S]*?right:\s*16px[\s\S]*?bottom:/);
assert.match(css, /\.panorama-app::after/);
assert.match(css, /\.panorama-editing\s+\.panorama-app::after[\s\S]*?opacity:\s*1/);
assert.match(css, /inset\s+0\s+0\s+32px[\s\S]*?rgba\(79,\s*139,\s*188,\s*0\.22\)/);
```

- [ ] **Step 3: Run the page contract test and verify red**

Run: `node --test tests/panorama-page-contract.test.js`

Expected: FAIL because the top bar still exists, the lower-right dock is absent, the mini-map uses `left`, and the glow overlay is absent.

- [ ] **Step 4: Replace the top bar with the primary action dock**

Remove the entire `panorama-topbar` header from `index-panorama.html`. Add after the mini-map:

```html
<section id="panorama-primary-actions"
    class="panorama-glass panorama-primary-actions"
    aria-label="全景操作">
    <button id="panorama-edit-toggle" type="button"
        class="panorama-button panorama-button-primary">
        位置微调
    </button>
    <button id="panorama-submit-render" type="button" class="panorama-button">
        提交渲染
    </button>
</section>
```

- [ ] **Step 5: Move the mini-map and add the action dock styles**

Replace the mini-map horizontal anchor with `right: 16px` and remove `left`. Add:

```css
.panorama-primary-actions {
    position: absolute;
    z-index: 20;
    right: 16px;
    bottom: max(16px, env(safe-area-inset-bottom));
    display: flex;
    gap: 7px;
    padding: 8px;
    border-radius: 16px;
}

.panorama-minimap-actions [data-action="set-entry-view"] {
    grid-column: 1 / -1;
}
```

Delete `.panorama-topbar`, `.panorama-brand`, `.panorama-context`, `.panorama-top-actions`, badge, divider, and their narrow-screen overrides because no remaining element uses them.

- [ ] **Step 6: Implement the approved mist-blue edit overlay**

Add:

```css
.panorama-app::after {
    content: '';
    position: absolute;
    z-index: 30;
    inset: 0;
    pointer-events: none;
    opacity: 0;
    box-shadow:
        inset 0 0 32px 6px rgba(79, 139, 188, 0.22),
        inset 0 0 88px 10px rgba(68, 117, 158, 0.10);
    transition: opacity 220ms ease;
}

.panorama-editing .panorama-app::after {
    opacity: 1;
}
```

Inside the existing reduced-motion query, set `.panorama-app::after { transition: none; }`.

- [ ] **Step 7: Update responsive placement**

In the `max-width: 760px` query, keep the mini-map right-aligned and reduce its top inset to `8px`; place `.panorama-primary-actions` at `right: 8px` and `bottom: 8px`. Ensure neither rule moves the action dock to the bottom center where it would overlap browse/edit controls.

- [ ] **Step 8: Run page tests and verify green**

Run: `node --test tests/panorama-page-contract.test.js tests/panorama-app-startup.test.js`

Expected: all tests pass and no test references removed top-bar-only IDs.

- [ ] **Step 9: Commit the standalone layout**

```powershell
git add tests/panorama-page-contract.test.js index-panorama.html src/panorama/panorama.css
git commit -m "refactor: simplify panorama controls"
```

---

### Task 5: Full regression, build, and browser QA

**Files:**
- Modify only if verification exposes a tested defect.

**Interfaces:**
- Consumes: completed entry-view and layout behavior.
- Produces: automated, build, persistence, interaction, and visual evidence.

- [ ] **Step 1: Run the complete automated suite**

Run: `npm.cmd test`

Expected: zero failures; environment-dependent CAD tests may remain explicitly skipped.

- [ ] **Step 2: Build the 3D distribution**

Run: `npm.cmd run build:3d`

Expected: Vite exits with code 0 and emits `dist-3d/index-panorama.html`.

- [ ] **Step 3: Check patch hygiene**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors and no changes outside the intended `occt_demo` worktree files.

- [ ] **Step 4: Open a fresh isolated browser context**

Open:

`http://127.0.0.1:4181/index-panorama.html?fixture=cameras&planId=entry-view-qa-20260811&version=1#debug`

Expected: no top bar; mini-map is upper-right; `位置微调` and `提交渲染` are lower-right.

- [ ] **Step 5: Verify entry-view persistence**

Select a non-default point, rotate to a visibly different yaw/pitch, change zoom, click `设为进入视角`, navigate elsewhere, and reload the page.

Expected: reload returns to the authored point with the authored yaw, pitch, and FOV rather than the last browsed point.

- [ ] **Step 6: Verify adjustment state behavior**

Click `位置微调`.

Expected: the low-saturation mist-blue glow appears around all four viewport edges; both lower-right buttons are disabled; bottom-center edit controls remain usable. Save and repeat with cancel; each exit removes the glow and re-enables both lower-right buttons.

- [ ] **Step 7: Verify the submit placeholder is inert**

Click `提交渲染` in browse mode and inspect page logs.

Expected: no navigation, download, network/native render action, modal, or console error.

- [ ] **Step 8: Verify responsive non-overlap**

Inspect the normal desktop viewport and one viewport narrower than 760 px.

Expected: upper-right mini-map, lower-right action dock, and bottom-center controls remain separately clickable without overlap.

- [ ] **Step 9: Commit only if verification required a tested correction**

If no correction was required, leave the worktree clean. If a correction was required, first add a failing regression test, then commit the minimal fix with a message that names that defect.
