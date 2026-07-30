# Liquid Glass Controls and Clean Scene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved compact Liquid Glass right-side controls and verify the normal Drawing2 scene without synthetic TypeId fixtures.

**Architecture:** Keep the existing HTML structure, element IDs, and JavaScript bindings. Replace only the `#controls`-scoped CSS and its button variants in `index-3d.html`, using pseudo-elements for non-interactive highlights and a solid fallback for browsers without backdrop-filter. Synthetic fixture code remains isolated behind exact query parameters; the final browser verification uses a URL without `fixture`.

**Tech Stack:** HTML5, CSS, Vite 6, Node.js test runner, Three.js viewer, in-app browser verification.

## Global Constraints

- Work only in `D:\occt_demo\.worktrees\cad-renderer-parametric-bridge`.
- Do not modify, deploy, stage, or commit `C:\Users\User\Desktop\cad_plugin`.
- The desktop `#controls` width is exactly `154px`.
- Existing control IDs, DOM structure, JavaScript event bindings, and behavior remain unchanged.
- The resource sidebar information architecture remains unchanged.
- `src/dev/SceneFixtures.js` and its tests remain available; fixtures are opt-in only.
- The final verification URL must not contain a `fixture` query parameter.

---

### Task 1: Compact Liquid Glass control surface

**Files:**
- Modify: `index-3d.html:96-153`
- Modify: `index-3d.html:447-506`
- Create: `tests/3d-viewer-liquid-glass-style.test.js`

**Interfaces:**
- Consumes: the existing `#controls`, `.viewer-status-row`, `.control-group`, `.control-label`, `.mode-view`, `.primary-action-grid`, `.resource-btn`, `.template-btn`, `.view-angle-grid`, and `.view-angle-btn` DOM classes.
- Produces: the same interactive DOM with a 154px light Liquid Glass surface; no JavaScript API changes.

- [ ] **Step 1: Write the failing style contract test**

Create `tests/3d-viewer-liquid-glass-style.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const htmlUrl = new URL('../index-3d.html', import.meta.url);

test('3D controls use the approved compact Liquid Glass surface', async () => {
    const html = await readFile(htmlUrl, 'utf8');
    const controls = html.match(/#controls\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? '';

    assert.match(controls, /width:\s*154px/);
    assert.match(controls, /backdrop-filter:\s*blur\(28px\)\s+saturate\(175%\)\s+contrast\(106%\)/);
    assert.match(controls, /border-radius:\s*22px/);
    assert.match(html, /#controls::before\s*\{/);
    assert.match(html, /#controls::after\s*\{/);
    assert.match(html, /@supports\s+not\s+\(backdrop-filter:\s*blur\(1px\)\)/);
    assert.match(html, /#controls\s*>\s*\*\s*\{[\s\S]*?position:\s*relative;[\s\S]*?z-index:\s*1;/);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --test tests/3d-viewer-liquid-glass-style.test.js
```

Expected: FAIL because the current `#controls` width is `208px` and it lacks the approved layered Liquid Glass declarations.

- [ ] **Step 3: Implement the minimal Liquid Glass CSS**

In `index-3d.html`, replace the current `#controls` rule with:

```css
#controls {
    position: fixed;
    isolation: isolate;
    overflow: hidden;
    top: 18px;
    right: 18px;
    width: 154px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    color: #1d1d1f;
    background:
        linear-gradient(145deg, rgba(255, 255, 255, 0.60),
            rgba(241, 247, 252, 0.34) 46%, rgba(255, 255, 255, 0.52));
    padding: 10px;
    border-radius: 22px;
    backdrop-filter: blur(28px) saturate(175%) contrast(106%);
    -webkit-backdrop-filter: blur(28px) saturate(175%) contrast(106%);
    border: 1px solid rgba(255, 255, 255, 0.82);
    box-shadow:
        0 18px 42px rgba(38, 54, 68, 0.18),
        inset 0 1px 0 rgba(255, 255, 255, 0.90),
        inset 1px 0 0 rgba(255, 255, 255, 0.38);
    z-index: 1000;
}

#controls::before,
#controls::after {
    content: '';
    position: absolute;
    pointer-events: none;
    border-radius: inherit;
}

#controls::before {
    inset: 0;
    background:
        radial-gradient(130px 70px at 22% -4%, rgba(255, 255, 255, 0.90), transparent 64%),
        linear-gradient(115deg, rgba(255, 255, 255, 0.34), transparent 35% 70%,
            rgba(116, 191, 255, 0.14));
    mix-blend-mode: screen;
}

#controls::after {
    inset: 1px;
    box-shadow:
        inset 0 -1px 0 rgba(74, 105, 130, 0.12),
        inset -1px 0 0 rgba(96, 159, 211, 0.10);
}

#controls > * {
    position: relative;
    z-index: 1;
}

@supports not (backdrop-filter: blur(1px)) {
    #controls {
        background: rgba(246, 249, 252, 0.96);
    }
}
```

Then update only `#controls` descendants and existing button variant rules:

```css
.viewer-status-row { display: grid; gap: 5px; }
.control-group { display: flex; flex-direction: column; gap: 5px; }
.control-label { color: rgba(29, 29, 31, 0.52); font-size: 10px; font-weight: 650; }
#controls button { padding: 7px 5px; color: #1d1d1f; background: rgba(255,255,255,.28);
    border: 1px solid rgba(255,255,255,.60); border-radius: 11px; font-size: 11px;
    font-weight: 600; box-shadow: inset 0 1px 0 rgba(255,255,255,.55),
    0 2px 7px rgba(30,50,70,.06); }
#controls button:hover { transform: scale(1.025); background: rgba(255,255,255,.46); }
#controls button:focus-visible { outline: 2px solid #0a84ff; outline-offset: 2px; }
.mode-view { color: #fff !important; background: linear-gradient(180deg,
    rgba(20,135,255,.91), rgba(0,105,235,.88)) !important;
    border-color: rgba(0,122,255,.34) !important; }
.resource-btn, .template-btn { color: #1d1d1f !important;
    background: rgba(255,255,255,.28) !important;
    border-color: rgba(255,255,255,.60) !important; }
.resource-btn:hover, .template-btn:hover { background: rgba(255,255,255,.46) !important; }
.primary-action-grid { gap: 5px; }
.primary-action-grid button { min-height: 34px; padding: 6px 3px; font-size: 10px; }
.view-angle-grid { gap: 5px; }
.view-angle-btn { padding: 6px 0; font-size: 10px; }
```

Retain `#fps-counter` and `#auto-rotation-status` IDs, changing only their colors, padding, radius, and type sizes to fit the light panel. Use `#30d158` for the enabled rotation indicator and `#ff9f0a` for the rotating state.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
node --test tests/3d-viewer-liquid-glass-style.test.js
```

Expected: PASS.

- [ ] **Step 5: Run regression tests and build**

Run:

```powershell
npm.cmd test
npm.cmd run build:3d
git diff --check
```

Expected: all non-CAD tests pass, CAD-path tests remain explicitly skipped without their environment variables, the Vite build exits `0`, and `git diff --check` prints no errors.

- [ ] **Step 6: Commit the UI task**

```powershell
git add -- index-3d.html tests/3d-viewer-liquid-glass-style.test.js
git commit -m "style: apply liquid glass viewer controls"
```

### Task 2: Verify the clean Drawing2 scene

**Files:**
- Verify: `src/core/DataSource.js`
- Verify: `src/dev/SceneFixtures.js`
- Verify: `tests/scene-fixtures.test.js`
- Verify: `tests/remaining-typeid-fixtures.test.js`

**Interfaces:**
- Consumes: `withSceneFixture(source, search)` exact fixture-query behavior.
- Produces: a user-facing browser tab at the clean Drawing2 URL with no synthetic TypeId objects.

- [ ] **Step 1: Re-run fixture isolation tests**

Run:

```powershell
node --test tests/scene-fixtures.test.js tests/remaining-typeid-fixtures.test.js
```

Expected: PASS, proving unsupported or absent fixture values do not inject test models and exact fixture values remain available for regression work.

- [ ] **Step 2: Open the clean URL after the new build**

Navigate the existing in-app browser tab to:

```text
http://127.0.0.1:4179/index-3d.html?codex=liquid-glass-implemented-20260730#debug
```

Do not append `fixture=ue-specials` or any other fixture value.

- [ ] **Step 3: Inspect computed UI and scene state**

Verify with browser DOM/computed-style inspection:

- `#controls` computed width is `154px`;
- its computed border radius is `22px`;
- `backdrop-filter` or `-webkit-backdrop-filter` includes `blur(28px)`;
- the four quick-view buttons remain present;
- the URL contains no `fixture` parameter;
- no model-loading error or material-metadata warning appears in the page console.

- [ ] **Step 4: Visually verify the final page**

Capture the viewport and confirm the controls match the approved light Liquid Glass direction, remain readable, do not cover important room content, and the visible scene contains only the bundled Drawing2 objects.

- [ ] **Step 5: Record final repository state**

Run:

```powershell
git status --short
git log -3 --oneline
```

Expected: the Liquid Glass implementation commit is present; any unrelated pre-existing glass-material work remains unstaged unless separately approved.
