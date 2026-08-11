# Panorama Spatial Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make panorama point collision height-aware, add view-relative WASD point navigation, and consolidate point actions into the mini-map card.

**Architecture:** Scene obstacle collection supplies full 3D AABBs to the existing point validator. A new pure directional resolver selects one valid point from the live camera yaw, while `PanoramaInputPolicy` separates one-shot browse commands from continuous edit movement. `PanoramaMiniMap` owns its action footer, allowing the standalone point-list panel and its page wiring to be removed.

**Tech Stack:** JavaScript ES modules, Three.js, Node test runner, CSS, Vite.

## Global Constraints

- Modify only `D:/occt_demo/.worktrees/panorama-white-model-page`; do not modify CAD Plugin.
- Keep the point draft schema and `PanoramaPointStore` APIs backward-compatible.
- Keep edit-mode continuous WASD and arrow-key movement unchanged except where tests explicitly distinguish browse behavior.
- Keep the existing 0.8-second point transition and live-view persistence flow.
- Use test-driven development: every production behavior must first be demonstrated by a failing test.

---

### Task 1: Height-aware furniture collision

**Files:**
- Modify: `tests/panorama-app-state.test.js`
- Modify: `tests/panorama-point-validator.test.js`
- Modify: `src/PanoramaApp.js`
- Modify: `src/panorama/PanoramaPointValidator.js`

**Interfaces:**
- Consumes: `collectContentObstacleBounds(sceneGroup)` and `validatePanoramaPoint(point, options)`.
- Produces: obstacle records `{ id, minX, minY, minZ, maxX, maxY, maxZ }`; validation uses `cameraRadius` on all three axes when Z bounds exist.

- [x] **Step 1: Add a failing collection test** in `tests/panorama-app-state.test.js` by extending the existing fixed-content test assertion to include `minZ: 0` and `maxZ: 800` for its 800 mm-tall mesh.
- [x] **Step 2: Run** `node --test tests/panorama-app-state.test.js` and verify the assertion fails because Z bounds are absent.
- [x] **Step 3: Add failing validator tests** in `tests/panorama-point-validator.test.js`:

```js
test('allows XY overlap when the camera clearance is above the obstacle', () => {
    const result = validatePanoramaPoint({ x: 1700, y: 1000, z: 1500 }, {
        ...ROOMS,
        minWallDistance: 0,
        cameraRadius: 80,
        obstacles: [{
            id: 'table', minX: 1500, minY: 800, minZ: 0,
            maxX: 1900, maxY: 1200, maxZ: 750,
        }],
    });
    assert.equal(result.valid, true);
});

test('rejects full XYZ overlap with a fixed obstacle', () => {
    const result = validatePanoramaPoint({ x: 1700, y: 1000, z: 800 }, {
        ...ROOMS,
        minWallDistance: 0,
        cameraRadius: 80,
        obstacles: [{
            id: 'cabinet', minX: 1500, minY: 800, minZ: 0,
            maxX: 1900, maxY: 1200, maxZ: 900,
        }],
    });
    assert.equal(result.code, 'BLOCKED');
});
```

- [x] **Step 4: Run** `node --test tests/panorama-point-validator.test.js` and verify the above-table case fails with `BLOCKED`.
- [x] **Step 5: Extend obstacle collection** in `src/PanoramaApp.js` to include `box.min.z` and `box.max.z`.
- [x] **Step 6: Extend `obstacleBounds` and `overlappingObstacle`** so finite Z bounds require Z overlap and missing Z bounds preserve legacy XY-only behavior.
- [x] **Step 7: Run** `node --test tests/panorama-app-state.test.js tests/panorama-point-validator.test.js` and verify both files pass.
- [x] **Step 8: Commit** with message `fix: validate panorama obstacles in 3d`.

### Task 2: Pure view-relative directional resolver

**Files:**
- Create: `src/panorama/PanoramaDirectionalNavigator.js`
- Create: `tests/panorama-directional-navigator.test.js`

**Interfaces:**
- Produces: `selectDirectionalPanoramaPoint({ activePoint, points, yaw, direction, coneDegrees = 60 })` returning the selected point or `null`.
- Direction values: `'forward' | 'backward' | 'left' | 'right'`.

- [ ] **Step 1: Create failing resolver tests** covering yaw-zero forward/right bases, yaw rotation, cone rejection, angle-before-distance ordering, distance tie-breaking, stable source-order ties, and exclusion of active, invalid, and coincident points.
- [ ] **Step 2: Run** `node --test tests/panorama-directional-navigator.test.js` and verify it fails because the module does not exist.
- [ ] **Step 3: Implement the minimal pure resolver** using these bases:

```js
const yawRadians = yaw * Math.PI / 180;
const forward = { x: Math.cos(yawRadians), y: Math.sin(yawRadians) };
const right = { x: Math.sin(yawRadians), y: -Math.cos(yawRadians) };
```

Filter candidates with `dot >= Math.cos(coneDegrees * Math.PI / 180)`, then sort by descending dot, ascending squared planar distance, and ascending original array index.

- [ ] **Step 4: Run** `node --test tests/panorama-directional-navigator.test.js` and verify all resolver tests pass.
- [ ] **Step 5: Commit** with message `feat: resolve directional panorama points`.

### Task 3: Browse-mode WASD integration

**Files:**
- Modify: `tests/panorama-input-policy.test.js`
- Modify: `tests/panorama-app-state.test.js`
- Modify: `src/panorama/PanoramaInputPolicy.js`
- Modify: `src/PanoramaApp.js`

**Interfaces:**
- Consumes: `selectDirectionalPanoramaPoint(...)` from Task 2.
- Produces: `PanoramaInputPolicy.handleKeyDown(event)` returns a browse command once for W/A/S/D and keeps continuous pressed-state commands in edit mode.
- Produces: `PanoramaApp.selectDirectionalPoint(direction)` returns a promise resolving to the result of `selectPoint` or `false`.

- [ ] **Step 1: Replace the browse-input expectation** with failing tests that W/A/S/D return one-shot commands, call `preventDefault`, ignore `event.repeat`, and leave arrow keys unhandled in browse mode.
- [ ] **Step 2: Add failing app tests** that set a live yaw, dispatch a browse W key through the registered keydown listener, and assert selection of the resolver's forward point; also assert no navigation while editing or when the app phase is not `ready`.
- [ ] **Step 3: Run** `node --test tests/panorama-input-policy.test.js tests/panorama-app-state.test.js` and verify browse navigation expectations fail.
- [ ] **Step 4: Update `PanoramaInputPolicy`** to distinguish browse one-shot WASD from edit continuous movement without adding browse arrow-key commands.
- [ ] **Step 5: Update `PanoramaApp._bindUi`** so the keydown result invokes `selectDirectionalPoint` only in `ready` browse mode.
- [ ] **Step 6: Implement `selectDirectionalPoint`** using the active point, valid stored points, and `sceneManager.getCameraPresetPose().yaw`, then delegate to `selectPoint`.
- [ ] **Step 7: Run** `node --test tests/panorama-directional-navigator.test.js tests/panorama-input-policy.test.js tests/panorama-app-state.test.js` and verify all navigation tests pass.
- [ ] **Step 8: Commit** with message `feat: navigate panorama points with wasd`.

### Task 4: Consolidate controls into the mini-map card

**Files:**
- Modify: `tests/panorama-minimap.test.js`
- Modify: `tests/panorama-page-contract.test.js`
- Modify: `tests/helpers/panorama-app-harness.js`
- Modify: `src/panorama/PanoramaMiniMap.js`
- Modify: `src/panorama/panorama.css`
- Modify: `src/PanoramaApp.js`
- Modify: `index-panorama.html`

**Interfaces:**
- Extends: `new PanoramaMiniMap(container, { onAdd, onRestoreAll, ...existingOptions })`.
- Removes from page contract: `panorama-point-panel`, `panorama-point-count`, `panorama-point-panel-toggle`, and `panorama-point-list`.
- Keeps: `PanoramaPointStore` persistence and point mutation methods.

- [ ] **Step 1: Add failing mini-map tests** asserting an action row contains `data-action="add-point"` and `data-action="restore-all"`, invokes both callbacks, and hides together with the stage when collapsed.
- [ ] **Step 2: Update the page-contract test first** to retain the mini-map container and reject the removed point-panel IDs; the component test from Step 1 owns the runtime action-button contract.
- [ ] **Step 3: Run** `node --test tests/panorama-minimap.test.js tests/panorama-page-contract.test.js` and verify the new assertions fail.
- [ ] **Step 4: Extend `PanoramaMiniMap`** to render the two-button footer, wire `onAdd` and `onRestoreAll`, and toggle the footer's `hidden` state alongside the stage.
- [ ] **Step 5: Remove the point panel from `index-panorama.html`** and keep no duplicate static add/restore buttons outside the mini-map.
- [ ] **Step 6: Remove `PanoramaPointList` construction, rendering, disposal, UI bindings, and unreachable page methods** from `PanoramaApp`; pass mini-map callbacks to `beginCreatePoint` and `restoreAllPoints`.
- [ ] **Step 7: Remove point-panel CSS** and add a compact two-column `.panorama-minimap-actions` footer that follows the existing Liquid Glass button treatment.
- [ ] **Step 8: Update the app harness required IDs** and any page contract assertions to match the new DOM.
- [ ] **Step 9: Run** `node --test tests/panorama-minimap.test.js tests/panorama-page-contract.test.js tests/panorama-app-state.test.js` and verify all UI tests pass.
- [ ] **Step 10: Commit** with message `refactor: consolidate panorama point controls`.

### Task 5: Full verification and browser QA

**Files:**
- Modify only if verification reveals a tested defect.

**Interfaces:**
- Consumes: the completed standalone panorama page.
- Produces: fresh automated, build, and browser evidence.

- [ ] **Step 1: Run** `npm.cmd test` and verify zero failures.
- [ ] **Step 2: Run** `npm.cmd run build:3d` and verify Vite exits with code 0.
- [ ] **Step 3: Open** `index-panorama.html?fixture=cameras&planId=spatial-qa&version=1#debug` in the in-app browser.
- [ ] **Step 4: Verify** the point-information panel is absent and the mini-map contains only the map plus “新增点位” and “恢复全部”.
- [ ] **Step 5: Rotate the camera, press each available WASD direction, and verify one smooth transition to a point in the requested current-view direction; verify held/repeated keys do not chain transitions.**
- [ ] **Step 6: Create or edit a camera point whose XY projection overlaps low furniture while its Z clearance does not, and verify placement/movement is accepted; lower it into the furniture Z range and verify `BLOCKED`.**
- [ ] **Step 7: Run** `git diff --check` and inspect `git status --short` so only intended `occt_demo` files remain.
