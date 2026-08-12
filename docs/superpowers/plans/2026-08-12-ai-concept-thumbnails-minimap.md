# AI Concept Thumbnails and Mini-map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show real white-model images for every AI candidate view, display all rooms by default, and add a read-only mini-map linked to the active view.

**Architecture:** A focused `AiViewThumbnailCapture` service will reuse the live Three.js scene and renderer with an offscreen render target and a private camera. `AiConceptApp` will own thumbnail queueing and lifecycle, while `AiViewFilmstrip` and a new `AiViewMiniMap` remain DOM-only views driven by Store state plus derived thumbnail state.

**Tech Stack:** JavaScript ES modules, Three.js, WebGLRenderTarget, Node test runner, Vite, existing fake DOM test helpers.

## Global Constraints

- Modify only `occt_demo`; do not modify CAD Plugin.
- Do not create a second WebGL renderer or WebGL context.
- Do not move or replace the visible main camera while capturing thumbnails.
- Thumbnails are session-derived data and must not be persisted in `AiViewRepository` or LocalStorage.
- Default filmstrip content includes every available room and candidate view.
- Mini-map is read-only, has no direction lines, and has no point editing actions.
- A failed thumbnail must not block browsing, selection, editing, or the next step.
- Follow test-driven development: observe the intended test fail before adding production behavior.

---

### Task 1: Render all rooms and thumbnail states in the filmstrip

**Files:**
- Modify: `src/ai-concept/AiViewFilmstrip.js`
- Modify: `tests/ai-view-filmstrip.test.js`

**Interfaces:**
- Consumes: `render({ views, activeViewId, thumbnails })`, where `thumbnails` is a `Map<string, { status: 'loading'|'ready'|'error', url?: string }>`.
- Produces: all-room grouped cards, `data-thumbnail-state`, real `<img>` nodes, retry callbacks, and `scrollViewIntoView(viewId)`.

- [ ] **Step 1: Write failing tests for all-room grouping and thumbnail states**

Add tests that render two rooms while `activeRoomId` points at only one room, then assert both room groups and both cards exist. Supply one ready thumbnail and one failed thumbnail:

```js
const thumbnails = new Map([
  ['living-entry', { status: 'ready', url: 'blob:living' }],
  ['bedroom-corner', { status: 'error' }],
]);
filmstrip.render({ views, activeViewId: 'living-entry', thumbnails });
assert.ok(findByDataset(container, 'roomGroupId', 'room-0'));
assert.ok(findByDataset(container, 'roomGroupId', 'room-1'));
assert.equal(findByDataset(container, 'viewId', 'living-entry').dataset.thumbnailState, 'ready');
assert.equal(findByDataset(container, 'viewId', 'bedroom-corner').dataset.thumbnailState, 'error');
```

Also assert the retry button calls `onRetryThumbnail(view.id)` and the old room-filter event is no longer required.

- [ ] **Step 2: Run the filmstrip test and verify RED**

Run: `node --test tests/ai-view-filmstrip.test.js`

Expected: FAIL because room filtering still hides the second room and thumbnail nodes/states do not exist.

- [ ] **Step 3: Implement grouped rendering and image states**

Replace room tabs plus filtered track with ordered groups:

```js
render({ views = [], activeViewId = null, thumbnails = new Map() } = {}) {
  const visible = views.filter(view => !['excluded', 'disabled'].includes(view.status));
  const grouped = groupViewsByRoom(visible);
  const track = this._element('div', 'ai-view-track');
  for (const group of grouped) track.appendChild(this._roomGroup(group, activeViewId, thumbnails));
  track.appendChild(this._addCard());
  this.container.replaceChildren(track, this._footer(views));
}
```

For a ready thumbnail create an `<img loading="lazy" decoding="async">`; for loading/error create accessible placeholders. Add `scrollViewIntoView(viewId)` that calls `scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })` when supported.

- [ ] **Step 4: Run the filmstrip tests and verify GREEN**

Run: `node --test tests/ai-view-filmstrip.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/ai-concept/AiViewFilmstrip.js tests/ai-view-filmstrip.test.js
git commit -m "feat: show all AI candidate views"
```

### Task 2: Add the read-only AI view mini-map

**Files:**
- Create: `src/ai-concept/AiViewMiniMap.js`
- Create: `tests/ai-view-minimap.test.js`

**Interfaces:**
- Consumes: `render({ roomPoints, views, activeViewId })`.
- Produces: room SVG polygons, candidate point buttons, active styling, and `onSelect(viewId)`.
- Reuses: `calculateMiniMapLayout(roomPoints, views, padding)` from `src/components/CameraPresetMap.js`.

- [ ] **Step 1: Write the failing mini-map test**

```js
const map = new AiViewMiniMap(container, {
  documentRef,
  onSelect: id => calls.push(id),
});
map.render({ roomPoints, views, activeViewId: 'view-b' });
assert.equal(descendants(container).filter(node => node.tagName === 'POLYGON').length, 2);
assert.equal(findByDataset(container, 'viewId', 'view-b').classList.contains('is-active'), true);
assert.equal(descendants(container).some(node => node.classList.contains('camera-map-direction')), false);
findByDataset(container, 'viewId', 'view-a').click();
assert.deepEqual(calls, ['view-a']);
```

Add a case asserting excluded/disabled views are omitted and an empty layout hides the container.

- [ ] **Step 2: Run the mini-map test and verify RED**

Run: `node --test tests/ai-view-minimap.test.js`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `AiViewMiniMap`**

Create SVG room polygons and absolutely positioned point buttons. Each marker uses `layout.toPercent(view.x, view.y)`, sets `data-view-id`, `aria-pressed`, and calls `onSelect(view.id)`. Do not create direction children or edit controls.

- [ ] **Step 4: Run the mini-map test and verify GREEN**

Run: `node --test tests/ai-view-minimap.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/ai-concept/AiViewMiniMap.js tests/ai-view-minimap.test.js
git commit -m "feat: add AI candidate mini-map"
```

### Task 3: Build deterministic offscreen thumbnail capture

**Files:**
- Create: `src/ai-concept/AiViewThumbnailCapture.js`
- Create: `tests/ai-view-thumbnail-capture.test.js`

**Interfaces:**
- Constructor: `new AiViewThumbnailCapture({ scene, renderer, width = 320, height = 180, canvasFactory, urlApi })`.
- Method: `capture(view): Promise<{ status: 'ready', url: string, cacheKey: string }>`.
- Method: `invalidate(viewId): void`.
- Method: `dispose(): void`.

- [ ] **Step 1: Write failing tests for pose, cache, serialization, restoration, and disposal**

Use a recording renderer and injected canvas/url API. Assert:

```js
const first = capture.capture(viewA);
const second = capture.capture(viewB);
assert.equal(renderer.maxConcurrentRenders, 1);
assert.equal((await capture.capture(viewA)).url, (await first).url);
assert.equal(renderer.getRenderTarget(), originalTarget);
assert.equal(renderer.getViewport(savedViewport), savedViewport);
capture.invalidate(viewA.id);
assert.notEqual((await capture.capture({ ...viewA, x: viewA.x + 50 })).url, firstUrl);
capture.dispose();
assert.ok(revokedUrls.includes(firstUrl));
```

Assert the private camera position, Z-up vector, direction from yaw/pitch, aspect `16 / 9`, and vertical FOV conversion match project helpers.

- [ ] **Step 2: Run the capture test and verify RED**

Run: `node --test tests/ai-view-thumbnail-capture.test.js`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the minimal capture service**

Use `THREE.PerspectiveCamera`, `THREE.WebGLRenderTarget`, `horizontalToVerticalFov`, a promise tail for serialization, and a normalized pose cache key:

```js
capture(view) {
  const key = thumbnailCacheKey(view);
  if (this.cache.get(view.id)?.key === key) return Promise.resolve(this.cache.get(view.id).result);
  const job = this.tail.then(() => this._captureNow(view, key));
  this.tail = job.catch(() => {});
  return job;
}
```

In `_captureNow`, save and restore render target, viewport, scissor, scissor test, clear color and alpha in `try/finally`. Read render-target pixels, vertically flip rows into ImageData, encode through an injected canvas, then create an object URL. Dispose the render target and revoke URLs in `dispose()`.

- [ ] **Step 4: Run the capture test and verify GREEN**

Run: `node --test tests/ai-view-thumbnail-capture.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/ai-concept/AiViewThumbnailCapture.js tests/ai-view-thumbnail-capture.test.js
git commit -m "feat: capture AI view thumbnails offscreen"
```

### Task 4: Integrate thumbnails and mini-map into `AiConceptApp`

**Files:**
- Modify: `src/AiConceptApp.js`
- Modify: `tests/helpers/ai-concept-app-harness.js`
- Modify: `tests/ai-concept-app-startup.test.js`
- Modify: `tests/ai-concept-app-state.test.js`

**Interfaces:**
- Add injectable factories `miniMapFactory(container, options)` and `thumbnailCaptureFactory(options)`.
- App-owned state: `thumbnailStates: Map<viewId, state>` and one generation token used to ignore stale async results.

- [ ] **Step 1: Write failing startup and state tests**

Assert initialization creates the capture service from `sceneManager.getScene()` and `getRenderer()`, renders all views into both components, and starts captures without delaying ready state. Assert selecting a map point calls `selectView`, then calls `filmstrip.scrollViewIntoView(id)`.

Add edit-save coverage:

```js
await app.enterEditMode(activeId);
app.nudgeHeight(50);
await app.saveEdit();
assert.deepEqual(captureCalls.filter(call => call[0] === 'invalidate'), [['invalidate', activeId]]);
assert.ok(captureCalls.some(call => call[0] === 'capture' && call[1] === activeId));
```

Assert cancellation performs neither invalidation nor recapture, and `dispose()` disposes both capture and mini-map.

- [ ] **Step 2: Run app tests and verify RED**

Run: `node --test tests/ai-concept-app-startup.test.js tests/ai-concept-app-state.test.js`

Expected: FAIL because factories, mini-map rendering, and thumbnail lifecycle do not exist.

- [ ] **Step 3: Implement app orchestration**

Collect `ai-concept-minimap`, create both components after the scene manager exists, and call:

```js
this.thumbnailCapture = this.thumbnailCaptureFactory({
  scene: this.sceneManager.getScene(),
  renderer: this.sceneManager.getRenderer(),
});
this._queueMissingThumbnails(this.store.getState().views);
```

Set each view state to loading before capture, then ready/error afterward and call `_renderState()`. Guard async completion with `runtimeGeneration`. Pass `thumbnailStates` to the filmstrip and render the mini-map from `this.rooms.roomPoints` and Store views. After `saveEdit()`, invalidate and enqueue only the saved view. Selecting a view scrolls its card into view. Dispose both components and revoke captures in `_destroyRuntime()`.

- [ ] **Step 4: Run app tests and verify GREEN**

Run: `node --test tests/ai-concept-app-startup.test.js tests/ai-concept-app-state.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/AiConceptApp.js tests/helpers/ai-concept-app-harness.js tests/ai-concept-app-startup.test.js tests/ai-concept-app-state.test.js
git commit -m "feat: orchestrate AI thumbnail previews"
```

### Task 5: Add page structure and polished layout

**Files:**
- Modify: `index-ai-concept.html`
- Modify: `src/ai-concept/ai-concept.css`
- Modify: `tests/ai-concept-page-contract.test.js`

**Interfaces:**
- Adds required element `#ai-concept-minimap`.
- Defines `.ai-view-room-group`, `.ai-view-thumbnail`, loading/error states, and `.ai-view-minimap` styles.

- [ ] **Step 1: Write failing page/CSS contract tests**

Require the mini-map ID and CSS rules for a right-top fixed map, grouped all-room track, 16:9 images, loading shimmer, failed state, active markers, responsive layout, focus-visible, and reduced-motion fallback. Assert CSS contains no direction-line selector in the AI mini-map block.

- [ ] **Step 2: Run contract tests and verify RED**

Run: `node --test tests/ai-concept-page-contract.test.js`

Expected: FAIL because the mini-map and new styles are absent.

- [ ] **Step 3: Implement HTML and CSS**

Add:

```html
<aside id="ai-concept-minimap" class="ai-glass ai-view-minimap"
  aria-label="候选视角小地图" hidden></aside>
```

Style it at the right-top with the existing light Liquid Glass tokens. Make the filmstrip horizontally scrollable with room groups kept together; thumbnail image wrappers use `aspect-ratio: 16 / 9`, `object-fit: cover`, and a non-black white-model placeholder.

- [ ] **Step 4: Run contract tests and verify GREEN**

Run: `node --test tests/ai-concept-page-contract.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add index-ai-concept.html src/ai-concept/ai-concept.css tests/ai-concept-page-contract.test.js
git commit -m "style: present AI thumbnails and mini-map"
```

### Task 6: Real drawing regression and browser verification

**Files:**
- Modify: `tests/ai-concept-real-drawing.test.js`
- Modify: `README.md`

**Interfaces:**
- Verifies all generated `Drawing2.json` room candidates can be grouped and mapped with finite capture poses.
- Documents the AI page's all-room thumbnails and mini-map.

- [ ] **Step 1: Add a failing real-data contract assertion**

Extend the real drawing test to assert every visible candidate has a finite capture pose and that all room IDs represented by candidates remain represented when no active-room filter is applied.

- [ ] **Step 2: Run the focused feature suite**

Run:

```powershell
node --test tests/ai-view-filmstrip.test.js tests/ai-view-minimap.test.js tests/ai-view-thumbnail-capture.test.js tests/ai-concept-app-startup.test.js tests/ai-concept-app-state.test.js tests/ai-concept-page-contract.test.js tests/ai-concept-real-drawing.test.js
```

Expected: PASS after Tasks 1-5; if the new real-data assertion exposes an integration gap, fix only that gap and rerun.

- [ ] **Step 3: Update README**

Document that `index-ai-concept.html` renders all-room candidate thumbnails lazily in-session and exposes a linked read-only mini-map. Do not document any server or CAD requirement.

- [ ] **Step 4: Run full verification**

Run:

```powershell
npm.cmd test
npm.cmd run build:3d
```

Expected: zero failures; only the repository's existing environment-gated CAD tests may skip; `dist-3d/index-ai-concept.html` must be produced.

- [ ] **Step 5: Browser QA**

Open the independent page with `Drawing2.json`. Verify all rooms are present at once, thumbnails progressively become real white-model images, main view/card/map selection remains synchronized, editing save refreshes one thumbnail, cancellation does not refresh, main rendering does not flash, and console errors remain empty.

- [ ] **Step 6: Commit**

```powershell
git add tests/ai-concept-real-drawing.test.js README.md
git commit -m "test: verify AI thumbnail workbench"
```
