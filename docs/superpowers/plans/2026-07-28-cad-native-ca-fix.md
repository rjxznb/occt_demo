# CAD Native CA HTTPS Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the CAD native parameter-model conversion HTTPS request trust the Windows root certificate store while preserving strict TLS verification.

**Architecture:** Keep the existing fixed-endpoint `KParametricApiClient` and its OpenSSL-backed libcurl transport. Add `CURLSSLOPT_NATIVE_CA` to the common curl options so HTTPS uses Windows trusted roots; do not add a PEM asset, disable verification, change endpoints, or introduce a Node fallback.

**Tech Stack:** C++17, libcurl 7.87.0 with OpenSSL, Visual Studio 2019/MSBuild, Node.js test runner.

## Global Constraints

- The CAD repository remains unstaged and uncommitted.
- The pre-existing CAD `README.md` working-tree change is not touched.
- `CURLOPT_SSL_VERIFYPEER=1` and `CURLOPT_SSL_VERIFYHOST=2` remain enabled.
- No CA bundle file, generic `KeCurlWrapper`, arbitrary URL proxy, or Node fallback is added.
- The AutoCAD 2021 Support copy must be byte-identical to the rebuilt Debug ARX.

---

### Task 1: Enable the Windows Native CA Store

**Files:**
- Modify: `D:\occt_demo\.worktrees\cad-renderer-parametric-bridge\tests\cad-parametric-api-client-contract.test.js`
- Modify, but do not stage or commit: `C:\Users\User\Desktop\cad_plugin\common\Net\k_parametric_api_client.cpp`

**Interfaces:**
- Consumes: the existing `ExecuteRequest(url, timeout, post_body)` common curl setup.
- Produces: the same `KParametricApiResult` contract with HTTPS certificate verification backed by Windows native roots.

- [ ] **Step 1: Add the failing native-CA contract assertion**

Add this assertion beside the existing peer/host verification assertions:

```js
assert.match(
    source,
    /CURLOPT_SSL_OPTIONS\s*,\s*CURLSSLOPT_NATIVE_CA/,
    'HTTPS requests must trust the Windows native CA store',
);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
$env:CAD_PARAMETRIC_API_CLIENT_PATH='C:\Users\User\Desktop\cad_plugin\common\Net\k_parametric_api_client.cpp'
node --test tests/cad-parametric-api-client-contract.test.js
```

Expected: FAIL because `CURLOPT_SSL_OPTIONS, CURLSSLOPT_NATIVE_CA` is absent.

- [ ] **Step 3: Add the minimal curl option**

In the common option chain, retain the current verification options and add:

```cpp
!SetCurlOption(curl.get(), CURLOPT_SSL_VERIFYPEER, 1L, &error) ||
!SetCurlOption(curl.get(), CURLOPT_SSL_VERIFYHOST, 2L, &error) ||
!SetCurlOption(curl.get(), CURLOPT_SSL_OPTIONS,
               static_cast<long>(CURLSSLOPT_NATIVE_CA), &error) ||
```

Do not change any endpoint, payload, timeout, protocol, redirect, response-size, or error-mapping behavior.

- [ ] **Step 4: Run focused and complete OCCT verification**

Run:

```powershell
$env:CAD_PARAMETRIC_API_CLIENT_PATH='C:\Users\User\Desktop\cad_plugin\common\Net\k_parametric_api_client.cpp'
node --test tests/cad-parametric-api-client-contract.test.js
Remove-Item Env:CAD_PARAMETRIC_API_CLIENT_PATH
npm.cmd test
```

Expected: focused test passes; complete suite has zero failures and only the documented environment-gated skips.

- [ ] **Step 5: Commit only the OCCT contract test**

Run:

```powershell
git add -- tests/cad-parametric-api-client-contract.test.js
git commit -m "test: require Windows native CA for CAD HTTPS"
```

Expected: the OCCT test is committed; the CAD C++ file remains unstaged and uncommitted.

- [ ] **Step 6: Rebuild the CAD Debug x64 plugin**

Run:

```powershell
& 'C:\Program Files (x86)\Microsoft Visual Studio\2019\Community\MSBuild\Current\Bin\amd64\MSBuild.exe' `
  'C:\Users\User\Desktop\cad_plugin\KeCADPlugin.sln' `
  /t:Rebuild /m /p:Configuration=Debug /p:Platform=x64 /v:minimal
```

Expected: exit code 0; the existing PostBuild step copies `ADSKKeCADPlugin.arx` and `.pdb` into the AutoCAD 2021 Support directory.

- [ ] **Step 7: Verify the deployed binary and repository isolation**

Run:

```powershell
$debugArx = 'C:\Users\User\Desktop\cad_plugin\build\x64\Debug\ADSKKeCADPlugin.arx'
$supportArx = "$env:APPDATA\Autodesk\AutoCAD 2021\R24.0\chs\Support\ADSKKeCADPlugin.arx"
(Get-FileHash -Algorithm SHA256 -LiteralPath $debugArx).Hash
(Get-FileHash -Algorithm SHA256 -LiteralPath $supportArx).Hash
git -C C:\Users\User\Desktop\cad_plugin diff --check
git -C C:\Users\User\Desktop\cad_plugin diff --cached --name-only
```

Expected: hashes match, `diff --check` succeeds, and CAD staged output is empty.

- [ ] **Step 8: Verify the live CAD conversion path**

Fully exit AutoCAD, launch it again through the existing Visual Studio Debug workflow, and open the 3D Render Preview.

Expected debug evidence:

```text
[ParametricBridge] method=getParametricGoodsDetail status=200 ... code=OK
[ParametricBridge] method=convertParametricModel status=200 ... code=OK
```

Expected UI result: the new parameterized soft models appear. No `localhost:3100` listener is required, and existing room/wall rendering remains unchanged.

