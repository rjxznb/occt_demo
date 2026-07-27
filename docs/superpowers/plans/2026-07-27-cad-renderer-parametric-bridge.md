# CAD Renderer Parametric Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep `occt_demo` independently runnable, migrate its latest compiled 3D/VR pages into the CAD plugin, and replace the CAD runtime dependency on the Node proxy with an asynchronous C++ WebView bridge.

**Architecture:** `ParametricModelLoader` delegates network work to a new `ParametricApiClient`. The client uses the existing Node proxy when the Demo runs as a top-level page and the existing `renderer-preview` iframe RPC protocol when hosted by CAD. CAD adds a narrowly scoped native bridge and a verified libcurl client for the two fixed upstream endpoints; zstd bodies cross the JSON-only bridge as Base64 and are decompressed in the compiled frontend.

**Tech Stack:** JavaScript ES modules, Node test runner, Vite 6, Three.js, fzstd 0.1.1, WebView2, C++17, libcurl, nlohmann/json, Visual Studio/MSBuild.

## Global Constraints

- `D:\occt_demo` remains a complete, independently runnable Demo.
- The CAD repository stores compiled 3D/VR static assets only; do not add `package.json`, Vite configuration, frontend source directories, or `node_modules` there.
- Do not create a source-sync or deployment script; copy the final artifacts manually during Task 7.
- The CAD runtime must never fall back to `localhost:3100` after a native bridge error.
- Do not change WebView2 CORS/security flags and do not disable TLS certificate or host-name verification.
- Do not implement the unused Node `/api/fetchJson` route in C++.
- Do not modify the generic `ui/window/bridge/k_web_bridge.cpp` implementation.
- Keep remote hosts and paths fixed in C++; do not expose an arbitrary URL proxy.
- Do not modify the CAD repository's pre-existing `README.md` working-tree change.
- Do not run `git add`, `git commit`, `git push`, or create a PR in `C:\Users\User\Desktop\cad_plugin`.
- OCCT changes may be committed task-by-task. CAD changes remain unstaged and uncommitted throughout.
- Before destructive resource replacement, resolve and verify each destination is a child of `C:\Users\User\Desktop\cad_plugin\build_resource\PluginResource\html\renderer` or the explicit active cache renderer directory.

---

## File Map

### OCCT files

- Create `src/core/RendererHostClient.js`: generic child-frame request/result transport for the existing `renderer-preview` protocol.
- Create `src/services/ParametricApiClient.js`: stable `getGoodsDetail` and `convertModel` API with Node/CAD transports and zstd decoding.
- Modify `src/components/ParametricModelLoader.js`: consume the API client and remove direct backend HTTP calls.
- Modify `package.json` and `package-lock.json`: add `fzstd@0.1.1` to the compiled frontend.
- Create `tests/renderer-host-client.test.js`: message pairing, timeout, origin/source checks, and disposal.
- Create `tests/parametric-api-client.test.js`: transport selection, no fallback, response parsing, and zstd envelope behavior.
- Create `tests/parametric-loader-api-boundary.test.js`: guard that the loader no longer embeds the Node endpoint or calls `fetch` directly.

### CAD files

- Create `common/Net/k_parametric_api_client.h/.cpp`: fixed-endpoint libcurl client and response-size enforcement.
- Create `ui/window/bridge/k_parametric_model_bridge.h/.cpp`: validation, async binding, response encoding, error mapping, and safe shutdown.
- Modify `ui/window/browser/k_render_preview_browser.cpp`: own/register/shutdown the parameter bridge.
- Modify `build_resource/PluginResource/html/renderer/render_preview.js`: add the two allowed native methods and preserve structured bridge errors.
- Modify `KeCADPlugin.vcxproj` and `KeCADPlugin.vcxproj.filters`: register the four new C++ files.
- Replace `build_resource/PluginResource/html/renderer/preview3d/**`: latest 3D compiled output.
- Replace `build_resource/PluginResource/html/renderer/preview-vr/**`: latest VR compiled output.

---

### Task 1: Record Baselines and Protect Both Working Trees

**Files:**
- Inspect: `D:\occt_demo`
- Inspect: `C:\Users\User\Desktop\cad_plugin`
- Inspect: `C:\Users\User\Desktop\parametric-lab\backend\server.js`

**Interfaces:**
- Consumes: approved design at `docs/superpowers/specs/2026-07-27-cad-renderer-parametric-bridge-design.md`.
- Produces: a recorded clean OCCT baseline and a CAD baseline showing the pre-existing `README.md` modification.

- [ ] **Step 1: Capture repository status and current revisions**

Run:

```powershell
git -C D:\occt_demo status --short --branch
git -C D:\occt_demo rev-parse HEAD
git -C C:\Users\User\Desktop\cad_plugin status --short --branch
git -C C:\Users\User\Desktop\cad_plugin rev-parse HEAD
```

Expected:

- OCCT is on `feat/parametric-3d-models` with no uncommitted implementation changes.
- CAD is on `develop_win_renderer` and reports only ` M README.md` before this feature begins.

- [ ] **Step 2: Run the OCCT baseline tests and build**

Run:

```powershell
npm test
npm run build:3d
```

Expected: all current Node tests pass and Vite creates `dist-3d/index-3d.html`, `dist-3d/index-vr.html`, and `dist-3d/assets`.

- [ ] **Step 3: Record the existing CAD resource manifest without changing it**

Run:

```powershell
Get-ChildItem -LiteralPath C:\Users\User\Desktop\cad_plugin\build_resource\PluginResource\html\renderer\preview3d -Recurse -File | ForEach-Object FullName
Get-ChildItem -LiteralPath C:\Users\User\Desktop\cad_plugin\build_resource\PluginResource\html\renderer\preview-vr -Recurse -File | ForEach-Object FullName
```

Expected: both directories contain only built HTML/assets/data files. Do not commit or stage anything in either repository during this task.

---

### Task 2: Add the Renderer Host RPC Client

**Files:**
- Create: `src/core/RendererHostClient.js`
- Create: `tests/renderer-host-client.test.js`

**Interfaces:**
- Consumes: existing message schema `{channel:'renderer-preview', version:1, tabId, type}`.
- Produces: `RendererHostClient`, with `isAvailable()`, `invoke(method, payload, options)`, and `dispose()`.
- Produces: singleton `rendererHostClient`, which is `null` when no browser `window` exists.

- [ ] **Step 1: Write the failing request/result test**

Create a fake child/parent pair in `tests/renderer-host-client.test.js` and assert exact protocol fields:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { RendererHostClient } from '../src/core/RendererHostClient.js';

class FakeWindow {
    constructor() {
        this.listeners = new Map();
        this.location = { origin: 'https://renderer.local' };
    }
    addEventListener(type, listener) {
        this.listeners.set(type, listener);
    }
    removeEventListener(type, listener) {
        if (this.listeners.get(type) === listener) this.listeners.delete(type);
    }
    setTimeout(callback, delay) {
        return setTimeout(callback, delay);
    }
    clearTimeout(timeoutId) {
        clearTimeout(timeoutId);
    }
    emitMessage(source, data, origin = 'https://renderer.local') {
        this.listeners.get('message')?.({ source, data, origin });
    }
}

test('invoke pairs a renderer-preview result with its request', async () => {
    const selfWindow = new FakeWindow();
    const sent = [];
    const parentWindow = {
        postMessage(message, targetOrigin) {
            sent.push({ message, targetOrigin });
        },
    };
    const client = new RendererHostClient({
        selfWindow,
        parentWindow,
        tabId: 'page-2',
        defaultTimeoutMs: 50,
    });

    const pending = client.invoke('getParametricGoodsDetail', { resId: '42' });
    const request = sent[0].message;
    assert.equal(request.channel, 'renderer-preview');
    assert.equal(request.version, 1);
    assert.equal(request.tabId, 'page-2');
    assert.equal(request.type, 'invoke');
    assert.equal(sent[0].targetOrigin, 'https://renderer.local');

    selfWindow.emitMessage(parentWindow, {
        channel: 'renderer-preview',
        version: 1,
        tabId: 'page-2',
        type: 'result',
        requestId: request.requestId,
        ok: true,
        payload: { data: { id: 42 } },
    });

    assert.deepEqual(await pending, { data: { id: 42 } });
    client.dispose();
});
```

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run:

```powershell
node --test tests/renderer-host-client.test.js
```

Expected: FAIL because `src/core/RendererHostClient.js` does not exist.

- [ ] **Step 3: Implement the protocol client**

Implement these constants and public signatures in `src/core/RendererHostClient.js`:

```js
const CHANNEL = 'renderer-preview';
const VERSION = 1;

export class RendererHostClient {
    constructor({
        selfWindow = globalThis.window,
        parentWindow = selfWindow?.parent,
        tabId = 'page-2',
        defaultTimeoutMs = 30_000,
    } = {}) {
        this.selfWindow = selfWindow;
        this.parentWindow = parentWindow;
        this.tabId = tabId;
        this.defaultTimeoutMs = defaultTimeoutMs;
        this.pending = new Map();
        this.sequence = 0;
        this.disposed = false;
        this.targetOrigin = selfWindow?.location?.origin || '*';
        this.handleMessage = this.handleMessage.bind(this);
        selfWindow?.addEventListener('message', this.handleMessage);
    }

    isAvailable() {
        return !this.disposed && !!this.selfWindow && !!this.parentWindow &&
            this.parentWindow !== this.selfWindow;
    }

    invoke(method, payload, { timeoutMs = this.defaultTimeoutMs } = {}) {
        if (!this.isAvailable()) {
            return Promise.reject(Object.assign(new Error('CAD host bridge is unavailable'), {
                code: 'BRIDGE_UNAVAILABLE',
            }));
        }
        const requestId = `${this.tabId}-${Date.now()}-${++this.sequence}`;
        return new Promise((resolve, reject) => {
            const timeoutId = this.selfWindow.setTimeout(() => {
                this.pending.delete(requestId);
                reject(Object.assign(new Error(`Native call timed out: ${method}`), {
                    code: 'TIMEOUT',
                }));
            }, timeoutMs);
            this.pending.set(requestId, { resolve, reject, timeoutId });
            this.parentWindow.postMessage({
                channel: CHANNEL,
                version: VERSION,
                tabId: this.tabId,
                type: 'invoke',
                requestId,
                method,
                payload,
            }, this.targetOrigin);
        });
    }

    handleMessage(event) {
        const message = event.data;
        if (event.source !== this.parentWindow || event.origin !== this.targetOrigin ||
            !message || message.channel !== CHANNEL || message.version !== VERSION ||
            message.tabId !== this.tabId || message.type !== 'result') return;
        const pending = this.pending.get(message.requestId);
        if (!pending) return;
        this.pending.delete(message.requestId);
        this.selfWindow.clearTimeout(pending.timeoutId);
        if (message.ok) {
            pending.resolve(message.payload);
            return;
        }
        const error = new Error(message.error?.message || 'Native call failed');
        error.code = message.error?.code || 'NATIVE_ERROR';
        error.status = message.error?.status;
        pending.reject(error);
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.selfWindow?.removeEventListener('message', this.handleMessage);
        for (const pending of this.pending.values()) {
            this.selfWindow.clearTimeout(pending.timeoutId);
            pending.reject(Object.assign(new Error('CAD host bridge disposed'), {
                code: 'CANCELLED',
            }));
        }
        this.pending.clear();
    }
}

export const rendererHostClient = typeof window === 'undefined'
    ? null
    : new RendererHostClient({ tabId: 'page-2' });
```

- [ ] **Step 4: Add failure-path tests**

Add a reusable harness and the three complete failure-path tests:

```js
function createHarness(defaultTimeoutMs = 50) {
    const selfWindow = new FakeWindow();
    const sent = [];
    const parentWindow = {
        postMessage(message, targetOrigin) {
            sent.push({ message, targetOrigin });
        },
    };
    const client = new RendererHostClient({
        selfWindow,
        parentWindow,
        tabId: 'page-2',
        defaultTimeoutMs,
    });
    return { selfWindow, parentWindow, sent, client };
}

test('ignores results from an unrelated source or origin', async () => {
    const { selfWindow, parentWindow, sent, client } = createHarness();
    const pending = client.invoke('getParametricGoodsDetail', { resId: '42' });
    const request = sent[0].message;
    const result = {
        channel: 'renderer-preview',
        version: 1,
        tabId: 'page-2',
        type: 'result',
        requestId: request.requestId,
        ok: true,
        payload: { data: { id: 42 } },
    };
    selfWindow.emitMessage({}, result);
    assert.equal(client.pending.size, 1);
    selfWindow.emitMessage(parentWindow, result, 'https://untrusted.invalid');
    assert.equal(client.pending.size, 1);
    selfWindow.emitMessage(parentWindow, result);
    assert.deepEqual(await pending, { data: { id: 42 } });
    client.dispose();
});

test('rejects timed out requests with TIMEOUT', async () => {
    const { client } = createHarness(5);
    await assert.rejects(
        client.invoke('getParametricGoodsDetail', { resId: '42' }),
        error => error.code === 'TIMEOUT',
    );
    assert.equal(client.pending.size, 0);
    client.dispose();
});

test('dispose rejects pending calls with CANCELLED and removes the listener', async () => {
    const { selfWindow, client } = createHarness();
    const pending = client.invoke('convertParametricModel', { url: 'https://model.test/a' });
    client.dispose();
    await assert.rejects(pending, error => error.code === 'CANCELLED');
    assert.equal(client.pending.size, 0);
    assert.equal(selfWindow.listeners.has('message'), false);
});
```

- [ ] **Step 5: Run the focused test and full suite**

Run:

```powershell
node --test tests/renderer-host-client.test.js
npm test
```

Expected: the focused file and all existing tests pass.

- [ ] **Step 6: Commit the OCCT task**

Run:

```powershell
git add -- src/core/RendererHostClient.js tests/renderer-host-client.test.js
git commit -m "feat: add renderer host rpc client"
```

Expected: one OCCT commit; CAD status remains unchanged.

---

### Task 3: Add the Parametric API Client and zstd Decoder

**Files:**
- Create: `src/services/ParametricApiClient.js`
- Create: `tests/parametric-api-client.test.js`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: `RendererHostClient.isAvailable()` and `RendererHostClient.invoke(method, payload, options)`.
- Produces: `ParametricApiClient.getGoodsDetail(resId): Promise<object>`.
- Produces: `ParametricApiClient.convertModel(url, parameters): Promise<object>`.
- Produces: singleton `parametricApiClient`.

- [ ] **Step 1: Install the browser-compatible zstd dependency**

Run:

```powershell
npm install --save fzstd@0.1.1
```

Expected: `package.json` and `package-lock.json` list exactly `fzstd` version range `^0.1.1` and resolved package version `0.1.1`.

- [ ] **Step 2: Write failing transport-selection tests**

Create `tests/parametric-api-client.test.js` with explicit fake host and fetch transports:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { ParametricApiClient } from '../src/services/ParametricApiClient.js';

test('top-level mode uses the Node goods endpoint', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 200, json: async () => ({ data: { id: 7 } }) };
    };
    const client = new ParametricApiClient({
        hostClient: null,
        fetchImpl,
        backendUrl: 'http://localhost:3100',
    });
    assert.deepEqual(await client.getGoodsDetail('7'), { data: { id: 7 } });
    assert.equal(calls[0].url, 'http://localhost:3100/api/getGoodsDetail?id=7');
});

test('embedded mode uses the host and never calls fetch', async () => {
    const hostCalls = [];
    const hostClient = {
        isAvailable: () => true,
        invoke: async (method, payload, options) => {
            hostCalls.push({ method, payload, options });
            return { data: { id: 8 } };
        },
    };
    const client = new ParametricApiClient({
        hostClient,
        fetchImpl: async () => { throw new Error('fetch must not run'); },
    });
    assert.deepEqual(await client.getGoodsDetail('8'), { data: { id: 8 } });
    assert.equal(hostCalls[0].method, 'getParametricGoodsDetail');
    assert.deepEqual(hostCalls[0].payload, { resId: '8' });
});
```

- [ ] **Step 3: Run the focused test and verify it fails**

Run:

```powershell
node --test tests/parametric-api-client.test.js
```

Expected: FAIL because `ParametricApiClient.js` does not exist.

- [ ] **Step 4: Implement the stable API and fixed transport choice**

Implement `src/services/ParametricApiClient.js` with these constants and constructor rules:

```js
import { decompress } from 'fzstd';
import { rendererHostClient } from '../core/RendererHostClient.js';

const DEFAULT_BACKEND_URL = 'http://localhost:3100';
const GOODS_TIMEOUT_MS = 35_000;
const MODEL_TIMEOUT_MS = 130_000;
const MAX_DECOMPRESSED_BYTES = 128 * 1024 * 1024;

export class ParametricApiClient {
    constructor({
        hostClient = rendererHostClient,
        fetchImpl = globalThis.fetch?.bind(globalThis),
        backendUrl = DEFAULT_BACKEND_URL,
        decompressImpl = decompress,
    } = {}) {
        this.hostClient = hostClient;
        this.fetchImpl = fetchImpl;
        this.backendUrl = backendUrl.replace(/\/$/, '');
        this.decompressImpl = decompressImpl;
        this.transport = hostClient?.isAvailable() ? 'cad' : 'node';
    }

    async getGoodsDetail(resId) {
        const normalized = String(resId ?? '').trim();
        if (!normalized) throw createError('INVALID_ARGUMENT', 'resId is required');
        if (this.transport === 'cad') {
            return parsePossibleJson(await this.hostClient.invoke(
                'getParametricGoodsDetail',
                { resId: normalized },
                { timeoutMs: GOODS_TIMEOUT_MS },
            ));
        }
        return this.fetchJson(
            `${this.backendUrl}/api/getGoodsDetail?id=${encodeURIComponent(normalized)}`,
        );
    }

    async convertModel(url, parameters = []) {
        const payload = { url: String(url ?? '').trim() };
        if (!payload.url) throw createError('INVALID_ARGUMENT', 'model url is required');
        if (Array.isArray(parameters) && parameters.length) payload.parameters = parameters;
        const raw = this.transport === 'cad'
            ? await this.hostClient.invoke('convertParametricModel', payload, {
                timeoutMs: MODEL_TIMEOUT_MS,
            })
            : await this.postJson(`${this.backendUrl}/api/modelUrlToObj`, payload);
        return decodeModelResponse(raw, this.decompressImpl);
    }
}

export const parametricApiClient = new ParametricApiClient();
```

Also implement these internal rules in the same file:

- `fetchJson` and `postJson` throw `HTTP_ERROR` with `status` when `response.ok` is false.
- `parsePossibleJson` accepts an object or parses a JSON string; invalid strings throw `INVALID_RESPONSE`.
- `base64ToBytes` uses `atob`, copies characters into `Uint8Array`, and rejects malformed input as `DECOMPRESSION_ERROR`.
- `decodeModelResponse` detects `{encoding:'zstd-base64', body:string}`, calls `decompressImpl`, rejects output over `MAX_DECOMPRESSED_BYTES`, decodes UTF-8, strips one leading BOM, and parses JSON.
- All locally created errors contain `.code`; HTTP errors additionally contain `.status`.

- [ ] **Step 5: Add no-fallback and compressed-envelope tests**

Add these concrete cases:

```js
test('CAD failure is returned without falling back to Node', async () => {
    let fetchCount = 0;
    const client = new ParametricApiClient({
        hostClient: {
            isAvailable: () => true,
            invoke: async () => { throw Object.assign(new Error('offline'), { code: 'NETWORK_ERROR' }); },
        },
        fetchImpl: async () => { fetchCount += 1; },
    });
    await assert.rejects(client.getGoodsDetail('9'), { code: 'NETWORK_ERROR' });
    assert.equal(fetchCount, 0);
});

test('zstd-base64 envelope is decoded before JSON parsing', async () => {
    const expected = { obj: 'v 0 0 0\n'.repeat(20) };
    const encoded = Buffer.from([1, 2, 3, 4]).toString('base64');
    const client = new ParametricApiClient({
        hostClient: {
            isAvailable: () => true,
            invoke: async () => ({ encoding: 'zstd-base64', body: encoded }),
        },
        decompressImpl: bytes => {
            assert.deepEqual([...bytes], [1, 2, 3, 4]);
            return new TextEncoder().encode(JSON.stringify(expected));
        },
    });
    assert.deepEqual(await client.convertModel('https://model.test/a.json'), expected);
});
```

Add these concrete tests for `HTTP_ERROR`, `INVALID_RESPONSE`, and `DECOMPRESSION_ERROR`:

```js
test('non-2xx Node response becomes HTTP_ERROR with status', async () => {
    const client = new ParametricApiClient({
        hostClient: null,
        fetchImpl: async () => ({ ok: false, status: 503 }),
    });
    await assert.rejects(
        client.getGoodsDetail('10'),
        error => error.code === 'HTTP_ERROR' && error.status === 503,
    );
});

test('malformed host JSON becomes INVALID_RESPONSE', async () => {
    const client = new ParametricApiClient({
        hostClient: {
            isAvailable: () => true,
            invoke: async () => '{broken-json',
        },
    });
    await assert.rejects(
        client.getGoodsDetail('10'),
        error => error.code === 'INVALID_RESPONSE',
    );
});

test('decoder failure becomes DECOMPRESSION_ERROR', async () => {
    const client = new ParametricApiClient({
        hostClient: {
            isAvailable: () => true,
            invoke: async () => ({
                encoding: 'zstd-base64',
                body: Buffer.from([1, 2, 3]).toString('base64'),
            }),
        },
        decompressImpl: () => { throw new Error('invalid frame'); },
    });
    await assert.rejects(
        client.convertModel('https://model.test/a.json'),
        error => error.code === 'DECOMPRESSION_ERROR',
    );
});
```

- [ ] **Step 6: Run focused tests, full tests, and the production build**

Run:

```powershell
node --test tests/parametric-api-client.test.js
npm test
npm run build:3d
```

Expected: all tests pass; the generated assets include the `fzstd` decoder without requiring an external runtime script.

- [ ] **Step 7: Commit the OCCT task**

Run:

```powershell
git add -- package.json package-lock.json src/services/ParametricApiClient.js tests/parametric-api-client.test.js
git commit -m "feat: add parametric api transports"
```

Expected: one OCCT commit; no CAD files are staged.

---

### Task 4: Route ParametricModelLoader Through the API Boundary

**Files:**
- Modify: `src/components/ParametricModelLoader.js:1-13,177-213,318-408,423-424,558`
- Create: `tests/parametric-loader-api-boundary.test.js`

**Interfaces:**
- Consumes: `parametricApiClient.getGoodsDetail(resId)` and `parametricApiClient.convertModel(url, parameters)`.
- Produces: unchanged public model-loader exports and an optional `options.apiClient` test seam on `loadParametricModels`.

- [ ] **Step 1: Write a failing source-boundary test**

Create `tests/parametric-loader-api-boundary.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('ParametricModelLoader delegates API traffic to ParametricApiClient', async () => {
    const source = await readFile(
        new URL('../src/components/ParametricModelLoader.js', import.meta.url),
        'utf8',
    );
    assert.match(source, /parametricApiClient/);
    assert.match(source, /apiClient\.getGoodsDetail/);
    assert.match(source, /apiClient\.convertModel/);
    assert.doesNotMatch(source, /localhost:3100/);
    assert.doesNotMatch(source, /fetch\s*\(/);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
node --test tests/parametric-loader-api-boundary.test.js
```

Expected: FAIL because the loader still owns `BACKEND_URL` and direct `fetch` calls.

- [ ] **Step 3: Replace direct HTTP helpers with client calls**

At the top of `ParametricModelLoader.js`, add:

```js
import { parametricApiClient } from '../services/ParametricApiClient.js';
```

Delete `BACKEND_URL`, `fetchGoodsDetail`, and `fetchModelObj`. Change the internal signatures to pass one selected client through the whole operation:

```js
async function resolveParametricUrl(typeId, apiClient) {
    const detail = await apiClient.getGoodsDetail(entry.resId);
}

async function fetchModelForTypeId(typeId, modelParams, apiClient) {
    const url = await resolveParametricUrl(tid, apiClient);
    const result = await apiClient.convertModel(url, modelParams);
}

export async function loadParametricModels(softlists, sceneGroup, options = {}) {
    const {
        concurrency = 3,
        onProgress = null,
        apiClient = parametricApiClient,
    } = options;
}
```

Update both URL-resolution batches and per-instance model loading to pass the same `apiClient`. Preserve existing URL/model cache keys, concurrency, transforms, and debug metadata.

- [ ] **Step 4: Normalize model-specific error logging**

Use one structured log shape without printing remote response bodies:

```js
console.error(`${LOG_PREFIX} TypeId=${tid} ResId=${resId} 参数化失败`, {
    code: err.code || 'UNKNOWN_ERROR',
    status: err.status,
    message: err.message,
});
```

Replace the final warning that tells users to start `localhost:3100` with a transport-neutral message covering template matching and parameterized service availability.

- [ ] **Step 5: Run boundary, regression, and build verification**

Run:

```powershell
node --test tests/parametric-loader-api-boundary.test.js
npm test
npm run build:3d
```

Expected: all existing orientation, anchor, debug-info, and scene-click tests remain green; the production build succeeds.

- [ ] **Step 6: Verify the standalone Demo against Node**

Start the known Node backend in its own terminal from `C:\Users\User\Desktop\parametric-lab\backend`:

```powershell
npm start
```

Start the Demo from `D:\occt_demo`:

```powershell
npm run dev:3d
```

Open `http://localhost:3030/index-3d.html`. Expected: parameterized models load, model clicks still log TypeId/debug metadata, and repeated room clicks still toggle the size panel.

- [ ] **Step 7: Commit the OCCT task**

Run:

```powershell
git add -- src/components/ParametricModelLoader.js tests/parametric-loader-api-boundary.test.js
git commit -m "refactor: isolate parametric model transport"
```

Expected: one OCCT commit. Stop only the Node/Vite processes started in Step 6; do not terminate unrelated processes.

---

### Task 5: Extend the Existing Renderer-Preview RPC Allowlist

**Files:**
- Modify: `C:\Users\User\Desktop\cad_plugin\build_resource\PluginResource\html\renderer\render_preview.js:17-28,158-171,327-355`

**Interfaces:**
- Consumes: child methods `getParametricGoodsDetail` and `convertParametricModel`.
- Produces: native calls `window.getParametricGoodsDetail(resId)` and `window.convertParametricModel(requestJson)`.
- Produces: structured `{code,message,status}` errors returned to the requesting iframe.

- [ ] **Step 1: Record CAD status immediately before the first CAD edit**

Run:

```powershell
git -C C:\Users\User\Desktop\cad_plugin status --short
```

Expected: only the pre-existing ` M README.md` appears.

- [ ] **Step 2: Add exact payload validators to `NATIVE_METHODS`**

Add these descriptors after `getRenderPreviewContext`:

```js
getParametricGoodsDetail: Object.freeze({
  bridgeName: 'getParametricGoodsDetail',
  createArgs: function (payload) {
    if (!isRecord(payload) || typeof payload.resId !== 'string' ||
        !payload.resId.trim() || payload.resId.length > 128) {
      throw createProtocolError('INVALID_ARGUMENT', 'resId 参数无效');
    }
    return [payload.resId.trim()];
  }
}),
convertParametricModel: Object.freeze({
  bridgeName: 'convertParametricModel',
  createArgs: function (payload) {
    if (!isRecord(payload) || typeof payload.url !== 'string' ||
        !payload.url.trim() || payload.url.length > 8192 ||
        (payload.parameters !== undefined && !Array.isArray(payload.parameters))) {
      throw createProtocolError('INVALID_ARGUMENT', '模型转换参数无效');
    }
    return [JSON.stringify(payload)];
  }
})
```

- [ ] **Step 3: Parse native success values and preserve native error codes**

Change `invokeNative` to parse JSON returned by the bridge:

```js
var args = descriptor.createArgs(payload);
return parsePossibleJson(await bridgeMethod.apply(window, args));
```

Replace `errorPayload` with logic that parses a JSON string carried in `error.message`, then returns:

```js
return {
  code: parsed.code ? String(parsed.code) : 'NATIVE_ERROR',
  message: parsed.message ? String(parsed.message) : '宿主方法调用失败',
  status: Number.isFinite(Number(parsed.status)) ? Number(parsed.status) : undefined
};
```

If parsing fails, use the original `error.code` and `error.message`.

- [ ] **Step 4: Run a JavaScript syntax check**

Run:

```powershell
node --check C:\Users\User\Desktop\cad_plugin\build_resource\PluginResource\html\renderer\render_preview.js
```

Expected: exit code 0 with no syntax error.

- [ ] **Step 5: Verify the CAD diff remains isolated and do not commit**

Run:

```powershell
git -C C:\Users\User\Desktop\cad_plugin diff --check
git -C C:\Users\User\Desktop\cad_plugin status --short
```

Expected: `README.md` plus `render_preview.js` are modified. Do not stage or commit them.

---

### Task 6: Implement the Fixed-Endpoint Native HTTP Client

**Files:**
- Create: `C:\Users\User\Desktop\cad_plugin\common\Net\k_parametric_api_client.h`
- Create: `C:\Users\User\Desktop\cad_plugin\common\Net\k_parametric_api_client.cpp`
- Modify: `C:\Users\User\Desktop\cad_plugin\KeCADPlugin.vcxproj`
- Modify: `C:\Users\User\Desktop\cad_plugin\KeCADPlugin.vcxproj.filters`

**Interfaces:**
- Produces: `ke_plugin::KParametricParameter { std::string name; double value; }`.
- Produces: `ke_plugin::KParametricApiResult` containing `ok`, `http_status`, `body`, `error_code`, `error_message`, and `is_zstd`.
- Produces: `KParametricApiClient::GetGoodsDetail(res_id)` and `KParametricApiClient::ConvertModel(model_url, parameters)`.

- [ ] **Step 1: Declare the network-only API**

Create `k_parametric_api_client.h` with this public contract:

```cpp
#pragma once

#include <string>
#include <vector>

#include "ke_common_def.h"

NAMESPACE_KE_PLUGIN_BEGIN

struct KParametricParameter {
  std::string name;
  double value = 0.0;
};

struct KParametricApiResult {
  bool ok = false;
  long http_status = 0;
  std::vector<unsigned char> body;
  std::string error_code;
  std::string error_message;
  bool is_zstd = false;
};

class KParametricApiClient {
 public:
  KParametricApiResult GetGoodsDetail(const std::string& res_id) const;
  KParametricApiResult ConvertModel(
      const std::string& model_url,
      const std::vector<KParametricParameter>& parameters) const;
};

NAMESPACE_KE_PLUGIN_END
```

- [ ] **Step 2: Implement a bounded binary response callback**

In `k_parametric_api_client.cpp`, define exact limits:

```cpp
constexpr size_t kMaxResponseBytes = 64u * 1024u * 1024u;
constexpr long kConnectTimeoutSeconds = 10L;
constexpr long kGoodsTimeoutSeconds = 30L;
constexpr long kModelTimeoutSeconds = 120L;

struct ResponseBuffer {
  std::vector<unsigned char> bytes;
  bool overflow = false;
};

size_t WriteResponse(void* data, size_t size, size_t count, void* user_data) {
  const size_t byte_count = size * count;
  auto* buffer = static_cast<ResponseBuffer*>(user_data);
  if (!buffer || byte_count > kMaxResponseBytes - buffer->bytes.size()) {
    if (buffer) buffer->overflow = true;
    return 0;
  }
  const auto* begin = static_cast<const unsigned char*>(data);
  buffer->bytes.insert(buffer->bytes.end(), begin, begin + byte_count);
  return byte_count;
}
```

Detect zstd only when the first four bytes equal `28 B5 2F FD`.

- [ ] **Step 3: Implement the common curl request path**

Use one fresh easy handle per request. Set all of these options explicitly:

```cpp
curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
curl_easy_setopt(curl, CURLOPT_PROTOCOLS, CURLPROTO_HTTP | CURLPROTO_HTTPS);
curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 0L);
curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, kConnectTimeoutSeconds);
curl_easy_setopt(curl, CURLOPT_TIMEOUT, total_timeout_seconds);
curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 1L);
curl_easy_setopt(curl, CURLOPT_SSL_VERIFYHOST, 2L);
curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteResponse);
curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);
curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);
```

After `curl_easy_perform`, read `CURLINFO_RESPONSE_CODE`. Map:

- response overflow to `RESPONSE_TOO_LARGE`;
- other curl failures to `NETWORK_ERROR` using `curl_easy_strerror`;
- non-2xx status to `HTTP_ERROR` without returning the upstream body to logs;
- empty 2xx body to `INVALID_RESPONSE`;
- valid 2xx body to `ok=true` and `is_zstd` based on the magic bytes.

Always free the header list and easy handle on every return path.

- [ ] **Step 4: Implement the two fixed requests**

`GetGoodsDetail` must URL-escape only `res_id`, then call:

```text
http://i.bim-zeus.home.ke.com/api/resGoods/getGoodsDetailById?id=<escaped-id>
```

`ConvertModel` must always POST to:

```text
https://beinuan.ke.com/mortise-api/parameter/modelUrlToObj
```

Build this JSON body with nlohmann/json:

```json
{
  "url": "<model_url>",
  "materialIdDedup": true,
  "mergeGeometry": true,
  "useCache": true,
  "generateWireframe": false,
  "checkSize": false,
  "parameters": [
    { "name": "宽度", "value": 1200.0 }
  ]
}
```

Omit `parameters` when the vector is empty. Send `Content-Type: application/json` and set `CURLOPT_POSTFIELDSIZE` from the exact UTF-8 byte count.

- [ ] **Step 5: Register the new files in the Visual Studio project**

Add one `ClCompile` entry for `common\Net\k_parametric_api_client.cpp` next to `ke_curl_wrapper.cpp`, and one `ClInclude` entry for its header next to `ke_curl_wrapper.h`. Mirror those paths in `KeCADPlugin.vcxproj.filters` under the same `common\Net` filter used by the existing curl wrapper.

- [ ] **Step 6: Compile Debug x64**

From a Visual Studio developer shell, run:

```powershell
msbuild C:\Users\User\Desktop\cad_plugin\KeCADPlugin.sln /m /p:Configuration=Debug /p:Platform=x64
```

Expected: `Build succeeded`, with no unresolved curl/json symbols and no new warnings in the new client files.

- [ ] **Step 7: Inspect the uncommitted CAD diff**

Run:

```powershell
git -C C:\Users\User\Desktop\cad_plugin diff --check
git -C C:\Users\User\Desktop\cad_plugin status --short
```

Expected: the two new network files and project entries appear in addition to Task 5 and the pre-existing `README.md`. Do not stage or commit.

---

### Task 7: Implement the Async Parametric Bridge and Safe Shutdown

**Files:**
- Create: `C:\Users\User\Desktop\cad_plugin\ui\window\bridge\k_parametric_model_bridge.h`
- Create: `C:\Users\User\Desktop\cad_plugin\ui\window\bridge\k_parametric_model_bridge.cpp`
- Modify: `C:\Users\User\Desktop\cad_plugin\ui\window\browser\k_render_preview_browser.cpp:16,63,82,191-214,290-319`
- Modify: `C:\Users\User\Desktop\cad_plugin\KeCADPlugin.vcxproj`
- Modify: `C:\Users\User\Desktop\cad_plugin\KeCADPlugin.vcxproj.filters`

**Interfaces:**
- Consumes: `KWebBridge::BindAsync` and `KWebBridge::CallJsCallback`.
- Consumes: `KParametricApiClient` from Task 6.
- Produces: `KParametricModelBridge(KWebBridge&)`, `Register()`, and `Shutdown()`.
- Produces native WebView methods `getParametricGoodsDetail` and `convertParametricModel`.

- [ ] **Step 1: Define bridge ownership and lifecycle**

Create the header with an opaque shared state:

```cpp
#pragma once

#include <memory>
#include <string>

namespace ke_web {

class KWebBridge;

class KParametricModelBridge {
 public:
  explicit KParametricModelBridge(KWebBridge& bridge);
  ~KParametricModelBridge();

  KParametricModelBridge(const KParametricModelBridge&) = delete;
  KParametricModelBridge& operator=(const KParametricModelBridge&) = delete;

  void Register();
  void Shutdown();

 private:
  struct SharedState;
  static void ResolveIfActive(const std::shared_ptr<SharedState>& state,
                              const std::string& callback_id,
                              int status,
                              const std::string& json_result);
  std::shared_ptr<SharedState> state_;
};

}  // namespace ke_web
```

`SharedState` contains a mutex, `bool active`, and `KWebBridge* bridge`. `Shutdown()` locks the mutex, sets `active=false`, and sets `bridge=nullptr`. Every async callback captures only `std::shared_ptr<SharedState>`, not a browser or controller `this` pointer.

- [ ] **Step 2: Implement authoritative input validation**

For `getParametricGoodsDetail` reject unless there is exactly one argument and it is 1–128 characters.

For `convertParametricModel`, parse exactly one JSON argument and enforce:

```text
url: non-empty string, at most 8192 bytes, prefix http:// or https://
parameters: absent or array, at most 64 entries
parameter.name: non-empty string, at most 128 UTF-8 bytes
parameter.value: JSON number and std::isfinite(value)
serialized request: at most 65536 bytes
```

Return validation failures with status `-1` and this JSON shape:

```json
{"code":"INVALID_ARGUMENT","message":"模型转换参数无效","status":0}
```

- [ ] **Step 3: Implement bridge-safe success and failure callbacks**

Implement the private static member declared in Step 1. It holds the shared-state mutex while checking and invoking the bridge:

```cpp
void KParametricModelBridge::ResolveIfActive(
    const std::shared_ptr<SharedState>& state,
    const std::string& callback_id,
    int status,
    const std::string& json_result) {
  std::lock_guard<std::mutex> lock(state->mutex);
  if (!state->active || !state->bridge) return;
  state->bridge->CallJsCallback(callback_id, status, json_result);
}
```

The two `BindAsync` lambdas must wrap their complete body in `try/catch (...)` and always call `ResolveIfActive`; they must never allow an exception to escape into `KWebBridge`'s detached wrapper.

Map `KParametricApiResult` errors to:

```json
{"code":"NETWORK_ERROR","message":"参数化服务请求失败","status":0}
```

Use the client's exact `error_code` and `http_status`; do not include the upstream response body.

- [ ] **Step 4: Encode successful responses**

For non-zstd responses:

- convert bytes to UTF-8 text;
- strip one UTF-8 BOM if present;
- parse with nlohmann/json;
- return `parsed.dump()` with callback status `0`;
- return `INVALID_RESPONSE` if parsing fails.

For zstd responses, reuse `ke_string_util::base64_encode(result.body)` and return:

```json
{"encoding":"zstd-base64","body":"<base64>"}
```

Do not log the Base64 body or decoded model JSON.

Measure each async operation with `std::chrono::steady_clock` and emit one `OutputDebugStringA` summary after completion. The summary contains only method name, HTTP status, elapsed milliseconds, response byte count, and error code:

```text
[ParametricBridge] method=convertParametricModel status=200 elapsedMs=842 bytes=153812 code=OK
```

When `ResolveIfActive` suppresses a result because the bridge is inactive, emit only:

```text
[ParametricBridge] code=CANCELLED callback suppressed
```

- [ ] **Step 5: Register and shut down the controller in the render browser**

Add:

```cpp
#include "window/bridge/k_parametric_model_bridge.h"
```

Add the member after `bridge_`:

```cpp
std::unique_ptr<KParametricModelBridge> parametric_bridge_;
```

At the end of `InitializeBridge()`:

```cpp
parametric_bridge_ = std::make_unique<KParametricModelBridge>(*bridge_);
parametric_bridge_->Register();
```

At the start of the existing `if (bridge_)` teardown block, before `ClearBindings()`:

```cpp
if (parametric_bridge_) {
  parametric_bridge_->Shutdown();
  parametric_bridge_.reset();
}
```

- [ ] **Step 6: Register the bridge files in Visual Studio**

Add `ClCompile`/`ClInclude` entries for `ui\window\bridge\k_parametric_model_bridge.cpp/.h` next to `k_web_bridge.cpp/.h` in both the project and filters files.

- [ ] **Step 7: Compile Debug and Release x64**

Run from a Visual Studio developer shell:

```powershell
msbuild C:\Users\User\Desktop\cad_plugin\KeCADPlugin.sln /m /p:Configuration=Debug /p:Platform=x64
msbuild C:\Users\User\Desktop\cad_plugin\KeCADPlugin.sln /m /p:Configuration=Release /p:Platform=x64
```

Expected: both builds succeed; `SharedState` remains private and all callback paths compile through the private static `ResolveIfActive` member.

- [ ] **Step 8: Verify no generic bridge or unrelated files changed**

Run:

```powershell
git -C C:\Users\User\Desktop\cad_plugin diff -- ui/window/bridge/k_web_bridge.cpp
git -C C:\Users\User\Desktop\cad_plugin status --short
```

Expected: the first command prints nothing. The second lists only `README.md`, the files from Tasks 5–7, project metadata, and no staged changes.

---

### Task 8: Build and Manually Replace CAD 3D/VR Static Assets

**Files:**
- Read build output: `D:\occt_demo\dist-3d`
- Replace: `C:\Users\User\Desktop\cad_plugin\build_resource\PluginResource\html\renderer\preview3d`
- Replace: `C:\Users\User\Desktop\cad_plugin\build_resource\PluginResource\html\renderer\preview-vr`
- Replace active cache copies under `C:\Users\User\AppData\Local\ke_arx_cache\2021\PluginResource\html\renderer` when that directory exists.

**Interfaces:**
- Consumes: the built OCCT entry pages and assets.
- Produces: CAD static apps that invoke the native host transport and contain no runtime dependency on npm or Vite.

- [ ] **Step 1: Run the final OCCT automated verification and build**

Run:

```powershell
npm test
npm run build:3d
```

Expected: all tests pass and Vite exits successfully.

- [ ] **Step 2: Verify every referenced build asset exists before copying**

Run:

```powershell
$buildRoot = 'D:\occt_demo\dist-3d'
$entries = @('index-3d.html', 'index-vr.html')
foreach ($entry in $entries) {
  $entryPath = Join-Path $buildRoot $entry
  if (-not (Test-Path -LiteralPath $entryPath)) { throw "Missing entry: $entryPath" }
}
if (-not (Test-Path -LiteralPath (Join-Path $buildRoot 'assets'))) {
  throw 'Missing dist-3d assets directory'
}
if (-not (Test-Path -LiteralPath (Join-Path $buildRoot 'data\Drawing2.json'))) {
  throw 'Missing Drawing2.json'
}
```

Expected: no exception.

- [ ] **Step 3: Resolve and validate the two CAD repository destinations**

Run:

```powershell
$rendererRoot = (Resolve-Path -LiteralPath 'C:\Users\User\Desktop\cad_plugin\build_resource\PluginResource\html\renderer').Path
$preview3d = Join-Path $rendererRoot 'preview3d'
$previewVr = Join-Path $rendererRoot 'preview-vr'
foreach ($target in @($preview3d, $previewVr)) {
  $full = [IO.Path]::GetFullPath($target)
  if (-not $full.StartsWith($rendererRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsafe renderer target: $full"
  }
}
```

Expected: both full paths remain under the explicit renderer root.

- [ ] **Step 4: Replace `preview3d` and `preview-vr` without adding a script file**

Use native PowerShell operations after Step 3 succeeds:

```powershell
foreach ($app in @(
  @{ Entry = 'index-3d.html'; Target = $preview3d },
  @{ Entry = 'index-vr.html'; Target = $previewVr }
)) {
  Remove-Item -LiteralPath $app.Target -Recurse -Force
  New-Item -ItemType Directory -Path (Join-Path $app.Target 'data') -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $buildRoot 'assets') -Destination (Join-Path $app.Target 'assets') -Recurse
  Copy-Item -LiteralPath (Join-Path $buildRoot $app.Entry) -Destination (Join-Path $app.Target 'index.html')
  Copy-Item -LiteralPath (Join-Path $buildRoot 'data\Drawing2.json') -Destination (Join-Path $app.Target 'data\Drawing2.json')
  Copy-Item -LiteralPath (Join-Path $buildRoot 'data\templates') -Destination (Join-Path $app.Target 'data\templates') -Recurse
}
```

This is a one-time manual operation, not a checked-in deploy script.

- [ ] **Step 5: Refresh the active AutoCAD 2021 cache when present**

Resolve `C:\Users\User\AppData\Local\ke_arx_cache\2021\PluginResource\html\renderer` and repeat the exact child-path validation from Step 3 before replacing its `preview3d`, `preview-vr`, and top-level `render_preview.js`. If the cache root does not exist, skip this step and let the plugin's normal resource extraction populate it.

- [ ] **Step 6: Verify asset references and absence of source tooling**

Run:

```powershell
rg -n "localhost:3100" C:\Users\User\Desktop\cad_plugin\build_resource\PluginResource\html\renderer\preview3d C:\Users\User\Desktop\cad_plugin\build_resource\PluginResource\html\renderer\preview-vr
Get-ChildItem -LiteralPath C:\Users\User\Desktop\cad_plugin\build_resource\PluginResource\html\renderer\preview3d -Recurse -File -Filter package.json
Get-ChildItem -LiteralPath C:\Users\User\Desktop\cad_plugin\build_resource\PluginResource\html\renderer\preview-vr -Recurse -File -Filter package.json
```

Expected: `localhost:3100` may exist inside the bundle only as the intentionally retained standalone transport constant, but runtime selection in CAD is host-only; no `package.json` is present in either CAD app directory. Confirm every `<script src>` and `<link href>` in each `index.html` resolves to an existing file.

- [ ] **Step 7: Audit CAD status without staging or committing**

Run:

```powershell
git -C C:\Users\User\Desktop\cad_plugin diff --check
git -C C:\Users\User\Desktop\cad_plugin status --short
git -C C:\Users\User\Desktop\cad_plugin diff -- README.md
```

Expected: the original `README.md` diff remains untouched; new C++, bridge, project, top-level JS, and static resource changes are visible and unstaged.

---

### Task 9: End-to-End CAD Verification Without Node

**Files:**
- Verify: CAD Debug/Release outputs.
- Verify: CAD WebView resources and runtime console.
- Verify: `D:\occt_demo\dist-3d\data\Drawing2.json` through the migrated CAD pages.

**Interfaces:**
- Consumes: completed frontend transport, native HTTP client, native bridge, and migrated static assets.
- Produces: evidence that CAD operates without Node and preserves rendering/interaction behavior.

- [ ] **Step 1: Confirm the Node backend is not listening**

Run:

```powershell
Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue
```

Expected: no listener. If a process started during Task 4 is still running, stop only that known process and repeat the check.

- [ ] **Step 2: Rebuild the final CAD Debug and Release binaries**

Run from a Visual Studio developer shell:

```powershell
msbuild C:\Users\User\Desktop\cad_plugin\KeCADPlugin.sln /m /p:Configuration=Debug /p:Platform=x64
msbuild C:\Users\User\Desktop\cad_plugin\KeCADPlugin.sln /m /p:Configuration=Release /p:Platform=x64
```

Expected: both builds succeed with zero errors.

- [ ] **Step 3: Load the Debug plugin and open Render Preview**

Use the CAD project's existing visible-load workflow and open the 渲染预览 window. Select the 3D tab and keep the developer console open.

Expected:

- no request is made to `localhost:3100`;
- `getParametricGoodsDetail` and `convertParametricModel` resolve through the native bridge;
- room, wall, door, window, and soft-list rendering continues while requests are pending;
- CAD commands and viewport interaction remain responsive.

- [ ] **Step 4: Verify the required 3D model behavior**

Using `Drawing2.json`, inspect every parameterized soft model from top, perspective, and side views. Expected:

- every model is upright rather than lying on the floor;
- model placement follows `basepoint`/footprint anchoring;
- `BlockInnerInfo` rotation, horizontal flip, and vertical flip match the top-view 2D intent;
- clicking a model logs TypeId, ResId, transform, footprint/basepoint, and model parameter metadata;
- the log never includes the complete OBJ, Base64 response, Cookie, or signed query content.

- [ ] **Step 5: Verify room dialog and 3D/VR lifecycle regressions**

Expected interaction sequence:

1. Click room A: one size dialog appears.
2. Click room A again: its dialog disappears.
3. Click room A, then room B: A disappears and only B remains.
4. Switch from 3D to VR: the 3D render loop pauses and VR becomes interactive.
5. Switch back to 3D: the scene resumes without duplicate loops or duplicate dialogs.

- [ ] **Step 6: Verify shutdown during an in-flight request**

Open Render Preview, trigger initial parameterized loading, and close the preview before all models finish. Reopen it after five seconds.

Expected: no CAD crash, access violation, WebView error dialog, stale callback, or result from the prior page instance. The reopened page loads normally.

- [ ] **Step 7: Verify offline/upstream failure isolation**

On the test machine, temporarily disconnect network access, open the 3D preview, and restore network access after the failure appears.

Expected:

- native calls reject as `NETWORK_ERROR` or `TIMEOUT`;
- the page does not attempt `localhost:3100`;
- room/wall geometry remains available;
- individual parameterized models fail independently;
- CAD remains responsive and closing the preview succeeds.

- [ ] **Step 8: Run the final OCCT verification**

Run from `D:\occt_demo`:

```powershell
npm test
npm run build:3d
git status --short --branch
```

Expected: tests and build pass; OCCT contains only intentional committed implementation, with no accidental generated files staged.

- [ ] **Step 9: Prove the CAD repository was not submitted**

Run:

```powershell
git -C C:\Users\User\Desktop\cad_plugin status --short --branch
git -C C:\Users\User\Desktop\cad_plugin diff --cached --name-only
git -C C:\Users\User\Desktop\cad_plugin log -1 --oneline
```

Expected:

- all feature changes remain in the CAD working tree;
- `diff --cached` prints nothing;
- CAD HEAD remains the revision recorded in Task 1;
- the pre-existing `README.md` modification is still present and untouched.

---

## Final Delivery Checklist

- [ ] OCCT tests pass.
- [ ] OCCT 3D/VR production build passes.
- [ ] Standalone OCCT Demo still works through Node.
- [ ] CAD Debug and Release x64 builds pass.
- [ ] CAD 3D/VR static assets match the latest OCCT build.
- [ ] CAD loads parameterized models with port 3100 unused.
- [ ] Model orientation, placement, flip, click debug, and room dialog behavior pass visual verification.
- [ ] WebView close/reopen and offline failure paths do not crash CAD.
- [ ] No generic WebView security bypass was added.
- [ ] No arbitrary URL proxy was added.
- [ ] CAD staged diff is empty and CAD HEAD is unchanged.
- [ ] CAD's original `README.md` working-tree change remains untouched.
