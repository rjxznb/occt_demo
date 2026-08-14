# AI Concept Editing Focus Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide candidate-view browsing and generation-condition controls throughout every AI view editing session, then restore them after save or cancel.

**Architecture:** Keep `editing` as the single source of truth in `AiConceptApp._syncActions()`. Add a stable DOM id for the primary generation action container, collect it with the existing UI elements, and toggle the relevant elements' `hidden` properties without destroying the filmstrip or its cached thumbnails.

**Tech Stack:** JavaScript ES modules, Three.js application shell, Node.js built-in test runner, Vite.

## Global Constraints

- Apply the same focused layout to editing an existing view and adding a custom view.
- Keep the minimap and editing controls visible during editing.
- Preserve thumbnail cache, active view, and filmstrip scroll state.
- Restore candidate controls after both save and cancel.
- Do not modify CAD Plugin.

---

### Task 1: Editing Focus Visibility

**Files:**
- Modify: `index-ai-concept.html`
- Modify: `src/AiConceptApp.js`
- Modify: `tests/helpers/ai-concept-app-harness.js`
- Test: `tests/ai-concept-app-state.test.js`
- Test: `tests/ai-concept-page-contract.test.js`

**Interfaces:**
- Consumes: `AiConceptApp.phase`, where `editing` denotes an active existing-view or custom-view edit.
- Produces: collected UI element `this.ui.primaryActions` backed by `#ai-concept-primary-actions`.
- Produces: `_syncActions()` visibility contract for `filmstrip`, `previous`, `next`, and `primaryActions`.

- [ ] **Step 1: Write failing application-state tests**

Add a helper and two tests to `tests/ai-concept-app-state.test.js`:

```js
function focusVisibility(documentRef) {
    return Object.fromEntries([
        'ai-concept-filmstrip',
        'ai-concept-previous',
        'ai-concept-next',
        'ai-concept-primary-actions',
    ].map(id => [id, documentRef.getElementById(id).hidden]));
}

test('editing an existing view hides browsing and generation controls until cancel', async () => {
    const { app, documentRef } = createAiConceptHarness();
    await app.init();
    assert.deepEqual(focusVisibility(documentRef), {
        'ai-concept-filmstrip': false,
        'ai-concept-previous': false,
        'ai-concept-next': false,
        'ai-concept-primary-actions': false,
    });

    await app.enterEditMode();
    assert.ok(Object.values(focusVisibility(documentRef)).every(Boolean));

    app.cancelEdit();
    assert.ok(Object.values(focusVisibility(documentRef)).every(hidden => hidden === false));
});

test('adding a custom view hides browsing and generation controls until save', async () => {
    const { app, documentRef } = createAiConceptHarness();
    await app.init();

    await app.addCustomView();
    assert.ok(Object.values(focusVisibility(documentRef)).every(Boolean));

    await app.saveEdit();
    assert.ok(Object.values(focusVisibility(documentRef)).every(hidden => hidden === false));
});
```

- [ ] **Step 2: Extend the page-contract test first**

Add `ai-concept-primary-actions` to the required id list in `tests/ai-concept-page-contract.test.js`, and add the same id to `REQUIRED_IDS` in `tests/helpers/ai-concept-app-harness.js` so the state tests exercise a real collected element.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```powershell
node --test tests/ai-concept-app-state.test.js tests/ai-concept-page-contract.test.js
```

Expected: FAIL because `#ai-concept-primary-actions` is not present in the page and `_syncActions()` does not hide the candidate controls.

- [ ] **Step 4: Add the stable primary-actions contract**

In `index-ai-concept.html`, change the primary action section to:

```html
<section id="ai-concept-primary-actions" class="ai-glass ai-concept-primary-actions"
    aria-label="生图条件操作">
```

Add `ai-concept-primary-actions` to `AiConceptApp._collectUi()` so it becomes `this.ui.primaryActions`.

- [ ] **Step 5: Implement minimal phase-driven visibility**

Extend `AiConceptApp._syncActions()` with:

```js
if (this.ui.filmstrip) this.ui.filmstrip.hidden = editing;
if (this.ui.previous) this.ui.previous.hidden = editing;
if (this.ui.next) this.ui.next.hidden = editing;
if (this.ui.primaryActions) this.ui.primaryActions.hidden = editing;
```

Keep the existing disabled-state, edit-controls, camera-interaction, and CSS-class logic unchanged.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```powershell
node --test tests/ai-concept-app-state.test.js tests/ai-concept-page-contract.test.js
```

Expected: all focused tests PASS.

- [ ] **Step 7: Run the full regression suite and production build**

Run:

```powershell
npm.cmd test
npm.cmd run build:3d
```

Expected: test suite exits with zero failures and Vite production build exits with code 0.

- [ ] **Step 8: Verify the page interaction**

Open `http://127.0.0.1:4182/index-ai-concept.html?planId=ai-edit-focus-qa&version=1#debug` and verify:

1. Ready mode shows filmstrip, arrows, minimap, and generation-condition action.
2. Existing-view “微调” hides filmstrip, arrows, and generation-condition action while keeping minimap and edit controls visible.
3. Cancel restores all hidden controls.
4. “添加自定义视角” produces the same focused state.
5. Save restores all hidden controls.
6. Browser console contains no errors.

- [ ] **Step 9: Commit**

```powershell
git add -- index-ai-concept.html src/AiConceptApp.js tests/helpers/ai-concept-app-harness.js tests/ai-concept-app-state.test.js tests/ai-concept-page-contract.test.js
git commit -m "feat: focus AI view editing"
```
