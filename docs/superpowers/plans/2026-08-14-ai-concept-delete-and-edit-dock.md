# AI Concept Delete Confirmation and Edit Dock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every candidate-view delete action a confirmation and red danger hover state, while moving the editing controls to the bottom center and preserving the focused editing layout.

**Architecture:** Keep deletion semantics in `AiConceptApp.deleteView()`: confirmation occurs once before branching to automatic exclusion or custom deletion. Keep visual behavior in `ai-concept.css`, using the existing `data-action="delete"` contract and the existing `editing` visibility state.

**Tech Stack:** JavaScript ES modules, Node.js built-in test runner, CSS, Vite.

## Global Constraints

- Confirm deletion for both automatic and custom views.
- Cancellation must leave view state, active view, and thumbnail cache unchanged.
- Automatic views remain recoverable through exclusion; custom views remain deletable from the draft.
- Editing controls sit bottom-center at 18px on desktop and 12px on narrow screens.
- Filmstrip, view arrows, and generation conditions stay hidden during editing; minimap stays visible.
- Do not modify CAD Plugin.

---

### Task 1: Unified Delete Confirmation

**Files:**
- Modify: `src/AiConceptApp.js`
- Modify: `tests/helpers/ai-concept-app-harness.js`
- Test: `tests/ai-concept-app-state.test.js`

**Interfaces:**
- Consumes: `AiConceptApp.deleteView(id: string): Promise<boolean>`.
- Produces: one confirmation call for every available automatic or custom view before mutation.
- Preserves: automatic view `excludeView()` and custom view `store.deleteCustomView()` semantics.

- [ ] **Step 1: Make confirmation configurable in the harness**

Change the harness signature and confirmation boundary:

```js
export function createAiConceptHarness({
    loader,
    repository = null,
    captureDeferred = null,
    confirm = () => true,
} = {}) {
```

```js
confirm(message) {
    calls.push(['confirm', message]);
    return confirm(message);
},
```

- [ ] **Step 2: Write failing automatic-view confirmation tests**

Add to `tests/ai-concept-app-state.test.js`:

```js
test('automatic view deletion asks for confirmation before exclusion', async () => {
    const { app, calls } = createAiConceptHarness({ confirm: () => false });
    await app.init();
    const id = app.getState().activeViewId;

    assert.equal(await app.deleteView(id), false);
    assert.equal(app.getState().views.find(view => view.id === id).status, 'available');
    assert.equal(calls.filter(call => call[0] === 'confirm').length, 1);
});

test('confirmed automatic view deletion keeps recoverable exclusion semantics', async () => {
    const { app } = createAiConceptHarness();
    await app.init();
    const id = app.getState().activeViewId;

    assert.equal(await app.deleteView(id), true);
    assert.equal(app.getState().views.find(view => view.id === id).status, 'excluded');
    assert.equal(await app.restoreExcluded(), true);
    assert.equal(app.getState().views.find(view => view.id === id).status, 'available');
});
```

- [ ] **Step 3: Write failing custom-view cancellation test**

Add:

```js
test('custom view deletion asks for confirmation and cancellation preserves it', async () => {
    const { app, calls } = createAiConceptHarness({ confirm: () => false });
    await app.init();
    const custom = await app.addCustomView();
    app.cancelEdit();

    assert.equal(await app.deleteView(custom.id), false);
    assert.ok(app.getState().views.some(view => view.id === custom.id));
    assert.equal(calls.filter(call => call[0] === 'confirm').length, 1);
});
```

- [ ] **Step 4: Run focused state tests and verify RED**

Run:

```powershell
node --test tests/ai-concept-app-state.test.js
```

Expected: the automatic-view cancellation test FAILS because automatic views bypass confirmation and are immediately excluded.

- [ ] **Step 5: Move confirmation before the source branch**

Implement the minimal `deleteView()` ordering:

```js
async deleteView(id) {
    const view = this.store?.getState().views.find(candidate => candidate.id === id);
    if (!view || this.phase !== 'ready') return false;
    if (!this.window?.confirm?.(`确认删除“${view.name}”吗？`)) return false;
    if (view.source === 'auto') return this.excludeView(id);
    const changed = await this.store.deleteCustomView(id);
    // retain existing thumbnail invalidation and active-view transition
}
```

- [ ] **Step 6: Run state tests and verify GREEN**

Run:

```powershell
node --test tests/ai-concept-app-state.test.js
```

Expected: all state tests PASS.

- [ ] **Step 7: Commit deletion behavior**

```powershell
git add -- src/AiConceptApp.js tests/helpers/ai-concept-app-harness.js tests/ai-concept-app-state.test.js
git commit -m "feat: confirm AI view deletion"
```

---

### Task 2: Delete Danger State and Bottom Edit Dock

**Files:**
- Modify: `src/ai-concept/ai-concept.css`
- Test: `tests/ai-concept-page-contract.test.js`

**Interfaces:**
- Consumes: filmstrip button attribute `[data-action="delete"]`.
- Produces: red hover and `:focus-visible` danger styling.
- Produces: bottom-centered `.ai-concept-edit-controls` layout.

- [ ] **Step 1: Write failing CSS contract assertions**

Add to the CSS contract test:

```js
assert.match(css, /\[data-action="delete"\]:hover[^\{]*\{[\s\S]*?background:\s*rgba\(210,\s*53,\s*63,\s*0\.14\)/);
assert.match(css, /\[data-action="delete"\]:focus-visible[^\{]*\{[\s\S]*?background:\s*rgba\(210,\s*53,\s*63,\s*0\.14\)/);
assert.match(css, /\.ai-concept-edit-controls\s*\{[\s\S]*?left:\s*50%[\s\S]*?bottom:\s*18px[\s\S]*?transform:\s*translateX\(-50%\)/);
assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.ai-concept-edit-controls\s*\{[\s\S]*?left:\s*12px[\s\S]*?right:\s*12px[\s\S]*?bottom:\s*12px[\s\S]*?transform:\s*none/);
```

- [ ] **Step 2: Run the page-contract test and verify RED**

Run:

```powershell
node --test tests/ai-concept-page-contract.test.js
```

Expected: FAIL because delete danger selectors and bottom-centered edit dock are absent.

- [ ] **Step 3: Add the delete danger state**

Add CSS:

```css
.ai-view-card-toolbar [data-action="delete"]:hover:not(:disabled),
.ai-view-card-toolbar [data-action="delete"]:focus-visible {
    color: #b4232f;
    background: rgba(210, 53, 63, 0.14);
    box-shadow: 0 0 0 1px rgba(210, 53, 63, 0.12);
}
```

- [ ] **Step 4: Move the desktop and narrow edit dock**

Use:

```css
.ai-concept-edit-controls {
    position: absolute;
    left: 50%;
    right: auto;
    bottom: 18px;
    transform: translateX(-50%);
}
```

Within `@media (max-width: 760px)` override with:

```css
.ai-concept-edit-controls {
    left: 12px;
    right: 12px;
    bottom: 12px;
    transform: none;
    flex-wrap: wrap;
}
```

Retain existing z-index, flex alignment, gap, padding, border radius, and `[hidden]` behavior.

- [ ] **Step 5: Run the page-contract test and verify GREEN**

Run:

```powershell
node --test tests/ai-concept-page-contract.test.js
```

Expected: all page-contract tests PASS.

- [ ] **Step 6: Run full regression and production build**

Run:

```powershell
npm.cmd test
npm.cmd run build:3d
```

Expected: zero test failures and Vite exits with code 0.

- [ ] **Step 7: Verify browser behavior**

At `http://127.0.0.1:4182/index-ai-concept.html?planId=ai-delete-dock-qa&version=1#debug`, verify:

1. Hovering a trash button produces the red danger background.
2. Cancelling deletion leaves both automatic and custom views present.
3. Confirming deletion excludes an automatic view and deletes a custom view.
4. Entering edit mode places the edit controls at the bottom center.
5. Filmstrip, arrows, and generation conditions are hidden while editing; minimap remains visible.
6. Saving restores generation conditions and candidate controls.
7. Browser console contains no errors.

- [ ] **Step 8: Commit visual behavior**

```powershell
git add -- src/ai-concept/ai-concept.css tests/ai-concept-page-contract.test.js
git commit -m "style: refine AI delete and edit controls"
```
