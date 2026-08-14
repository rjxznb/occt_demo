# CAD Render Preview Four-Page Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate the current `occt_demo` 3D, panorama, and AI concept pages into the CAD render-preview shell without changing any 2D page content, then resume the remaining AI generation work.

**Architecture:** `occt_demo` remains the source of the three Web applications. Vite builds independent HTML entries with relative assets. CAD's existing iframe shell keeps ownership of tab lifecycle and native bridge forwarding; it receives one updated 3D folder, two new page folders, and a minimal three-entry tab-config change. The old VR folder remains unreferenced as a rollback copy. CAD runtime cache mirrors the source resource tree.

**Tech Stack:** JavaScript ES modules, Vite 6, Node test runner and `vm`, CAD WebView2 static resources, PowerShell file verification.

## Global Constraints

- Do not modify `renderer/cartoon/` or the first tab configuration.
- Do not modify CAD C++, project files, native methods, or bridge protocol.
- Do not commit, stage, merge, or push `cad_plugin`.
- Preserve unrelated dirty CAD files and the legacy `preview-vr/` directory.
- Do not add a deployment script.
- Copy only a freshly verified `dist-3d` build.
- Never expose or copy an OpenAI API key.

### Task 1: Add an Executable CAD Shell Contract Test

**Files:**
- Create: `tests/cad-render-preview-shell.test.js`

- [ ] Build a minimal DOM/window harness with Node `vm` that executes the real CAD `render_preview.js` selected by `CAD_PLUGIN_ROOT`.
- [ ] Assert the first tab remains exactly `户型编辑器` with `./cartoon/index.html`.
- [ ] Assert the shell exposes exactly four tabs in order: existing 2D, `3D 鸟瞰图`, `全景看房`, `局部示意图`.
- [ ] Activate each new tab and assert its real iframe source is `./preview3d/index.html`, `./preview-panorama/index.html`, and `./preview-ai-concept/index.html`.
- [ ] Run the test against the current CAD tree and verify RED because only three legacy tabs exist.
- [ ] Commit the failing contract test only to `occt_demo`.

### Task 2: Build and Verify Current Web Applications

**Files:**
- Generated: `dist-3d/**`

- [ ] Run the complete current Node suite.
- [ ] Run `npm.cmd run build:3d`.
- [ ] Verify `dist-3d/index-3d.html`, `index-panorama.html`, and `index-ai-concept.html` exist.
- [ ] Resolve every local `src` and `href` referenced by the three HTML entries and verify the asset exists.
- [ ] Search the built output for API-key assignments and bearer-token literals; fail migration if a secret is present.

### Task 3: Update Only the CAD Web Shell's Last Three Tabs

**Files:**
- Modify: `C:/Users/User/Desktop/cad_plugin/build_resource/PluginResource/html/renderer/render_preview.js`

- [ ] Record CAD status and the first tab's exact configuration before editing.
- [ ] Keep the first tab byte-for-byte unchanged.
- [ ] Rename page 2 to `3D 鸟瞰图`, keeping `./preview3d/index.html`.
- [ ] Replace page 3 with `全景看房` at `./preview-panorama/index.html`.
- [ ] Add page 4 `局部示意图` at `./preview-ai-concept/index.html`.
- [ ] Run the shell contract test and verify GREEN.

### Task 4: Copy Verified Page Artifacts into the CAD Source Tree

**Files:**
- Update generated app: `renderer/preview3d/**`
- Create generated app: `renderer/preview-panorama/**`
- Create generated app: `renderer/preview-ai-concept/**`
- Preserve: `renderer/preview-vr/**`
- Preserve: `renderer/cartoon/**`

- [ ] Resolve and validate the exact CAD renderer root before any replacement.
- [ ] Replace only `preview3d/assets/` and `preview3d/index.html`; merge the fresh `dist-3d/data/` into `preview3d/data/` so existing unrelated data is not deleted.
- [ ] Create clean `preview-panorama/` and `preview-ai-concept/` directories from the fresh build, each with its renamed `index.html`, complete assets, and data.
- [ ] Verify all three deployed HTML files resolve every local asset.
- [ ] Verify `cartoon/` has the same file hash manifest as before migration.
- [ ] Verify `preview-vr/` has the same file hash manifest as before migration.

### Task 5: Mirror the Source Resources into the AutoCAD Runtime Cache

**Files:**
- Modify generated runtime resources under `C:/Users/User/AppData/Local/ke_arx_cache/2021/PluginResource/html/renderer/`

- [ ] Resolve the runtime root and prove it is exactly under the intended `ke_arx_cache/2021/PluginResource/html/renderer` directory.
- [ ] Copy the updated `render_preview.js`, `preview3d/`, `preview-panorama/`, and `preview-ai-concept/`.
- [ ] Do not alter the cached `cartoon/` directory.
- [ ] Keep cached `preview-vr/` for rollback.
- [ ] Compare source-tree and cache hashes for all newly deployed files.

### Task 6: CAD Migration Verification

- [ ] Run the shell contract test against the CAD source tree.
- [ ] Run the same contract test against the runtime-cache renderer root.
- [ ] Serve the renderer root locally and inspect the real four-tab shell in a browser.
- [ ] Open each of the three migrated pages and confirm no missing local asset requests or uncaught startup errors.
- [ ] Confirm the 3D page retains its existing camera interaction.
- [ ] Confirm the panorama page enters the current white-model panorama workflow.
- [ ] Confirm the local-concept page displays current thumbnails, minimap, and generation-conditions UI.
- [ ] Compare CAD Git status with the recorded pre-migration status; report only intended Web-resource changes and do not commit them.

### Task 7: Resume AI Generation Plan

- [ ] Return to Tasks 9 and 10 in `docs/superpowers/plans/2026-08-14-ai-concept-generation.md`.
- [ ] Implement frontend job client, polling, progress/results UI, recovery, retry, and cancellation using TDD.
- [ ] Add offline end-to-end coverage and the guarded real one-image smoke path.
- [ ] Rebuild and re-migrate only after those follow-up capabilities pass their own review checkpoint.
