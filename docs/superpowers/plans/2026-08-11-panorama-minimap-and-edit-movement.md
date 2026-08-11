# Panorama Mini-map and Edit Movement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Match the original 3D light mini-map and preserve the live camera view while editing panorama point positions.

**Architecture:** `PanoramaMiniMap` remains responsible for map DOM while its CSS adopts the original 3D visual tokens. `PanoramaApp` samples the live camera pose and passes its yaw into `PanoramaEditController`, which owns coordinate movement but no longer forces view resets for position previews.

**Tech Stack:** JavaScript ES modules, Three.js, Node test runner, CSS, Vite.

## Global Constraints

- Modify only the `occt_demo` panorama feature worktree; do not modify CAD Plugin.
- Do not commit the temporary `minimap-style-compare.html` file.
- Preserve point creation, selection, collapse, dirty-state, save, and cancel behavior.

---

### Task 1: Remove mini-map direction rays and adopt the original 3D light style

**Files:**
- Modify: `tests/panorama-minimap.test.js`
- Modify: `src/panorama/PanoramaMiniMap.js`
- Modify: `src/panorama/panorama.css`

**Interfaces:**
- Consumes: `PanoramaMiniMap.render({ roomPoints, points, activePointId, dirtyPointIds })`
- Produces: marker buttons without `.panorama-map-direction` descendants.

- [x] **Step 1: Write a failing test** asserting each point marker has no direction child.
- [x] **Step 2: Run** `node --test tests/panorama-minimap.test.js` and verify the new assertion fails.
- [x] **Step 3: Remove direction child creation** from `PanoramaMiniMap.render`.
- [x] **Step 4: Copy the original 3D light-stage, fine rounded room outline, and marker palette into panorama CSS.**
- [x] **Step 5: Run** `node --test tests/panorama-minimap.test.js` and verify it passes.

### Task 2: Move relative to live view without resetting orientation

**Files:**
- Modify: `tests/panorama-edit-controller.test.js`
- Modify: `tests/panorama-app-state.test.js`
- Modify: `tests/helpers/panorama-app-harness.js`
- Modify: `src/panorama/PanoramaEditController.js`
- Modify: `src/PanoramaApp.js`

**Interfaces:**
- Consumes: `PanoramaEditController.applyMovement(intent, deltaSeconds, view)` where `view.yaw` may override the stored working yaw for that movement.
- Produces: validated point movement using forward `(cos(yaw), sin(yaw))` and right `(sin(yaw), -cos(yaw))` bases.

- [x] **Step 1: Write failing controller tests** for yaw-zero right movement and movement using an updated live yaw.
- [x] **Step 2: Write a failing app test** proving a movement preview preserves the scene manager's live yaw.
- [x] **Step 3: Run the focused tests** and verify failures reflect the reversed right basis and forced view reset.
- [x] **Step 4: Update `applyMovement`** to accept the live view, synchronize `workingView`, and use the corrected right basis.
- [x] **Step 5: Update `PanoramaApp`** to sample the live pose for movement and use position-only previews; synchronize the live view before save.
- [x] **Step 6: Run the focused tests** and verify they pass.

### Task 3: Full verification and browser QA

**Files:**
- Verify only.

**Interfaces:**
- Consumes: the complete panorama application.
- Produces: test/build/browser evidence.

- [x] **Step 1: Run the complete test suite** with the package test command.
- [x] **Step 2: Run the production build** with the package build command.
- [x] **Step 3: Open the standalone panorama page** and verify the light mini-map has no direction rays.
- [x] **Step 4: Rotate during edit mode and trigger a position preview to verify orientation remains unchanged; verify A/D basis through the focused controller regression test.**
