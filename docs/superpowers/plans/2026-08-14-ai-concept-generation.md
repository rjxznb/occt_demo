# AI Concept Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production-shaped AI generation conditions dialog and a real, recoverable `gpt-image-2` image-editing workflow to the AI concept page.

**Architecture:** The browser owns condition selection, fixed-view white-model capture, and task presentation. It calls only same-origin `/api/ai-concept/*`; a project-local Node service owns the OpenAI key, task expansion, concurrency-two execution, disk persistence, retry, cancellation, and result files. Shared catalog and validation functions keep frontend and server rules consistent without exposing OpenAI request details to UI code.

**Tech Stack:** JavaScript ES modules, Three.js/WebGL render targets, Vite 6, Node.js built-in HTTP/fetch/FormData/Blob APIs, Node test runner, OpenAI `v1/images/edits` with model `gpt-image-2`.

## Global Constraints

- Modify only `D:/occt_demo/.worktrees/panorama-white-model-page`; do not modify CAD Plugin.
- The browser must never receive, persist, log, or submit `OPENAI_API_KEY`.
- The browser accesses only same-origin `/api/ai-concept/*`; do not disable CORS or add an arbitrary URL proxy.
- All valid AI views participate automatically; do not restore manual per-view selection.
- Provide exactly 12 style entries, 4 environment entries, and a server-controlled per-job maximum of 24 images.
- Use self-generated, photorealistic indoor reference images; do not copy third-party images or proprietary prompts.
- Use `gpt-image-2` image editing with the white-model view as image input; preserve camera, geometry, openings, ceiling, fixed elements, and major furniture layout.
- OpenAI queue concurrency is exactly 2 by default and configurable only on the server.
- Runtime jobs, input images, and result images live under a Git-ignored runtime directory, not source or build output.
- Do not fake completed tasks or results when the real API is unavailable.
- Use TDD for every behavior change and run the full Node test suite plus `npm.cmd run build:3d` before completion.

---

## File Structure

### Browser/shared modules

- `src/ai-concept/AiGenerationCatalog.js`: canonical style/environment data, defaults, normalization, combination count, and validation.
- `src/ai-concept/AiGenerationConditionRepository.js`: `planId + planVersion` local draft persistence.
- `src/ai-concept/AiGenerationConditionsDialog.js`: accessible central modal and user interactions.
- `src/ai-concept/AiViewGenerationCapture.js`: high-resolution, UI-free fixed-view WebGL capture.
- `src/ai-concept/AiGenerationClient.js`: same-origin API client and error normalization.
- `src/ai-concept/AiGenerationJobStore.js`: browser task polling and result state.
- `src/ai-concept/AiGenerationProgress.js`: task progress and input/result comparison UI.
- `src/AiConceptApp.js`: orchestration only; delegates catalog, dialog, capture, submit, and job rendering.

### Node modules

- `server/ai-concept/AiGenerationJobModel.mjs`: request validation, matrix expansion, IDs, and state aggregation.
- `server/ai-concept/AiGenerationRepository.mjs`: atomic JSON/image persistence and restart recovery.
- `server/ai-concept/OpenAiImageClient.mjs`: fixed OpenAI image-edit request and upstream error mapping.
- `server/ai-concept/AiGenerationQueue.mjs`: concurrency-two scheduler, retry, cancellation, and persistence transitions.
- `server/ai-concept/AiConceptApiHandler.mjs`: fixed `/api/ai-concept/*` routing and safe responses.
- `server/ai-concept-server.mjs`: Node HTTP entrypoint and controlled runtime result serving.
- `scripts/dev-ai-concept.mjs`: starts the API service and Vite dev server together with coordinated shutdown.

### Assets and runtime

- `public/assets/ai-styles/*.png`: 12 self-generated interior style reference images.
- `runtime/ai-concept/`: ignored job metadata, inputs, and outputs.

---

### Task 1: Canonical Catalog, Validation, and Condition Drafts

**Files:**
- Create: `src/ai-concept/AiGenerationCatalog.js`
- Create: `src/ai-concept/AiGenerationConditionRepository.js`
- Create: `tests/ai-generation-catalog.test.js`
- Create: `tests/ai-generation-condition-repository.test.js`

**Interfaces:**
- Produces: `STYLE_CATALOG`, `ENVIRONMENT_CATALOG`, `DEFAULT_GENERATION_CONDITIONS`, `MAX_IMAGES_PER_JOB`.
- Produces: `normalizeGenerationConditions(input, catalog?) -> { styleIds, environmentIds }`.
- Produces: `countGenerationCombinations({ viewCount, styleIds, environmentIds }) -> number`.
- Produces: `validateGenerationConditions({ viewCount, styleIds, environmentIds, maxImages }) -> { valid, count, code }`.
- Produces: `LocalAiGenerationConditionRepository.load(context)` and `.save(context, conditions)`.

- [ ] **Step 1: Write failing catalog tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STYLE_CATALOG, ENVIRONMENT_CATALOG, MAX_IMAGES_PER_JOB,
  normalizeGenerationConditions, countGenerationCombinations,
  validateGenerationConditions,
} from '../src/ai-concept/AiGenerationCatalog.js';

test('catalog exposes 12 styles, 4 environments and stable defaults', () => {
  assert.equal(STYLE_CATALOG.length, 12);
  assert.equal(ENVIRONMENT_CATALOG.length, 4);
  assert.equal(STYLE_CATALOG[0].id, 'modern-minimalist');
  assert.equal(ENVIRONMENT_CATALOG[0].id, 'sunny-day');
  assert.equal(MAX_IMAGES_PER_JOB, 24);
});

test('conditions deduplicate and reject empty or oversized matrices', () => {
  const normalized = normalizeGenerationConditions({
    styleIds: ['modern-minimalist', 'modern-minimalist'],
    environmentIds: ['sunny-day'],
  });
  assert.deepEqual(normalized.styleIds, ['modern-minimalist']);
  assert.equal(countGenerationCombinations({ viewCount: 12, ...normalized }), 12);
  assert.equal(validateGenerationConditions({ viewCount: 0, ...normalized, maxImages: 24 }).code, 'NO_VIEWS');
  assert.equal(validateGenerationConditions({ viewCount: 12, styleIds: ['a', 'b', 'c'], environmentIds: ['x'], maxImages: 24 }).code, 'TOO_MANY_IMAGES');
});
```

- [ ] **Step 2: Run catalog tests and verify failure**

Run: `node --test tests/ai-generation-catalog.test.js`

Expected: FAIL because `AiGenerationCatalog.js` does not exist.

- [ ] **Step 3: Implement the fixed catalog and pure validation functions**

Define these stable IDs in order:

```js
export const STYLE_CATALOG = Object.freeze([
  { id: 'modern-minimalist', name: '现代简约', imageUrl: './assets/ai-styles/modern-minimalist.png', prompt: 'modern minimalist...' },
  { id: 'modern-luxury', name: '现代轻奢', imageUrl: './assets/ai-styles/modern-luxury.png', prompt: 'modern light luxury...' },
  { id: 'fresh-cream', name: '清新奶油', imageUrl: './assets/ai-styles/fresh-cream.png', prompt: 'soft cream...' },
  { id: 'natural-wood', name: '原木自然', imageUrl: './assets/ai-styles/natural-wood.png', prompt: 'natural wood...' },
  { id: 'new-chinese', name: '新中式', imageUrl: './assets/ai-styles/new-chinese.png', prompt: 'contemporary Chinese...' },
  { id: 'nordic-fresh', name: '北欧清新', imageUrl: './assets/ai-styles/nordic-fresh.png', prompt: 'fresh Nordic...' },
  { id: 'japanese-wabi-sabi', name: '日式侘寂', imageUrl: './assets/ai-styles/japanese-wabi-sabi.png', prompt: 'Japanese wabi-sabi...' },
  { id: 'french-cream', name: '法式奶油', imageUrl: './assets/ai-styles/french-cream.png', prompt: 'French cream...' },
  { id: 'italian-elegant', name: '意式典雅', imageUrl: './assets/ai-styles/italian-elegant.png', prompt: 'elegant Italian contemporary...' },
  { id: 'mid-century-vintage', name: '中古复古', imageUrl: './assets/ai-styles/mid-century-vintage.png', prompt: 'mid-century vintage...' },
  { id: 'american-classic', name: '美式经典', imageUrl: './assets/ai-styles/american-classic.png', prompt: 'American classic...' },
  { id: 'industrial', name: '工业风', imageUrl: './assets/ai-styles/industrial.png', prompt: 'refined industrial...' },
]);
```

Define environment IDs `sunny-day`, `overcast-soft`, `warm-sunset`, and `night-ambience`. Keep prompts on the server-consumed catalog objects and never accept arbitrary prompt text from the browser.

- [ ] **Step 4: Run catalog tests and verify pass**

Run: `node --test tests/ai-generation-catalog.test.js`

Expected: PASS.

- [ ] **Step 5: Write failing draft repository tests**

Use an in-memory `storage` double and prove key isolation between `{ planId: 'a', planVersion: '1' }` and version `2`, invalid IDs are removed on load, and the defaults are returned when no draft exists.

- [ ] **Step 6: Implement `LocalAiGenerationConditionRepository`**

Use key prefix `occt.ai-concept-generation.conditions.v1:` plus encoded `planId` and `planVersion`. Save only normalized `styleIds`, `environmentIds`, and `updatedAt`; do not save images, tasks, prompts, or secrets.

- [ ] **Step 7: Run repository tests**

Run: `node --test tests/ai-generation-condition-repository.test.js`

Expected: PASS.

- [ ] **Step 8: Commit task 1**

```powershell
git add src/ai-concept/AiGenerationCatalog.js src/ai-concept/AiGenerationConditionRepository.js tests/ai-generation-catalog.test.js tests/ai-generation-condition-repository.test.js
git commit -m "feat: add AI generation condition model"
```

---

### Task 2: Generate and Validate the 12 Style Reference Assets

**Files:**
- Add: `public/assets/ai-styles/modern-minimalist.png`
- Add: `public/assets/ai-styles/modern-luxury.png`
- Add: `public/assets/ai-styles/fresh-cream.png`
- Add: `public/assets/ai-styles/natural-wood.png`
- Add: `public/assets/ai-styles/new-chinese.png`
- Add: `public/assets/ai-styles/nordic-fresh.png`
- Add: `public/assets/ai-styles/japanese-wabi-sabi.png`
- Add: `public/assets/ai-styles/french-cream.png`
- Add: `public/assets/ai-styles/italian-elegant.png`
- Add: `public/assets/ai-styles/mid-century-vintage.png`
- Add: `public/assets/ai-styles/american-classic.png`
- Add: `public/assets/ai-styles/industrial.png`
- Create: `tests/ai-generation-style-assets.test.js`

**Interfaces:**
- Consumes: `STYLE_CATALOG[*].imageUrl` from Task 1.
- Produces: exactly one project-owned 3:2 photorealistic indoor image for every style ID.

- [ ] **Step 1: Write the failing asset contract test**

```js
test('every style image is a non-empty project asset', async () => {
  for (const style of STYLE_CATALOG) {
    const file = resolve('public', style.imageUrl.replace(/^\.\//, ''));
    const stat = await fs.stat(file);
    assert.ok(stat.size > 100_000, `${style.id} must be a real reference image`);
  }
});
```

- [ ] **Step 2: Run the asset contract test and verify missing images fail**

Run: `node --test tests/ai-generation-style-assets.test.js`

Expected: FAIL listing the eight assets not yet generated.

- [ ] **Step 3: Generate the remaining images with the imagegen skill**

Use one built-in image generation call per missing style. All prompts must specify: a full residential living room seen from inside, wide eye-level entrance-corner framing, sofa/coffee table/TV wall/window, photorealistic editorial interior photography, no people, no floor plan, no axonometric view, no text, no logo, no watermark. Change only the named style direction. Copy final assets into the exact paths above and preserve the already accepted four images where their IDs match.

- [ ] **Step 4: Visually inspect all 12 images**

Reject any image that is a color floor plan, exterior, close-up vignette, collage, or visibly contains text/watermarks. Confirm each card remains legible when cropped to approximately `180 × 120` CSS pixels.

- [ ] **Step 5: Run the asset test and build copy check**

Run: `node --test tests/ai-generation-style-assets.test.js`

Run: `npm.cmd run build:3d`

Expected: PASS; each file also exists under `dist-3d/assets/ai-styles/` after the build.

- [ ] **Step 6: Commit task 2**

```powershell
git add public/assets/ai-styles tests/ai-generation-style-assets.test.js
git commit -m "feat: add AI interior style references"
```

---

### Task 3: Conditions Dialog and AI Page Integration

**Files:**
- Create: `src/ai-concept/AiGenerationConditionsDialog.js`
- Create: `tests/ai-generation-conditions-dialog.test.js`
- Modify: `index-ai-concept.html`
- Modify: `src/ai-concept/ai-concept.css`
- Modify: `src/AiConceptApp.js`
- Modify: `tests/ai-concept-page-contract.test.js`
- Modify: `tests/ai-concept-app-state.test.js`
- Modify: `tests/helpers/ai-concept-app-harness.js`

**Interfaces:**
- Consumes: catalog and validation functions from Task 1.
- Produces: `new AiGenerationConditionsDialog(container, { onSubmit, onCancel })`.
- Produces: `.open({ catalog, conditions, viewCount })`, `.close()`, `.setSubmitting(boolean)`, `.showError(message)`, `.dispose()`.
- Changes: `AiConceptApp.continueToConditions()` opens the dialog and no longer replaces the whole page with a placeholder card.

- [ ] **Step 1: Write failing dialog interaction tests**

Test all of the following with the existing lightweight DOM harness pattern:

- first 8 style cards render and the remaining 4 are hidden;
- “展开更多” reveals all 12;
- style and environment cards toggle independently;
- default count is `viewCount × 1 × 1`;
- zero selections and counts over 24 disable submit with exact validation copy;
- submit emits normalized IDs once;
- Escape/cancel closes only when not submitting;
- image load failure adds a stable fallback class without changing selection.

- [ ] **Step 2: Run dialog tests and verify failure**

Run: `node --test tests/ai-generation-conditions-dialog.test.js`

Expected: FAIL because the dialog module does not exist.

- [ ] **Step 3: Add semantic dialog markup and Liquid Glass styling**

Replace the placeholder `#ai-concept-conditions` content with a `role="dialog"`, `aria-modal="true"`, labelled heading, style grid, environment group, live count, validation message, cancel, and submit buttons. Keep the modal central and responsive: 4 columns desktop, 2 columns narrow screens; selected cards use blue border and a check marker.

- [ ] **Step 4: Implement the dialog class**

Render from catalog data, use event delegation on `data-style-id` and `data-environment-id`, and call pure Task 1 validation after every change. Do not construct OpenAI prompts in this class.

- [ ] **Step 5: Run dialog tests**

Run: `node --test tests/ai-generation-conditions-dialog.test.js`

Expected: PASS.

- [ ] **Step 6: Write failing `AiConceptApp` integration tests**

Assert that clicking continue passes all `canSubmitView()` views to the dialog, editing keeps continue disabled, cancel returns to `ready`, and the previous `conditions` phase placeholder is no longer used.

- [ ] **Step 7: Integrate dialog lifecycle into `AiConceptApp`**

Inject `generationDialogFactory` and `generationConditionRepository`. On open, load the `planId + planVersion` draft, normalize it against the catalog, and preserve the scene/camera. On submit, save conditions and call a temporary `_submitGeneration()` boundary that Task 9 replaces with the real client; before Task 9 it must return the explicit error `AI_GENERATION_CLIENT_NOT_READY`, not a fake success.

- [ ] **Step 8: Run page and app tests**

Run: `node --test tests/ai-generation-conditions-dialog.test.js tests/ai-concept-page-contract.test.js tests/ai-concept-app-state.test.js`

Expected: PASS.

- [ ] **Step 9: Commit task 3**

```powershell
git add index-ai-concept.html src/ai-concept/ai-concept.css src/ai-concept/AiGenerationConditionsDialog.js src/AiConceptApp.js tests/ai-generation-conditions-dialog.test.js tests/ai-concept-page-contract.test.js tests/ai-concept-app-state.test.js tests/helpers/ai-concept-app-harness.js
git commit -m "feat: add AI generation conditions dialog"
```

---

### Task 4: High-Resolution White-Model Capture

**Files:**
- Create: `src/ai-concept/AiViewGenerationCapture.js`
- Create: `tests/ai-view-generation-capture.test.js`
- Modify: `src/AiConceptApp.js`

**Interfaces:**
- Produces: `new AiViewGenerationCapture({ scene, renderer, width = 1536, height = 1024, canvasFactory })`.
- Produces: `.capture(view) -> Promise<{ viewId, mimeType: 'image/webp', dataUrl, digestSource }>`.
- Produces: `.captureAll(views, { onProgress, signal }) -> Promise<Array<Capture>>`.
- Produces: `.dispose()`.

- [ ] **Step 1: Write failing capture tests**

Reuse renderer doubles from `ai-view-thumbnail-capture.test.js`, but assert 1536 × 1024 output, stable input order, camera yaw/pitch/FOV mapping, renderer state restoration after success/failure, abort behavior, and absence of DOM/UI rendering calls.

- [ ] **Step 2: Run capture tests and verify failure**

Run: `node --test tests/ai-view-generation-capture.test.js`

Expected: FAIL because the capture module does not exist.

- [ ] **Step 3: Implement generation capture**

Extract the reusable camera and pixel-flip behavior from `AiViewThumbnailCapture` only if doing so reduces duplication without changing thumbnail output. Use a dedicated render target and camera, output WebP quality `0.9`, serialize captures, and always restore render target, viewport, scissor, clear color, and alpha in `finally`.

- [ ] **Step 4: Run thumbnail and generation capture tests**

Run: `node --test tests/ai-view-thumbnail-capture.test.js tests/ai-view-generation-capture.test.js`

Expected: PASS with unchanged thumbnail behavior.

- [ ] **Step 5: Integrate capture lifecycle**

Create the capture service only after scene/renderer initialization. Dispose it with the AI app. Before submission, capture `state.views.filter(canSubmitView)` in stable store order and report the current room/view name on failure. The capture service must not change the visible active camera because it renders with its own offscreen camera.

- [ ] **Step 6: Commit task 4**

```powershell
git add src/ai-concept/AiViewGenerationCapture.js src/AiConceptApp.js tests/ai-view-generation-capture.test.js
git commit -m "feat: capture AI white model inputs"
```

---

### Task 5: Server Job Model and Atomic Persistence

**Files:**
- Create: `server/ai-concept/AiGenerationJobModel.mjs`
- Create: `server/ai-concept/AiGenerationRepository.mjs`
- Create: `tests/ai-generation-job-model.test.js`
- Create: `tests/ai-generation-repository.test.js`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: catalog and maximum from Task 1.
- Produces: `validateCreateJobRequest(body) -> normalized request or throws AiApiError`.
- Produces: `expandGenerationItems(request) -> Array<JobItem>`.
- Produces: `computeGenerationIdempotencyKey(item) -> 64-char SHA-256 hex`.
- Produces: `aggregateJobStatus(items) -> queued|running|completed|partial|failed|cancelled`.
- Produces: `AiGenerationRepository.createJob(job)`, `.loadJob(jobId)`, `.saveJob(job)`, `.listRecoverableJobs()`, `.writeInput(...)`, `.writeOutput(...)`.

- [ ] **Step 1: Write failing job model tests**

Cover stable Cartesian expansion, server-side 24-image enforcement, unknown style/environment rejection, invalid/missing data URLs, deterministic SHA-256 keys, duplicate capture rejection, and every aggregate status outcome.

- [ ] **Step 2: Run job model tests and verify failure**

Run: `node --test tests/ai-generation-job-model.test.js`

Expected: FAIL because server modules do not exist.

- [ ] **Step 3: Implement job model functions**

Accept only known fields. Each view must include stable ID, room identity, finite camera parameters, and `data:image/webp;base64,...`. Decode and validate input size before persistence. Generate server IDs with `crypto.randomUUID()` and timestamps with an injected clock in tests.

- [ ] **Step 4: Run job model tests**

Run: `node --test tests/ai-generation-job-model.test.js`

Expected: PASS.

- [ ] **Step 5: Write failing repository tests**

Use a temporary directory. Prove atomic metadata replacement, input/output file isolation, path traversal rejection, completed result recovery, and conversion of stale `running` items to `interrupted` on restart.

- [ ] **Step 6: Implement repository with controlled paths**

Use `runtime/ai-concept/<plan-safe-id>/<version-safe-id>/<jobId>/`. Write JSON to a sibling temporary file and rename atomically. Never construct paths from raw room names or upstream filenames. Return controlled `/api/ai-concept/jobs/:jobId/assets/:assetId` URLs rather than absolute paths.

- [ ] **Step 7: Ignore runtime data and run repository tests**

Add `/runtime/ai-concept/` to `.gitignore`.

Run: `node --test tests/ai-generation-repository.test.js`

Expected: PASS.

- [ ] **Step 8: Commit task 5**

```powershell
git add .gitignore server/ai-concept/AiGenerationJobModel.mjs server/ai-concept/AiGenerationRepository.mjs tests/ai-generation-job-model.test.js tests/ai-generation-repository.test.js
git commit -m "feat: persist AI generation jobs"
```

---

### Task 6: Fixed OpenAI GPT Image 2 Client

**Files:**
- Create: `server/ai-concept/OpenAiImageClient.mjs`
- Create: `tests/openai-image-client.test.js`

**Interfaces:**
- Produces: `new OpenAiImageClient({ apiKey, fetchImpl, endpoint, timeoutMs })`.
- Produces: `.edit({ imageBytes, mimeType, prompt, signal }) -> Promise<{ bytes, mimeType, usage, requestId }>`.
- Produces: `OpenAiImageError` with `code`, `status`, `retryable`, and safe `message`.

- [ ] **Step 1: Write failing client tests with mocked fetch**

Assert the request is `POST https://api.openai.com/v1/images/edits`, bearer-authenticated, multipart, and includes exactly: `model=gpt-image-2`, `image`, `prompt`, `size=1536x1024`, `quality=medium`, and `output_format=png`. Assert `data[0].b64_json` decoding, request ID capture, timeout abort, malformed response handling, and error classification for 401, 429, 5xx, and content-policy responses.

- [ ] **Step 2: Run client tests and verify failure**

Run: `node --test tests/openai-image-client.test.js`

Expected: FAIL because the client does not exist.

- [ ] **Step 3: Implement the client using Node built-ins**

Use `FormData`, `Blob`, and injected `fetchImpl`; do not add the OpenAI SDK. Redact authorization data and upstream bodies from thrown errors. Classify 429, timeout, network errors, and 5xx as retryable; classify 400 policy/input, 401/403 auth, and quota exhaustion as non-retryable.

- [ ] **Step 4: Implement the shared structural prompt builder**

Export `buildInteriorEditPrompt({ style, environment })`. Its invariant prefix must explicitly preserve camera viewpoint, perspective, room dimensions, walls, openings, ceiling, fixed elements, and major furniture placement; it must forbid plans, axonometric views, collages, text, watermarks, logos, and people. Append only server-owned style and environment prompt fragments.

- [ ] **Step 5: Run client tests**

Run: `node --test tests/openai-image-client.test.js`

Expected: PASS.

- [ ] **Step 6: Commit task 6**

```powershell
git add server/ai-concept/OpenAiImageClient.mjs tests/openai-image-client.test.js
git commit -m "feat: add GPT Image 2 edit client"
```

---

### Task 7: Queue, Retry, Cancellation, and API Routes

**Files:**
- Create: `server/ai-concept/AiGenerationQueue.mjs`
- Create: `server/ai-concept/AiConceptApiHandler.mjs`
- Create: `tests/ai-generation-queue.test.js`
- Create: `tests/ai-concept-api-handler.test.js`

**Interfaces:**
- Consumes: Tasks 1, 5, and 6.
- Produces: `AiGenerationQueue.enqueue(jobId)`, `.retry(jobId, itemId)`, `.cancel(jobId)`, `.recover()`.
- Produces: `createAiConceptApiHandler({ repository, queue, apiConfigured, bodyLimitBytes }) -> async (req, res) => handled`.

- [ ] **Step 1: Write failing queue tests**

Use deferred fake image calls to prove no more than two run concurrently, completion is persisted immediately, retryable errors use injected backoff delays, non-retryable errors fail once, cancel prevents queued starts, retry resets only an eligible item, and recovery converts interrupted work back to queued only when explicitly resumed.

- [ ] **Step 2: Run queue tests and verify failure**

Run: `node --test tests/ai-generation-queue.test.js`

Expected: FAIL because the queue does not exist.

- [ ] **Step 3: Implement queue state transitions**

Default `concurrency = 2`, `maxAttempts = 3`, and exponential delays derived from `1000 * 2 ** (attempt - 1)` plus injected jitter. Persist before and after every external call. Store outputs through the repository and never retain base64 output in metadata.

- [ ] **Step 4: Run queue tests**

Run: `node --test tests/ai-generation-queue.test.js`

Expected: PASS.

- [ ] **Step 5: Write failing API handler tests**

Cover:

- `GET /api/ai-concept/catalog` returns catalog, max 24, and `configured`.
- `POST /api/ai-concept/jobs` returns 503 `OPENAI_NOT_CONFIGURED` before creating data when the key is absent.
- valid create returns 202 and a job summary.
- duplicate `requestId` returns the original job.
- get, retry, cancel, and controlled asset routes work.
- unknown routes return 404.
- oversized or malformed JSON returns 413/400.
- errors contain no API key, upstream body, or absolute path.

- [ ] **Step 6: Implement fixed API routing**

Set JSON responses with `Cache-Control: no-store`. Strip the server-only `prompt` field before returning style or environment catalog entries. Serve style assets through Vite/static hosting and task assets through controlled IDs. Do not reflect arbitrary origins or accept arbitrary target URLs.

- [ ] **Step 7: Run server unit tests**

Run: `node --test tests/ai-generation-queue.test.js tests/ai-concept-api-handler.test.js`

Expected: PASS.

- [ ] **Step 8: Commit task 7**

```powershell
git add server/ai-concept/AiGenerationQueue.mjs server/ai-concept/AiConceptApiHandler.mjs tests/ai-generation-queue.test.js tests/ai-concept-api-handler.test.js
git commit -m "feat: add AI generation task API"
```

---

### Task 8: Same-Origin Development and Production Server Wiring

**Files:**
- Create: `server/ai-concept-server.mjs`
- Create: `scripts/dev-ai-concept.mjs`
- Create: `tests/ai-concept-server-contract.test.js`
- Modify: `vite.config.js`
- Modify: `vite.config.3d.js`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 7 API handler.
- Produces: `npm.cmd run dev:ai-concept` for one-command local startup.
- Produces: `npm.cmd run serve:ai-concept` for serving `dist-3d` and API from one origin.
- Environment: `OPENAI_API_KEY`, optional `AI_CONCEPT_PORT` default `8787`, optional `AI_CONCEPT_CONCURRENCY` default `2`.

- [ ] **Step 1: Write failing server contract tests**

Spawn the server with a temporary runtime directory and no key. Assert `/api/ai-concept/catalog` works, `/api/ai-concept/jobs` reports not configured, a static AI page is served only in production mode, path traversal is rejected, and graceful shutdown closes the listener.

- [ ] **Step 2: Run server contract tests and verify failure**

Run: `node --test tests/ai-concept-server-contract.test.js`

Expected: FAIL because the entrypoint does not exist.

- [ ] **Step 3: Implement the HTTP entrypoint**

Create dependencies once, call `queue.recover()` at startup, serve only fixed API routes plus files rooted under `dist-3d`, and expose a testable `startAiConceptServer(options)` that returns `{ origin, close }`. Refuse startup when concurrency is not a positive integer.

- [ ] **Step 4: Add Vite proxy and one-command dev orchestration**

Proxy `/api` to `http://127.0.0.1:8787` in both Vite configs. `scripts/dev-ai-concept.mjs` must spawn the API server and Vite, forward exit codes, terminate both children on Ctrl+C, and avoid visible extra windows on Windows.

Add scripts:

```json
{
  "dev:ai-concept": "node scripts/dev-ai-concept.mjs",
  "serve:ai-concept": "node server/ai-concept-server.mjs"
}
```

- [ ] **Step 5: Document key setup without accepting keys in chat or code**

In `README.md`, document PowerShell process-scoped setup:

```powershell
$env:OPENAI_API_KEY = '<set locally; do not commit>'
npm.cmd run dev:ai-concept
```

Also document the unconfigured behavior and runtime directory.

- [ ] **Step 6: Run server tests and builds**

Run: `node --test tests/ai-concept-server-contract.test.js`

Run: `npm.cmd run build:3d`

Expected: PASS and successful build.

- [ ] **Step 7: Commit task 8**

```powershell
git add server/ai-concept-server.mjs scripts/dev-ai-concept.mjs tests/ai-concept-server-contract.test.js vite.config.js vite.config.3d.js package.json README.md
git commit -m "feat: serve AI generation through same origin"
```

---

### Task 9: Frontend Job Client, Progress, Results, and App Submission

**Files:**
- Create: `src/ai-concept/AiGenerationClient.js`
- Create: `src/ai-concept/AiGenerationJobStore.js`
- Create: `src/ai-concept/AiGenerationProgress.js`
- Create: `tests/ai-generation-client.test.js`
- Create: `tests/ai-generation-job-store.test.js`
- Create: `tests/ai-generation-progress.test.js`
- Modify: `index-ai-concept.html`
- Modify: `src/ai-concept/ai-concept.css`
- Modify: `src/AiConceptApp.js`
- Modify: `tests/ai-concept-app-state.test.js`

**Interfaces:**
- Consumes: captures from Task 4 and API from Tasks 7–8.
- Produces: `AiGenerationClient.getCatalog()`, `.createJob(payload)`, `.getJob(jobId)`, `.retryItem(jobId, itemId)`, `.cancelJob(jobId)`.
- Produces: `AiGenerationJobStore.start(jobId)`, `.stop()`, `.retry(itemId)`, `.cancel()`, `.subscribe(listener)`.
- Produces: `AiGenerationProgress.render(state)` with overall progress, grouped items, and white-model/result comparison.

- [ ] **Step 1: Write failing API client tests**

Mock fetch and assert same-origin relative URLs only, request/response normalization, AbortSignal forwarding, safe server error messages, and no retry inside the browser client.

- [ ] **Step 2: Implement `AiGenerationClient` and run tests**

Run: `node --test tests/ai-generation-client.test.js`

Expected: PASS.

- [ ] **Step 3: Write failing job store tests**

Use an injected scheduler to prove immediate first fetch, two-second polling while queued/running, stop on terminal state, partial result emission without waiting for all items, refresh recovery from a stored job ID, single-item retry, and cancel.

- [ ] **Step 4: Implement `AiGenerationJobStore` and run tests**

Run: `node --test tests/ai-generation-job-store.test.js`

Expected: PASS.

- [ ] **Step 5: Write failing progress component tests**

Assert exact labels for waiting/running/completed/failed/cancelled, overall count, room/view/style/environment metadata, retry only on failed items, cancel only on nonterminal jobs, and side-by-side input/result images for completed items.

- [ ] **Step 6: Implement progress/results UI**

Add a dedicated full-page phase after successful submission. Completed cards appear immediately, use a “方向示意图” label, and retain input white-model image beside the generated output. Failed cards show safe errors and a retry button.

- [ ] **Step 7: Wire real submit flow into `AiConceptApp`**

On submit:

1. load the server catalog through `AiGenerationClient.getCatalog()` and normalize the saved draft against enabled IDs;
2. set the dialog to submitting;
3. capture all valid views;
4. create a stable client `requestId`;
5. call `createJob` with context, conditions, view metadata, and data URLs;
6. close the dialog only after a 202 response;
7. start the job store and switch to the progress phase;
8. on failure, keep the dialog and selections open and show the exact safe error.

Persist the active `jobId` under `planId + planVersion`; on page reload, offer/resume the real existing job instead of creating another.

- [ ] **Step 8: Run frontend and app integration tests**

Run: `node --test tests/ai-generation-client.test.js tests/ai-generation-job-store.test.js tests/ai-generation-progress.test.js tests/ai-concept-app-state.test.js`

Expected: PASS.

- [ ] **Step 9: Commit task 9**

```powershell
git add index-ai-concept.html src/ai-concept/ai-concept.css src/ai-concept/AiGenerationClient.js src/ai-concept/AiGenerationJobStore.js src/ai-concept/AiGenerationProgress.js src/AiConceptApp.js tests/ai-generation-client.test.js tests/ai-generation-job-store.test.js tests/ai-generation-progress.test.js tests/ai-concept-app-state.test.js
git commit -m "feat: show AI generation progress and results"
```

---

### Task 10: End-to-End Regression and Real One-Image Smoke Test

**Files:**
- Create: `tests/ai-concept-generation-flow.test.js`
- Create: `tests/ai-concept-openai-smoke.test.js`
- Create: `docs/ai-concept-generation-operations.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: repeatable offline integration coverage and an opt-in real API smoke command.

- [ ] **Step 1: Write the offline end-to-end test**

Start the real local API handler with a fake `OpenAiImageClient`, load the AI app harness, submit `1 view × 1 style × 1 environment`, release the deferred fake image result, and assert the browser reaches completed state with matching plan/version/room/view/style/environment metadata and both image URLs.

- [ ] **Step 2: Run the end-to-end test**

Run: `node --test tests/ai-concept-generation-flow.test.js`

Expected: PASS without network or an API key.

- [ ] **Step 3: Add an opt-in real smoke path**

Document a Node test guarded by `OPENAI_API_KEY` and `RUN_OPENAI_IMAGE_SMOKE=1`. It must submit exactly one existing white-model capture, one `modern-minimalist` style, and one `sunny-day` environment. When the guard is absent, it reports SKIP rather than PASS with a fake result.

- [ ] **Step 4: Document operations and failure recovery**

`docs/ai-concept-generation-operations.md` must contain:

- secure environment-variable setup;
- startup commands;
- port/runtime configuration;
- how to identify auth, quota, policy, limit, timeout, and interrupted errors;
- retry/cancel/restart behavior;
- runtime cleanup procedure limited to a verified `runtime/ai-concept` target;
- explicit statement that generated images are direction references, not final delivery renders.

- [ ] **Step 5: Run complete verification**

Run: `node --test`

Expected: all tests pass; the guarded real smoke test skips unless explicitly enabled.

Run: `npm.cmd run build:3d`

Expected: exit code 0 and AI page/style assets included.

Run with a locally configured key only after all offline checks pass:

```powershell
$env:RUN_OPENAI_IMAGE_SMOKE = '1'
node --test tests/ai-concept-openai-smoke.test.js
```

Expected: one real completed result whose camera perspective and major spatial structure match the white-model input and whose style/environment are visibly applied.

- [ ] **Step 6: Browser QA**

Open `index-ai-concept.html` through `npm.cmd run dev:ai-concept` and verify:

- 12 photorealistic style cards, 8 collapsed by default and 4 behind expand;
- central Liquid Glass modal, correct defaults, multi-select, count, and 24 limit;
- no CORS errors and no API key in network responses or built files;
- submission progress updates without freezing the 3D scene;
- completed and failed items appear independently;
- input/result comparison works;
- refresh restores the same real job;
- console has no uncaught errors.

- [ ] **Step 7: Commit task 10**

```powershell
git add tests/ai-concept-generation-flow.test.js tests/ai-concept-openai-smoke.test.js docs/ai-concept-generation-operations.md README.md
git commit -m "test: verify AI concept generation flow"
```

---

## Final Review Checklist

- [ ] Confirm `git status --short` contains no runtime output, secret, temporary companion file, or CAD Plugin change.
- [ ] Search tracked files for `OPENAI_API_KEY=` and bearer-token literals; only documentation placeholders and environment reads may remain.
- [ ] Run `node --test` and record total pass/fail/skip counts.
- [ ] Run `npm.cmd run build:3d` and record success.
- [ ] Inspect one real `gpt-image-2` result against its white-model input.
- [ ] Request code review before merge or push.
