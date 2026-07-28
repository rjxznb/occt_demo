# OCCT Node Content-Model Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load the standalone OCCT renderer's real door/content models through the Node backend while keeping the CAD WebView on its existing C++ bridge transport.

**Architecture:** `ParametricApiClient` remains the transport switch: an available CAD parent bridge uses the existing RPC methods, otherwise the client uses HTTP at port 3100. The Node backend gains the C++ batch goods-detail contract and aligned validation, timeout, response-size, error, and logging behavior; `ContentModelLoader` remains transport-agnostic.

**Tech Stack:** JavaScript ES modules, Node.js `node:test`, Express 4, native `http`/`https`, `fzstd`, Vite, Three.js.

## Global Constraints

- Modify only `D:\occt_demo\.worktrees\cad-renderer-parametric-bridge` and `C:\Users\User\Desktop\parametric-lab\backend`.
- Do not modify, stage, commit, reset, or discard any file in `C:\Users\User\Desktop\cad_plugin`.
- Keep CAD bridge methods and payloads unchanged: `getParametricGoodsDetail`, `getContentGoodsDetails`, and `convertParametricModel`.
- Node backend URL remains `http://localhost:3100`.
- Batch requests contain 1–50 unique decimal-string IDs, each at most 128 bytes.
- Model URLs are HTTP(S), at most 8192 bytes; parameters are at most 64 entries with names at most 128 bytes and finite numeric values.
- Upstream response limit is 64 MiB; goods timeout is 30 seconds; model timeout is 120 seconds.
- Do not log signed URLs, upstream bodies, model contents, tokens, or raw responses.
- Door model failures leave empty openings; window rendering is unchanged in this checkpoint.

---

### Task 1: Testable Node backend and batch goods-detail endpoint

**Files:**
- Create: `C:\Users\User\Desktop\parametric-lab\backend\app.js`
- Create: `C:\Users\User\Desktop\parametric-lab\backend\test\content-api.test.js`
- Modify: `C:\Users\User\Desktop\parametric-lab\backend\server.js`
- Modify: `C:\Users\User\Desktop\parametric-lab\backend\package.json`

**Interfaces:**
- Produces: `createApp({ requestUpstream?, logger? }): Express.Application`.
- Produces: `POST /api/getContentGoodsDetails`, body `{ resIds: string[] }`.
- Produces: JSON errors `{ code: string, message: string, status: number }`.
- Upstream batch endpoint: `https://biz-gateway.home.ke.com/utopia-render-platform/bim/pc/render/getResGoodsDetail?resGoodsIdList=<comma-separated IDs>`.

- [ ] **Step 1: Add failing backend contract tests**

Use `node:test`, start `createApp()` on an ephemeral port, and inject a `requestUpstream` fake. Cover the successful URL and unchanged response body:

```js
test('batch goods details validates IDs and forwards one upstream request', async () => {
  const calls = [];
  const app = createApp({
    requestUpstream: async request => {
      calls.push(request);
      return { status: 200, body: Buffer.from(JSON.stringify({ code: 2000, data: [{ id: '7' }, { id: '8' }] })) };
    },
    logger: silentLogger,
  });
  const response = await postJson(app, '/api/getContentGoodsDetails', { resIds: ['7', '8'] });
  assert.equal(response.status, 200);
  assert.match(calls[0].url, /resGoodsIdList=7,8$/);
  assert.deepEqual(response.body.data.map(item => item.id), ['7', '8']);
});
```

Add table-driven 400 assertions for an empty list, 51 IDs, duplicate IDs, non-decimal IDs, IDs longer than 128 bytes, additional body properties, and a missing `resIds` property. Assert the fake upstream is not called for invalid input.

- [ ] **Step 2: Run the backend test and verify RED**

Run:

```powershell
npm.cmd test
```

Working directory: `C:\Users\User\Desktop\parametric-lab\backend`.

Expected: FAIL because `app.js`, `createApp`, and the batch route do not exist.

- [ ] **Step 3: Extract app creation and implement the batch route**

Move route registration out of `server.js` into `app.js`. Keep `server.js` as the production entrypoint:

```js
import { createApp } from './app.js';

const PORT = process.env.PORT || 3100;
createApp().listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
```

Implement strict batch normalization:

```js
export function parseResIds(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).length !== 1 || !Array.isArray(body.resIds) ||
      body.resIds.length < 1 || body.resIds.length > 50) {
    throw apiError('INVALID_ARGUMENT', 'resIds is invalid', 0, 400);
  }
  const ids = body.resIds;
  if (new Set(ids).size !== ids.length || ids.some(id =>
    typeof id !== 'string' || !/^\d+$/.test(id) || Buffer.byteLength(id) > 128)) {
    throw apiError('INVALID_ARGUMENT', 'resIds is invalid', 0, 400);
  }
  return ids;
}
```

The route calls `requestUpstream({ url, method: 'GET', timeoutMs: 30_000, maxBytes: 64 * 1024 * 1024 })`, requires a 2xx status and non-empty valid JSON, returns that JSON unchanged, and maps failures to the stable error envelope.

- [ ] **Step 4: Add bounded upstream request handling and safe summary logs**

The default `requestUpstream` must reject redirects, abort on timeout, stop reading after 64 MiB, and classify errors as `NETWORK_ERROR`, `HTTP_ERROR`, `RESPONSE_TOO_LARGE`, or `INVALID_RESPONSE`. Each route emits only:

```text
[ContentBackend] method=getContentGoodsDetails status=200 elapsedMs=123 bytes=456 code=OK
```

Tests must inject a collecting logger and assert no test URL query, response body, or fake token appears in log text.

- [ ] **Step 5: Run backend tests and verify GREEN**

Run `npm.cmd test` in the backend directory.

Expected: all batch contract, validation, error mapping, size-limit, timeout, and log-sanitization tests pass.

- [ ] **Step 6: Commit the backend task in its own repository**

Run from `C:\Users\User\Desktop\parametric-lab`:

```powershell
git add -- backend/app.js backend/server.js backend/package.json backend/test/content-api.test.js
git commit -m "feat: add batch content model backend API"
```

---

### Task 2: Harden Node model conversion to the C++ boundary

**Files:**
- Modify: `C:\Users\User\Desktop\parametric-lab\backend\app.js`
- Modify: `C:\Users\User\Desktop\parametric-lab\backend\test\content-api.test.js`

**Interfaces:**
- Consumes: `createApp({ requestUpstream, logger })` and the stable error envelope from Task 1.
- Produces: validated `POST /api/modelUrlToObj` with the existing successful response shape.

- [ ] **Step 1: Add failing model-conversion boundary tests**

Assert a valid request forwards exactly these flags and optional parameters:

```js
assert.deepEqual(JSON.parse(calls[0].body), {
  url: 'https://models.test/a.json',
  materialIdDedup: true,
  mergeGeometry: true,
  useCache: true,
  generateWireframe: false,
  checkSize: false,
  parameters: [{ name: '长度', value: 900 }],
});
```

Add 400 cases for non-HTTP(S) URLs, URLs over 8192 bytes, more than 64 parameters, empty/overlong names, non-numeric values, `NaN`-equivalent non-finite values at the validation-function level, and unexpected body properties. Add response tests for plain JSON and zstd JSON.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --test test/content-api.test.js
```

Expected: new strict-validation assertions fail against the current permissive route.

- [ ] **Step 3: Implement strict conversion validation and bounded forwarding**

Add a pure parser returning `{ url, parameters }`, build the existing conversion payload, then call:

```js
requestUpstream({
  url: 'https://beinuan.ke.com/mortise-api/parameter/modelUrlToObj',
  method: 'POST',
  body: JSON.stringify(upstreamPayload),
  headers: { 'Content-Type': 'application/json' },
  timeoutMs: 120_000,
  maxBytes: 64 * 1024 * 1024,
});
```

If the response begins with zstd magic `28 B5 2F FD`, decompress before JSON parsing. Return valid JSON only; malformed or oversized responses use the stable error envelope.

- [ ] **Step 4: Run all backend tests and verify GREEN**

Run `npm.cmd test` in the backend directory.

Expected: all tests pass with no open server handles.

- [ ] **Step 5: Commit the backend hardening**

Run from `C:\Users\User\Desktop\parametric-lab`:

```powershell
git add -- backend/app.js backend/test/content-api.test.js
git commit -m "fix: harden content model backend requests"
```

---

### Task 3: Switch standalone OCCT goods lookup to the batch endpoint

**Files:**
- Modify: `src/services/ParametricApiClient.js`
- Modify: `tests/parametric-api-client.test.js`

**Interfaces:**
- Consumes: `POST /api/getContentGoodsDetails` from Task 1.
- Preserves: `getGoodsDetails(resIds): Promise<{ items: object[] }>`.
- Preserves: CAD `hostClient.invoke('getContentGoodsDetails', { resIds }, { timeoutMs: 35_000 })`.

- [ ] **Step 1: Replace the old per-ID Demo tests with failing Node batch tests**

Assert 51 unique IDs produce two POST requests, with bodies of 50 and 1 IDs, and normalize the combined response in input order:

```js
assert.equal(calls[0].url, 'http://localhost:3100/api/getContentGoodsDetails');
assert.equal(calls[0].init.method, 'POST');
assert.deepEqual(JSON.parse(calls[0].init.body).resIds, ids.slice(0, 50));
```

Keep a partial-batch-failure test: one failed batch must not discard a successful batch; if every batch fails, throw the first transport error. Assert `getGoodsDetail()` still uses the existing single-detail endpoint.

- [ ] **Step 2: Run focused frontend tests and verify RED**

Run:

```powershell
node --test tests/parametric-api-client.test.js
```

Expected: FAIL because Node mode still sends one GET per ID.

- [ ] **Step 3: Implement Node batch POST without changing CAD mode**

Build batches before selecting transport, and use the same concurrency-three settled mapper for either transport:

```js
const responses = await mapSettledWithConcurrency(
  batches,
  GOODS_CONCURRENCY,
  batch => this.transport === 'cad'
    ? this.hostClient.invoke('getContentGoodsDetails', { resIds: batch }, { timeoutMs: GOODS_TIMEOUT_MS })
    : this.postJson(`${this.backendUrl}/api/getContentGoodsDetails`, { resIds: batch }),
);
```

Do not change response normalization, zstd decoding, transport selection, or model conversion behavior.

- [ ] **Step 4: Run focused and full OCCT tests**

Run:

```powershell
node --test tests/parametric-api-client.test.js tests/content-model-loader.test.js tests/content-model-scene-integration.test.js
npm.cmd test
```

Expected: focused tests pass; full suite has zero failures, with only documented environment-gated skips.

- [ ] **Step 5: Commit the OCCT transport change**

```powershell
git add -- src/services/ParametricApiClient.js tests/parametric-api-client.test.js
git commit -m "feat: batch standalone content model requests"
```

---

### Task 4: Standalone `Drawing2.json` end-to-end verification

**Files:**
- Modify only if a verified defect requires it: files named by the failing test or runtime trace.
- Update checklist: `docs/superpowers/plans/2026-07-28-occt-node-content-model-transport.md`

**Interfaces:**
- Consumes: backend at `http://localhost:3100`, OCCT production build, `dist-3d/data/Drawing2.json`.
- Produces: runtime evidence for parsed door count, batch lookup, resource paths, loader summary, and scene groups.

- [ ] **Step 1: Start the backend and verify health**

Start `npm.cmd start` in `C:\Users\User\Desktop\parametric-lab\backend`, then request `http://localhost:3100/health`.

Expected: HTTP 200 with `{ "status": "ok" }`.

- [ ] **Step 2: Run a live batch-details smoke request for Drawing2 door resources**

Use the OCCT template resolver to obtain unique door `resId` values, POST them once to `/api/getContentGoodsDetails`, and assert the response indexes at least one detail for every returned resource ID. Record only counts and error codes, never resource URLs.

- [ ] **Step 3: Build and serve OCCT production assets**

Run:

```powershell
npm.cmd run build:3d
```

Serve `dist-3d` locally and open `index-3d.html`. Confirm the standalone client reports transport `node` by observed HTTP requests, not by modifying production logs.

- [ ] **Step 4: Verify the full runtime chain**

Collect browser console evidence for:

- 15 normalized `door_list` instances;
- one or more `/api/getContentGoodsDetails` batch calls;
- static GLB loads and/or `/api/modelUrlToObj` conversions;
- `[ContentLoader] scene summary` with numeric `instances`, `staticLoaded`, `parametricLoaded`, `skipped`, and `failed`;
- no `[ContentLoader] scene pipeline failed` entry.

Inspect the Three.js scene read-only and confirm at least one placed group has `userData.sourceList === 'door_list'`, while the visible local door Box set remains empty.

- [ ] **Step 5: Run final verification**

Run backend tests, OCCT full tests, the production build, and whitespace validation:

```powershell
npm.cmd test
npm.cmd test
npm.cmd run build:3d
git diff --check
```

The first command runs in the backend directory; the remaining commands run in the OCCT worktree. Expected: both suites and the build exit 0, with no diff-check errors.

- [ ] **Step 6: Commit only evidence-driven source fixes, then stop for review**

If runtime verification exposed a source defect, add its regression test and commit only the OCCT/backend files fixing that defect. Do not deploy to CAD yet. Report exact loaded/skipped/failed counts and ask the user to approve the later CAD synchronization checkpoint.
