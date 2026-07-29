# Node Bridge String Parameters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the standalone Node bridge to forward bounded string parameter values so UE-derived `140302`, `140e02`, and `140f` resources can render in OCCT.

**Architecture:** Extend only the request-boundary validator in the existing Express backend. Preserve the `{ name, value }` array and forward accepted number/string values without coercion; keep every existing count, URL, response-size, timeout, and log-redaction boundary intact.

**Tech Stack:** Node.js ESM, Express, built-in `node:test`, OCCT Vite 3D preview.

## Global Constraints

- Modify `C:\Users\User\Desktop\parametric-lab\backend` only for the Node bridge implementation.
- Do not modify or deploy `C:\Users\User\Desktop\cad_plugin`.
- Parameter names remain non-empty strings of at most 128 UTF-8 bytes.
- Parameter values accept finite numbers or non-empty strings of at most 1024 UTF-8 bytes.
- Keep the maximum parameter count at 64 and preserve the existing `INVALID_ARGUMENT` envelope.
- Do not log parameter values or resource URLs.

---

### Task 1: Typed parameter request boundary

**Files:**
- Modify: `C:\Users\User\Desktop\parametric-lab\backend\test\content-api.test.js`
- Modify: `C:\Users\User\Desktop\parametric-lab\backend\app.js`

**Interfaces:**
- Consumes: `parseModelRequest(body)` and `POST /api/modelUrlToObj`.
- Produces: the same `{ url, parameters }` object, with each `value` preserved as a finite number or bounded string.

- [ ] **Step 1: Write the failing forwarding test**

Add representative option values beside the existing numeric value and assert the captured upstream body preserves them:

```js
parameters: [
  { name: 'length', value: 900 },
  { name: '挡板', value: '左侧挡板' },
  { name: '类型', value: '落地窗' },
],
```

- [ ] **Step 2: Tighten the invalid-value cases**

Replace the old invalid numeric-looking string case with empty and 1024-byte-overflow strings, boolean, object, array, and `null` cases:

```js
{ url: validUrl, parameters: [{ name: 'x', value: '' }] },
{ url: validUrl, parameters: [{ name: 'x', value: '界'.repeat(342) }] },
{ url: validUrl, parameters: [{ name: 'x', value: true }] },
{ url: validUrl, parameters: [{ name: 'x', value: {} }] },
{ url: validUrl, parameters: [{ name: 'x', value: [] }] },
{ url: validUrl, parameters: [{ name: 'x', value: null }] },
```

- [ ] **Step 3: Run focused tests and verify RED**

Run `node --test --test-name-pattern="model conversion forwards|model conversion rejects requests" test/content-api.test.js`.

Expected: forwarding fails with HTTP 400 because string values are not yet accepted.

- [ ] **Step 4: Implement the minimal value predicate**

```js
function isValidParameterValue(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string' && value.length > 0 &&
    Buffer.byteLength(value) <= 1024;
}
```

Use it inside `parseModelRequest` in place of the numeric-only check. Do not coerce values.

- [ ] **Step 5: Run focused and full backend tests**

Run the focused pattern above plus `non-finite`, then run `npm.cmd test`. Expected: all pass and invalid cases make no upstream call.

- [ ] **Step 6: Record the unversioned backend change**

The backend is not a Git repository. Preserve its exact changed-file list and test evidence in the final handoff; do not initialize or commit an unrelated repository.

### Task 2: Restart and endpoint verification

**Files:**
- Runtime only: Node process listening on `localhost:3100`.

**Interfaces:**
- Consumes: `POST /api/getContentGoodsDetails` and `POST /api/modelUrlToObj`.
- Produces: a successful conversion response for mixed number/string parameters.

- [ ] **Step 1: Resolve the current listener exactly**

Use `Get-NetTCPConnection -LocalPort 3100 -State Listen`, then confirm its process executable and command line before stopping that single PID.

- [ ] **Step 2: Restart the backend from its explicit directory**

Start `D:\app\node.exe server.js` with working directory `C:\Users\User\Desktop\parametric-lab\backend` and a hidden window.

- [ ] **Step 3: Verify the mixed-value endpoint**

Fetch resource `2476244`, then convert with numeric dimensions and `{ name: '类型', value: '落地窗' }`. Require HTTP 200 and an OBJ-bearing response; print no resource URL.

### Task 3: OCCT browser and regression verification

**Files:**
- Verify: `D:\occt_demo\.worktrees\cad-renderer-parametric-bridge`

**Interfaces:**
- Consumes: `?fixture=ue-specials#debug` and safe `[ContentLoader]` logs.
- Produces: one browser handoff tab with all combined fixture resources placed and no failure list.

- [ ] **Step 1: Rebuild the OCCT 3D bundle**

Run `npm.cmd run build:3d` in the isolated OCCT worktree.

- [ ] **Step 2: Load a fresh combined fixture tab**

Open `http://127.0.0.1:4179/index-3d.html?fixture=ue-specials&codex=typed-bridge-20260729#debug` and wait for its new loader summary.

- [ ] **Step 3: Verify real resource results**

Require no loader failure entry. Capture a screenshot and inspect the gallery for upright, non-collapsed models, including the arc railing composite.

- [ ] **Step 4: Run fresh OCCT regression checks**

Run `npm.cmd test`, `npm.cmd run build:3d`, `git diff --check`, and `git status --short`.

Expected: 209 pass, 8 CAD-environment skips, build succeeds, and no uncommitted OCCT source changes remain.
