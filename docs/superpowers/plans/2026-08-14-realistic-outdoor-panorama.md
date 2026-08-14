# Realistic Outdoor Panorama Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the procedural window scenery with a bundled photorealistic residential-community panorama while retaining an offline procedural fallback.

**Architecture:** `OutdoorPanorama.js` continues to create the immediate procedural texture and adds one focused asynchronous loader for the bundled equirectangular image. `SceneManager` owns both the pending load and active texture, swaps the background only when fixed-point mode is active, and disposes replaced or late textures safely.

**Tech Stack:** Three.js `TextureLoader`, Vite public assets, Node test runner, GPT Image built-in generation.

## Global Constraints

- The panorama is a project-owned 2:1 equirectangular image of an ordinary urban residential community.
- The ordinary 3D orbit view must not show outdoor scenery.
- The current procedural panorama remains the failure fallback.
- Do not modify the 2D cartoon renderer.
- Sync the final build to CAD source resources and the AutoCAD 2021 runtime cache, but do not commit the CAD repository.

---

### Task 1: Generate and persist the panorama asset

**Files:**
- Create: `public/assets/outdoor/residential-community-panorama.png`

**Interfaces:**
- Produces: a local 2048×1024 equirectangular image consumed by `loadOutdoorPanoramaTexture()`.

- [ ] **Step 1: Generate the asset**

Use the built-in image generator with a photorealistic-natural prompt specifying a seamless 2:1 equirectangular residential-community scene, level horizon, middle-floor viewpoint, moderate greenery, daylight, and no text, people, logos, watermarks, or fisheye distortion.

- [ ] **Step 2: Inspect the generated image**

Verify that the left and right edges have compatible sky/building/ground bands, the horizon is level, and the scene reads as an ordinary Chinese urban residential community.

- [ ] **Step 3: Copy into the project**

Copy the selected generated image to `public/assets/outdoor/residential-community-panorama.png` without leaving the project reference pointed at the generation cache.

- [ ] **Step 4: Commit**

```powershell
git add public/assets/outdoor/residential-community-panorama.png
git commit -m "assets: add residential outdoor panorama"
```

### Task 2: Add tested real-texture loading and fallback

**Files:**
- Modify: `src/components/OutdoorPanorama.js`
- Modify: `tests/outdoor-panorama.test.js`

**Interfaces:**
- Produces: `OUTDOOR_PANORAMA_URL` and `loadOutdoorPanoramaTexture({ textureLoader }) -> Promise<THREE.Texture>`.
- Preserves: `createOutdoorPanoramaTexture()` as the synchronous procedural fallback.

- [ ] **Step 1: Write failing loader tests**

Add tests that inject a fake `textureLoader.loadAsync()` and assert the fixed local URL, `THREE.EquirectangularReflectionMapping`, `THREE.SRGBColorSpace`, the texture name `ResidentialCommunityOutdoorPanorama`, and rejection sanitization as `OUTDOOR_PANORAMA_LOAD_FAILED`.

- [ ] **Step 2: Verify the tests fail**

Run `node --test tests/outdoor-panorama.test.js` and confirm failure because `loadOutdoorPanoramaTexture` is missing.

- [ ] **Step 3: Implement the loader**

Add the fixed URL constant and configure only the returned texture. Catch loader details and throw `new Error('OUTDOOR_PANORAMA_LOAD_FAILED')` so signed URLs or browser internals never leak.

- [ ] **Step 4: Verify targeted tests pass**

Run `node --test tests/outdoor-panorama.test.js` and require zero failures.

- [ ] **Step 5: Commit**

```powershell
git add src/components/OutdoorPanorama.js tests/outdoor-panorama.test.js
git commit -m "feat: load realistic outdoor panorama"
```

### Task 3: Swap the SceneManager background safely

**Files:**
- Modify: `src/core/SceneManager.js`
- Modify: `tests/outdoor-panorama.test.js`

**Interfaces:**
- Consumes: `loadOutdoorPanoramaTexture()` from Task 2.
- Produces: `installOutdoorPanoramaTexture(texture, generation)` and safe disposal during replacement/destruction.

- [ ] **Step 1: Write failing lifecycle tests**

Cover successful replacement while inactive, replacement while active, load failure retaining the procedural fallback, and a late resolved texture being disposed after manager destruction.

- [ ] **Step 2: Verify the tests fail**

Run `node --test tests/outdoor-panorama.test.js` and confirm the lifecycle assertions fail before production changes.

- [ ] **Step 3: Implement minimal lifecycle integration**

Create the fallback synchronously in `setupEnvironment()`, begin the real texture load, replace and dispose the old texture only for the current generation, update `scene.background` only when it currently references the old outdoor texture, and invalidate the generation in `disposeOutdoorPanorama()`.

- [ ] **Step 4: Verify targeted tests pass**

Run `node --test tests/outdoor-panorama.test.js` and require zero failures.

- [ ] **Step 5: Commit**

```powershell
git add src/core/SceneManager.js tests/outdoor-panorama.test.js
git commit -m "feat: install outdoor panorama asynchronously"
```

### Task 4: Verify, build, and sync CAD resources

**Files:**
- Build output: `dist-3d/**`
- CAD source: `C:/Users/User/Desktop/cad_plugin/build_resource/PluginResource/html/renderer/preview3d/**`
- CAD source: `C:/Users/User/Desktop/cad_plugin/build_resource/PluginResource/html/renderer/preview-panorama/**`
- CAD source: `C:/Users/User/Desktop/cad_plugin/build_resource/PluginResource/html/renderer/preview-ai-concept/**`
- Runtime cache: corresponding folders under `C:/Users/User/AppData/Local/ke_arx_cache/2021/PluginResource/html/renderer/`

**Interfaces:**
- Consumes: the completed source and panorama asset.
- Produces: identical built resources in the three CAD destinations that use fixed-point scenery.

- [ ] **Step 1: Run complete verification**

Run `npm.cmd test` and require zero failures, then run `npm.cmd run build:3d` and require exit code 0.

- [ ] **Step 2: Verify the build contains the asset**

Check `dist-3d/assets/outdoor/residential-community-panorama.png` exists and hash it.

- [ ] **Step 3: Sync without deleting unrelated CAD files**

Copy `dist-3d/*` recursively with overwrite into `preview3d`, `preview-panorama`, and `preview-ai-concept` in both CAD source and runtime cache. Do not touch `cartoon` or commit CAD.

- [ ] **Step 4: Verify hashes and page behavior**

Confirm the six copied panorama files match the build hash. Open the local preview shell and verify the ordinary bird's-eye view has no outdoor panorama, while panorama and local-concept fixed views show the realistic scene with a level horizon.

- [ ] **Step 5: Record source completion**

Run `git status --short`, confirm the source worktree is clean, and report CAD as intentionally uncommitted.

