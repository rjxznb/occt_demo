# CAD WebView Safe Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan inline. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Identify the first failing stage before `getContentGoodsDetails` without exposing URLs, bodies, IDs, or arbitrary page text.

**Architecture:** WebView2 injects a fixed diagnostic emitter into outer and child documents and validates its fixed envelope natively. OCCT adds fixed stage hooks around data, content loading, and iframe RPC boundaries.

**Tech Stack:** C++17/ObjectARX, WebView2 COM, browser JavaScript, Node test runner, Vite.

## Global Constraints

- Diagnostic JSON length is at most 512 bytes.
- Only fixed channel/version and allowlisted stage/code values are accepted.
- No URL, response body, resource ID, exception message, or arbitrary text is logged.
- No remote DevTools and no fetch interception or rewriting.
- CAD changes remain unstaged and uncommitted.

---

### Task 1: Native WebView diagnostics

**Files:**
- Modify: `tests/cad-parametric-model-bridge-contract.test.js`
- Modify: `C:\Users\User\Desktop\cad_plugin\ui\window\browser\k_render_preview_browser.cpp`

**Interfaces:**
- Consumes: WebView2 `AddScriptToExecuteOnDocumentCreated`, `add_WebMessageReceived`, `add_NavigationCompleted`.
- Produces: fixed `[RenderPreviewDiag] stage=<stage> code=<code>` OutputDebugString records.

- [ ] Add a source-contract test for the exact envelope, allowlists, source restriction, injection events, and fixed native logs.
- [ ] Run the focused test with `CAD_RENDER_PREVIEW_BROWSER_PATH`; verify it fails because diagnostics are absent.
- [ ] Implement the minimal injected script and native validation/logging.
- [ ] Run the focused test and CAD Debug x64 build; verify both pass.

### Task 2: OCCT stage hooks

**Files:**
- Modify: `tests/renderer-host-client.test.js`
- Create: `tests/cad-webview-diagnostic-stages.test.js`
- Modify: `src/core/RendererHostClient.js`
- Modify: `src/App3D.js`
- Modify: `src/components/RoomRenderer.js`

**Interfaces:**
- Consumes: `window.chrome.webview.postMessage` when present.
- Produces: fixed diagnostic envelopes for boot/data/content/RPC stages.

- [ ] Add failing tests for RPC send/result/timeout and App3D/RoomRenderer stage hooks.
- [ ] Run focused tests; verify failures are caused by missing stages.
- [ ] Add the minimal fixed diagnostic emitter and hooks.
- [ ] Run focused and full tests; verify green.
- [ ] Commit OCCT tests/source/docs only.

### Task 3: Build, deploy, and handoff

**Files:**
- Build: `dist-3d/**`
- Replace without commit: CAD and cache `preview3d/**`, `preview-vr/**`, and cache `render_preview.js`.

**Interfaces:**
- Consumes: Task 1 CAD browser and Task 2 OCCT hooks.
- Produces: diagnostic-capable Debug ARX and identical deployed renderer artifacts.

- [ ] Run `npm.cmd test` with all CAD path environment variables and `npm.cmd run build:3d`.
- [ ] Validate four exact preview destinations and manually deploy current assets/data/index files without deleting siblings.
- [ ] Build CAD Debug x64 and verify the loaded/support Debug artifact hash.
- [ ] Audit OCCT clean state and CAD HEAD/index/README/content differences.
- [ ] Ask the user to reopen the 3D preview once and return the ordered `[RenderPreviewDiag]` lines.

