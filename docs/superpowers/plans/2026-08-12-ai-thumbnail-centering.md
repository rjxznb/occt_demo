# AI Thumbnail Centering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the active AI candidate thumbnail centered in its horizontal viewport whenever possible, while clamping the first and last candidates to the scroll boundaries.

**Architecture:** `AiViewFilmstrip` remains the single owner of thumbnail scrolling. It will calculate the selected card's center relative to `.ai-view-track`, clamp the desired `scrollLeft`, and call the track's smooth `scrollTo`; every activation source already converges on `AiConceptApp.selectView()` and therefore reuses this behavior.

**Tech Stack:** JavaScript ES modules, DOM geometry APIs, Node.js built-in test runner, Vite.

## Global Constraints

- Work only in `D:\occt_demo\.worktrees\panorama-white-model-page`; do not modify CAD Plugin.
- Do not add CSS scroll snapping or new runtime dependencies.
- Preserve user-controlled horizontal scrolling.
- Use smooth scrolling for programmatic selection.
- Clamp programmatic scrolling to `0 <= left <= scrollWidth - clientWidth`.

---

### Task 1: Explicit Filmstrip Centering

**Files:**
- Modify: `tests/helpers/fake-dom.js`
- Modify: `tests/ai-view-filmstrip.test.js`
- Modify: `src/ai-concept/AiViewFilmstrip.js`

**Interfaces:**
- Consumes: rendered `.ai-view-track`, a card with `data-view-id`, DOM `getBoundingClientRect()`, `scrollLeft`, `scrollWidth`, and `clientWidth`.
- Produces: `AiViewFilmstrip.scrollViewIntoView(viewId): void`, which scrolls the track smoothly to a clamped horizontal position.

- [ ] **Step 1: Extend the fake DOM with observable scrolling**

Add the following state to `FakeElement`'s constructor:

```js
this.scrollLeft = 0;
this.scrollWidth = 0;
this.clientWidth = 0;
this.scrollToOptions = null;
```

Add this method beside `scrollIntoView()`:

```js
scrollTo(options) {
    this.scrollToOptions = options;
    if (Number.isFinite(options?.left)) this.scrollLeft = options.left;
}
```

- [ ] **Step 2: Write failing centering and boundary tests**

Append a helper and three tests to `tests/ai-view-filmstrip.test.js`:

```js
function createScrollableFilmstrip() {
    const container = new FakeElement('section');
    const filmstrip = new AiViewFilmstrip(container, { documentRef: new FakeDocument() });
    filmstrip.render({ views, activeViewId: 'living-entry' });
    const track = container.children[0];
    track.rect = { left: 100, top: 0, width: 600, height: 150 };
    track.clientWidth = 600;
    track.scrollWidth = 1400;
    track.scrollLeft = 200;
    return { container, filmstrip, track };
}

test('centers an interior selected card in the filmstrip viewport', () => {
    const { container, filmstrip, track } = createScrollableFilmstrip();
    const card = findByDataset(container, 'viewId', 'bedroom-corner');
    card.rect = { left: 620, top: 0, width: 180, height: 130 };

    filmstrip.scrollViewIntoView('bedroom-corner');

    assert.deepEqual(track.scrollToOptions, { left: 510, behavior: 'smooth' });
});

test('clamps a selected card at the leading scroll boundary', () => {
    const { container, filmstrip, track } = createScrollableFilmstrip();
    const card = findByDataset(container, 'viewId', 'living-entry');
    card.rect = { left: -180, top: 0, width: 180, height: 130 };

    filmstrip.scrollViewIntoView('living-entry');

    assert.equal(track.scrollToOptions.left, 0);
});

test('clamps a selected card at the trailing scroll boundary', () => {
    const { container, filmstrip, track } = createScrollableFilmstrip();
    const card = findByDataset(container, 'viewId', 'bedroom-corner');
    card.rect = { left: 1220, top: 0, width: 180, height: 130 };

    filmstrip.scrollViewIntoView('bedroom-corner');

    assert.equal(track.scrollToOptions.left, 800);
});
```

- [ ] **Step 3: Run the focused test and verify failure**

Run:

```powershell
node --test tests/ai-view-filmstrip.test.js
```

Expected: the three new tests fail because the implementation still calls `card.scrollIntoView()` and never sets `track.scrollToOptions`.

- [ ] **Step 4: Replace element scrolling with explicit track geometry**

Replace `scrollViewIntoView()` in `src/ai-concept/AiViewFilmstrip.js` with:

```js
scrollViewIntoView(viewId) {
    const track = Array.from(this.container?.children ?? [])
        .find(element => element.classList?.contains('ai-view-track'));
    if (!track) return;

    const card = Array.from(track.children ?? [])
        .flatMap(child => child.children ?? [])
        .flatMap(child => child.children ?? [])
        .find(element => element.dataset?.viewId === viewId);
    if (!card || typeof track.scrollTo !== 'function') return;

    const trackRect = track.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const currentLeft = Number(track.scrollLeft) || 0;
    const centeredLeft = currentLeft
        + cardRect.left + cardRect.width / 2
        - (trackRect.left + trackRect.width / 2);
    const maximumLeft = Math.max(0, (Number(track.scrollWidth) || 0) - (Number(track.clientWidth) || trackRect.width));
    const left = Math.min(maximumLeft, Math.max(0, centeredLeft));

    track.scrollTo({ left, behavior: 'smooth' });
}
```

- [ ] **Step 5: Run the focused tests and verify success**

Run:

```powershell
node --test tests/ai-view-filmstrip.test.js
```

Expected: all filmstrip tests pass.

- [ ] **Step 6: Update the existing app-level assertion**

In `tests/ai-concept-app-startup.test.js`, update the mini-map selection test to retrieve `.ai-view-track` and assert:

```js
const track = descendants(filmstrip)
    .find(element => element.classList.contains('ai-view-track'));
assert.equal(track.scrollToOptions?.behavior, 'smooth');
```

Remove the obsolete assertion against `card.scrollIntoViewOptions`.

- [ ] **Step 7: Run the application and filmstrip tests**

Run:

```powershell
node --test tests/ai-view-filmstrip.test.js tests/ai-concept-app-startup.test.js
```

Expected: all selected tests pass, including activation from the mini-map through `AiConceptApp.selectView()`.

- [ ] **Step 8: Commit the tested implementation**

```powershell
git add tests/helpers/fake-dom.js tests/ai-view-filmstrip.test.js tests/ai-concept-app-startup.test.js src/ai-concept/AiViewFilmstrip.js
git commit -m "fix: center selected AI thumbnail"
```

---

### Task 2: Regression and Browser Verification

**Files:**
- Verify: `src/AiConceptApp.js`
- Verify: `src/ai-concept/AiViewFilmstrip.js`
- Verify: `dist-3d/index-ai-concept.html`

**Interfaces:**
- Consumes: `AiConceptApp.selectView(id)` from thumbnail, mini-map, and relative navigation handlers.
- Produces: verified production build and browser behavior with no additional source changes unless a regression is found.

- [ ] **Step 1: Run the full automated suite**

Run:

```powershell
npm test
```

Expected: all runnable tests pass; only the existing CAD environment-gated tests may remain skipped.

- [ ] **Step 2: Build the 3D/AI pages**

Run:

```powershell
npm run build:3d
```

Expected: Vite completes successfully and emits `dist-3d/index-ai-concept.html`.

- [ ] **Step 3: Verify selection behavior in the browser**

Open:

```text
http://127.0.0.1:4182/index-ai-concept.html?planId=ai-thumbnails-qa&version=1#debug
```

Verify all of the following:

1. Clicking a middle thumbnail smoothly places it at the horizontal center.
2. Clicking a mini-map point applies the same centering behavior.
3. Previous/next navigation applies the same centering behavior.
4. The first and last candidates stop at the track boundaries without blank margins.
5. Manual horizontal scrolling still works and the console has no new errors.

- [ ] **Step 4: Record verification evidence**

Capture the test totals, build result, tested URL, and observed first/middle/last scroll positions in the final handoff. Do not claim completion if any required browser behavior differs from the design.
