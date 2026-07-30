# Web Model Package Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load AES-encrypted Web model packages selected by template `ResId`, preserve their glTF materials and textures, cache prepared assets locally, and fall back to the existing WebV2/parameterized loaders without modifying CAD code.

**Architecture:** The local Node bridge owns the package password, downloads and verifies each package, safely extracts it into a content-addressed cache, normalizes glTF references, and serves prepared files over HTTP. OCCT recognizes eligible static resources, asks the bridge to prepare them, loads the returned glTF through the existing `GLTFLoader`, and retains WebV2 and parameterized OBJ paths as fallbacks.

**Tech Stack:** Node.js 18+, Express 4, `@zip.js/zip.js` 2.x, `fast-xml-parser` 5.x, Three.js 0.178, Node test runner, Vite 6.

## Global Constraints

- Modify `occt_demo` and `C:/Users/User/Desktop/parametric-lab/backend`; never modify, copy into, stage, commit, or submit `cad_plugin`.
- Use `template.json` `ResList[].ResId` as the only model instance ID.
- Keep resources without `webUrl`, including parameterized windows `2406313` and `2406314`, on the existing conversion/PT-material path.
- Read the package password only from `WEB_MODEL_PACKAGE_PASSWORD`; never return, log, commit, or bundle it.
- Allowlist resource hosts, verify `webMd5`, reject unsafe/oversized archives, and publish cache entries atomically.
- Cache by `ResId + webMd5` and deduplicate concurrent preparation.
- Treat Web-package failures as non-fatal when WebV2 fallback exists.
- Preserve usable package PBR materials and textures rather than replacing them with white fallback materials.

## File Map

Backend:

- Create `backend/web-model-package.js` for archive validation, extraction, glTF/XML normalization, caching, and preparation.
- Create `backend/test/web-model-package.test.js` for encrypted fixtures and security/cache tests.
- Modify `backend/app.js` and `backend/test/content-api.test.js` for the HTTP contract and cache serving.
- Modify `backend/package.json` and `backend/package-lock.json` for ZIP/XML dependencies.

OCCT:

- Modify `src/services/ParametricApiClient.js` and `tests/parametric-api-client.test.js` for standalone/CAD preparation transport.
- Modify `src/services/ContentResourceResolver.js` and `tests/content-resource-resolver.test.js` for Web-package-first static routing.
- Modify `src/components/ContentModelLoader.js`, `tests/content-model-loader.test.js`, and `tests/content-model-scene-integration.test.js` for loading, fallback, and regression coverage.

---

### Task 1: Checkpoint Existing Backend PT Support

**Files:**
- Verify: `C:/Users/User/Desktop/parametric-lab/backend/app.js`
- Verify: `C:/Users/User/Desktop/parametric-lab/backend/test/content-api.test.js`

**Interfaces:**
- Consumes: existing uncommitted `getContentMaterialDetails` and string parameter changes.
- Produces: a clean backend baseline before Web-package work.

- [ ] **Step 1: Inspect the current diff**

```powershell
git -C C:/Users/User/Desktop/parametric-lab diff -- backend/app.js backend/test/content-api.test.js
```

Expected: only the previously implemented PT route, validation, and parameter compatibility changes.

- [ ] **Step 2: Run backend tests**

```powershell
npm.cmd test --prefix C:/Users/User/Desktop/parametric-lab/backend
```

Expected: zero failures.

- [ ] **Step 3: Commit only those verified files**

```powershell
git -C C:/Users/User/Desktop/parametric-lab add -- backend/app.js backend/test/content-api.test.js
git -C C:/Users/User/Desktop/parametric-lab commit -m "feat: proxy PT material details"
```

---

### Task 2: Decode and Normalize Encrypted Packages

**Files:**
- Create: `C:/Users/User/Desktop/parametric-lab/backend/web-model-package.js`
- Create: `C:/Users/User/Desktop/parametric-lab/backend/test/web-model-package.test.js`
- Modify: `C:/Users/User/Desktop/parametric-lab/backend/package.json`
- Modify: `C:/Users/User/Desktop/parametric-lab/backend/package-lock.json`

**Interfaces:**
- Consumes: archive bytes, password, output directory, and extraction limits.
- Produces: `extractWebModelPackage(bytes, options)` and `normalizeWebGltfPackage(rootDir, gltfRelativePath)`.

- [ ] **Step 1: Install focused dependencies**

```powershell
npm.cmd install --prefix C:/Users/User/Desktop/parametric-lab/backend @zip.js/zip.js@^2 fast-xml-parser@^5
```

Expected: only these two runtime dependencies are added.

- [ ] **Step 2: Write a failing encrypted-fixture test**

Use `ZipWriter` to create an AES fixture containing `fixture.gltf`, `fixture.bin`, `pakInfo.xml`, `TextureToUE/frame_D.jpg`, and `TextureToUE/frame_N.jpg`. Give the glTF image URI `..\\TextureToUE\\frame_D.jpg`; associate the normal image with slot `Frame` in XML.

```js
assert.equal(result.gltfRelativePath, 'fixture.gltf');
assert.equal(result.entryCount, 5);
assert.equal(normalized.images[0].uri, 'TextureToUE/frame_D.jpg');
assert.equal(normalized.materials[0].normalTexture.index, 1);
```

- [ ] **Step 3: Run the focused test to confirm RED**

```powershell
node --test C:/Users/User/Desktop/parametric-lab/backend/test/web-model-package.test.js
```

Expected: FAIL because the module does not exist.

- [ ] **Step 4: Implement the minimal archive layer**

```js
export const WEB_PACKAGE_LIMITS = Object.freeze({
  maxEntries: 512,
  maxExpandedBytes: 256 * 1024 * 1024,
  maxEntryBytes: 128 * 1024 * 1024,
});

// Promise<{ gltfRelativePath: string, entryCount: number, expandedBytes: number }>
extractWebModelPackage(bytes, { password, outputDir, limits: WEB_PACKAGE_LIMITS });

// Promise<void>; rewrites glTF asset URIs and enriches missing XML normal maps.
normalizeWebGltfPackage(rootDir, gltfRelativePath);
```

Normalize separators before validation. Reject empty/NUL names, absolute paths, drive prefixes, every `..` segment, duplicate normalized paths, links, unsupported extensions, more than 512 entries, any entry above 128 MiB, or an expanded total above 256 MiB. Permit directories and `.gltf`, `.bin`, `.xml`, `.jpg`, `.jpeg`, `.png`, `.webp`; require exactly one `.gltf`.

For glTF URIs, ignore data URIs, convert backslashes, remove leading `./` and `../`, and require the resulting file inside the extraction root. From `pakInfo.xml`, add a missing normal image/texture and `KHR_texture_transform` tiling to the matching material slot. Never overwrite existing base color, diffuse texture, metalness, roughness, alpha, or normal map.

- [ ] **Step 5: Add security and limit tests**

```js
await assert.rejects(extractFixture('../escape.jpg'),
  error => error.code === 'WEB_PACKAGE_UNSAFE_ENTRY');
await assert.rejects(extractFixture('a.exe'),
  error => error.code === 'WEB_PACKAGE_UNSUPPORTED_ENTRY');
await assert.rejects(extractWithWrongPassword(),
  error => error.code === 'WEB_PACKAGE_DECRYPTION_FAILED');
await assert.rejects(extractWithLimits({ maxEntries: 1 }),
  error => error.code === 'WEB_PACKAGE_LIMIT_EXCEEDED');
```

Also assert that no file appears outside the temporary output directory.

- [ ] **Step 6: Run focused tests to confirm GREEN**

```powershell
node --test C:/Users/User/Desktop/parametric-lab/backend/test/web-model-package.test.js
```

Expected: all archive, XML, password, traversal, and limit tests pass.

- [ ] **Step 7: Commit the archive layer**

```powershell
git -C C:/Users/User/Desktop/parametric-lab add -- backend/package.json backend/package-lock.json backend/web-model-package.js backend/test/web-model-package.test.js
git -C C:/Users/User/Desktop/parametric-lab commit -m "feat: decode encrypted web model packages"
```

---

### Task 3: Prepare, Cache, and Serve Web Assets

**Files:**
- Modify: `C:/Users/User/Desktop/parametric-lab/backend/web-model-package.js`
- Modify: `C:/Users/User/Desktop/parametric-lab/backend/test/web-model-package.test.js`
- Modify: `C:/Users/User/Desktop/parametric-lab/backend/app.js`
- Modify: `C:/Users/User/Desktop/parametric-lab/backend/test/content-api.test.js`

**Interfaces:**
- Consumes: decimal `ResId`, goods detail `modelDTO.webUrl/webMd5`, runtime password.
- Produces: `createWebModelPackageService(options).prepare(resId)` and `POST /api/prepareWebModelPackage`.

- [ ] **Step 1: Write failing service tests**

With injected `getGoodsDetail` and `downloadPackage`, assert two concurrent `prepare('1961113')` calls download once and return the same `resourceKey` and `gltfPath`. Add tests for `WEB_PACKAGE_MISSING`, `WEB_PACKAGE_URL_DISALLOWED`, `WEB_PACKAGE_CHECKSUM_MISMATCH`, sequential cache hits, changed-MD5 invalidation, and temporary-directory cleanup.

```js
assert.equal(downloadCalls, 1);
assert.equal(first.resourceKey, `1961113-${webMd5}`);
assert.equal(second.gltfPath, first.gltfPath);
```

- [ ] **Step 2: Run service tests to confirm RED**

```powershell
node --test C:/Users/User/Desktop/parametric-lab/backend/test/web-model-package.test.js
```

Expected: FAIL because the service factory does not exist.

- [ ] **Step 3: Implement content-addressed preparation**

```js
export function createWebModelPackageService({
  cacheRoot,
  password,
  getGoodsDetail,
  downloadPackage,
  allowedHosts = ['file.ljcdn.com'],
  logger = console,
}) {
  return { prepare: async resId => ({
    resId,
    resourceKey,
    gltfPath: `/api/web-model-assets/${resourceKey}/${encodedGltfPath}`,
    contentHash: webMd5,
    cacheHit,
  }) };
}
```

Require decimal ID, 32-digit hex MD5, allowlisted HTTP(S) URL, and non-empty password. Verify MD5 before extraction. Prepare in `.tmp-<key>-<uuid>`, write a manifest last, then atomically rename. A cache hit requires the manifest, matching MD5, and contained glTF. Deduplicate by resource key and clear the in-flight map in `finally`.

- [ ] **Step 4: Write failing HTTP tests**

Inject `webModelPackageService` into `createApp`. POST `{ "resId": "1961113" }` and assert:

```js
{
  code: 2000,
  data: {
    resId: '1961113',
    resourceKey: '1961113-deadbeefdeadbeefdeadbeefdeadbeef',
    gltfPath: '/api/web-model-assets/1961113-deadbeefdeadbeefdeadbeefdeadbeef/model.gltf',
    contentHash: 'deadbeefdeadbeefdeadbeefdeadbeef',
    cacheHit: false,
  },
}
```

Reject missing/extra fields, arrays, non-decimal IDs, and IDs longer than 128 bytes. Verify the static cache route serves glTF/bin/images with CORS and correct MIME types. Verify responses/logs omit upstream URLs and the password.

- [ ] **Step 5: Run HTTP tests to confirm RED**

```powershell
node --test C:/Users/User/Desktop/parametric-lab/backend/test/content-api.test.js
```

Expected: FAIL because the route does not exist.

- [ ] **Step 6: Wire service and routes**

Extend `createApp` with injected `webModelPackageService` and `webModelCacheRoot`, defaulting the root to `WEB_MODEL_CACHE_DIR` or `os.tmpdir()/occt-web-model-cache`. The default service uses the bounded upstream requester, the goods-detail endpoint, and `WEB_MODEL_PACKAGE_PASSWORD`. Register `POST /api/prepareWebModelPackage` and a directory-index-disabled `/api/web-model-assets` static route rooted only at the configured cache.

- [ ] **Step 7: Run and commit the backend**

```powershell
npm.cmd test --prefix C:/Users/User/Desktop/parametric-lab/backend
git -C C:/Users/User/Desktop/parametric-lab add -- backend/app.js backend/web-model-package.js backend/test/content-api.test.js backend/test/web-model-package.test.js
git -C C:/Users/User/Desktop/parametric-lab commit -m "feat: prepare and cache web model assets"
```

Expected: all backend tests pass before the commit.

---

### Task 4: Add Frontend Transport and Resource Routing

**Files:**
- Modify: `src/services/ParametricApiClient.js`
- Modify: `tests/parametric-api-client.test.js`
- Modify: `src/services/ContentResourceResolver.js`
- Modify: `tests/content-resource-resolver.test.js`

**Interfaces:**
- Consumes: bridge preparation response and type-1 goods resource records.
- Produces: `ParametricApiClient.prepareWebModelPackage(resId)` and resolver kind `static-web-package` with optional `fallbackResource`.

- [ ] **Step 1: Write failing API transport tests**

Assert Node mode posts exactly `{resId:'1961113'}` to `/api/prepareWebModelPackage` and resolves a relative `gltfPath` against `backendUrl`. Assert CAD mode invokes:

```js
hostClient.invoke('prepareWebModelPackage', { resId: '1961113' },
  { timeoutMs: 130_000 });
```

and accepts an absolute host `gltfUrl`. Reject invalid IDs, invalid business codes, missing paths, and malformed responses with `INVALID_ARGUMENT` or `INVALID_RESPONSE`.

- [ ] **Step 2: Run API tests to confirm RED**

```powershell
node --test tests/parametric-api-client.test.js
```

Expected: FAIL because `prepareWebModelPackage` does not exist.

- [ ] **Step 3: Implement and normalize preparation transport**

```js
async prepareWebModelPackage(resId) {
  const normalized = String(resId ?? '').trim();
  if (!/^\d+$/.test(normalized)) {
    throw createError('INVALID_ARGUMENT', 'resId is invalid');
  }
  const raw = this.transport === 'cad'
    ? await this.hostClient.invoke('prepareWebModelPackage', { resId: normalized }, {
        timeoutMs: MODEL_TIMEOUT_MS,
      })
    : await this.postJson(`${this.backendUrl}/api/prepareWebModelPackage`, {
        resId: normalized,
      });
  return normalizePreparedWebPackage(raw,
    this.transport === 'node' ? this.backendUrl : null);
}
```

The normalizer unwraps `code:2000`, accepts `data.gltfUrl` or `data.gltfPath`, resolves Node relative paths, and returns only `{resId,resourceKey,gltfUrl,contentHash,cacheHit}`. It must not retain `webUrl` or archive credentials.

- [ ] **Step 4: Write failing resolver tests**

For type 1 with valid `webUrl/webMd5` and `webV2Url/webV2Md5`, expect:

```js
{
  resId: '1961113',
  kind: 'static-web-package',
  contentHash: '0123456789abcdef0123456789abcdef',
  fallbackResource: {
    resId: '1961113',
    kind: 'static-glb',
    sourceUrl: 'https://file.test/model.kb',
    contentHash: 'web-v2-md5',
    modelType: 0,
    resourceType: 1,
  },
  modelType: 0,
  resourceType: 1,
}
```

Also cover Web-package-only, WebV2-only, invalid MD5, and type-8 parameterized records with empty Web fields. Type 8 must remain `parametric-obj`.

- [ ] **Step 5: Run resolver tests to confirm RED**

```powershell
node --test tests/content-resource-resolver.test.js
```

Expected: FAIL because WebV2 is still selected first.

- [ ] **Step 6: Implement Web-package-first static routing**

Require HTTP(S) `webUrl` and 32-digit hex `webMd5`, but do not return `webUrl` to the loader. Add `hasStaticWebPackage` to `rawSummary`. Build `fallbackResource` only from valid WebV2 data. Leave parameterized selection unchanged.

- [ ] **Step 7: Verify and commit routing**

```powershell
node --test tests/parametric-api-client.test.js tests/content-resource-resolver.test.js
git add -- src/services/ParametricApiClient.js src/services/ContentResourceResolver.js tests/parametric-api-client.test.js tests/content-resource-resolver.test.js
git commit -m "feat: route static models through web packages"
```

Expected: all focused tests pass before the commit.

---

### Task 5: Load Prepared glTF with WebV2 Fallback

**Files:**
- Modify: `src/components/ContentModelLoader.js`
- Modify: `tests/content-model-loader.test.js`
- Modify: `tests/content-model-scene-integration.test.js`

**Interfaces:**
- Consumes: `static-web-package`, `apiClient.prepareWebModelPackage(resId)`, optional `fallbackResource`.
- Produces: package-first prototypes cached by `ResId + webMd5` with unchanged placement.

- [ ] **Step 1: Write a failing package-first material test**

Use a package prototype whose material has a texture, color, roughness, metalness, and normal map. Assert:

```js
assert.deepEqual(calls.sequence, [
  'prepare:1961113',
  'gltf:http://localhost:3100/api/web-model-assets/key/model.gltf',
  'place:soft_list:0',
]);
assert.equal(placedMaterial.map, packageMaterial.map);
assert.equal(placedMaterial.normalMap, packageMaterial.normalMap);
assert.equal(placedMaterial.color.getHex(), packageMaterial.color.getHex());
```

The material must not become the beige/white fallback.

- [ ] **Step 2: Add failing cache and fallback tests**

Assert two instances prepare/load once but receive independent roots and cloned materials. Make preparation throw `WEB_PACKAGE_CHECKSUM_MISMATCH`; assert WebV2 loads and placement succeeds. Make package and fallback both fail; assert one sanitized `STATIC_MODEL_LOAD_FAILED` containing no URLs.

- [ ] **Step 3: Run loader tests to confirm RED**

```powershell
node --test tests/content-model-loader.test.js
```

Expected: FAIL because `static-web-package` is treated as parameterized.

- [ ] **Step 4: Implement package prototype loading**

```js
export function webPackageCacheKey(resource) {
  return `static-web:${resource.resId}:${resource.contentHash}`;
}

async loadWebPackagePrototype(resource) {
  try {
    const prepared = await this.apiClient.prepareWebModelPackage(resource.resId);
    return preparePrototype(await this.loadGltf(prepared.gltfUrl),
      'STATIC_MODEL_LOAD_FAILED');
  } catch (error) {
    if (resource.fallbackResource) {
      this.logger.warn('[ContentLoader] Web package fallback', {
        resId: resource.resId,
        code: failureCode(error, 'STATIC_MODEL_LOAD_FAILED'),
      });
      return this.loadStaticPrototype(resource.fallbackResource);
    }
    throw pipelineError('STATIC_MODEL_LOAD_FAILED',
      sanitizedMessage(error, 'Web model package load failed'), error);
  }
}
```

Route the new kind through this method and cache key; count it as static. Extend metadata sanitization to `gltfUrl`, `gltfPath`, and `webUrl`. Preserve the existing clone/placement behavior and usable package materials.

- [ ] **Step 5: Add the parameterized-window regression**

Use a type-8 fixture shaped like `2406313` with empty `webUrl/webMd5` and valid `parameterizedJsonUrl`. Assert:

```js
assert.equal(calls.prepareWebModelPackage, 0);
assert.equal(calls.convertModel, 1);
assert.equal(result.summary.parametricSelected, 1);
assert.equal(result.groups.length, 1);
```

Retain the PT material-detail assertion so transparent glass behavior remains covered.

- [ ] **Step 6: Verify and commit loader integration**

```powershell
node --test tests/content-model-loader.test.js tests/content-model-scene-integration.test.js
git add -- src/components/ContentModelLoader.js tests/content-model-loader.test.js tests/content-model-scene-integration.test.js
git commit -m "feat: load prepared web model packages"
```

Expected: package materials, cache, fallback, independent clones, and parameterized regression all pass.

---

### Task 6: Full Verification and Real-Resource Check

**Files:**
- Verify only: backend repository, OCCT repository, local browser, and untouched CAD status.

**Interfaces:**
- Consumes: completed endpoint and loader.
- Produces: test/build/browser evidence for static materials and parameterized regressions.

- [ ] **Step 1: Run all automated verification**

```powershell
npm.cmd test --prefix C:/Users/User/Desktop/parametric-lab/backend
npm.cmd test
npm.cmd run build:3d
```

Expected: both test suites have zero failures and Vite completes successfully.

- [ ] **Step 2: Start the bridge with runtime-only configuration**

Set `WEB_MODEL_PACKAGE_PASSWORD` only in the child-process environment and start `backend/server.js`. Do not print the environment variable or a command line containing it. Verify `GET http://127.0.0.1:3100/health` returns `{"status":"ok"}`.

- [ ] **Step 3: Verify a real package and cache**

POST `{resId:'1961113'}` twice. The first response must report `cacheHit:false`, the second `cacheHit:true`; both must return the same contained `.gltf`. Fetch that glTF and its `.bin` and texture URLs and expect HTTP 200.

- [ ] **Step 4: Inspect the 3D page**

Open `index-3d.html#debug` with a cache-busting query and verify:

- an eligible static model uses package colors/textures instead of white fallback;
- the browser makes no `.pak` request;
- buffers/textures come from the local cache route;
- parameterized windows remain visible with transparent glass;
- one forced package failure falls back without blocking the scene;
- console output contains no password or signed upstream URL.

- [ ] **Step 5: Verify repository boundaries**

```powershell
git status --short
git -C C:/Users/User/Desktop/parametric-lab status --short
git -C C:/Users/User/Desktop/cad_plugin status --short
```

Expected: OCCT and backend contain only intended work; CAD status is identical to its pre-task state.
