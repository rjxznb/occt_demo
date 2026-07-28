# CAD WebView Safe Diagnostics Design

Date: 2026-07-28

## Problem

The real CAD 3D preview renders the legacy room scene but reports zero content models. The loaded ARX and deployed bundle contain the new bridge and loader, yet no `ParametricBridge` native batch log appears. Existing automated tests cannot identify whether startup, data/template loading, the iframe RPC boundary, or a page exception prevents the native call.

## Design

`KRenderPreviewBrowser` installs a WebView2 document-created script before navigation. The script observes only fixed lifecycle/error events and emits a fixed diagnostic envelope through `window.chrome.webview.postMessage`. Native code accepts only a fixed channel/version, a serialized length no greater than 512 bytes, and allowlisted `stage`/`code` values. It rejects messages containing extra fields and prints only `[RenderPreviewDiag] stage=<allowlisted> code=<allowlisted>` through `OutputDebugStringA`.

The browser also prints fixed native stages for virtual-host mapping and top-level navigation results. It never prints a URI, response body, resource ID, exception message, or arbitrary page text. It does not enable remote DevTools, intercept or rewrite `fetch`, or change application behavior.

OCCT explicitly emits allowlisted stages at 3D boot, drawing-data readiness, content-loader start, iframe RPC send/result/timeout, and scene summary/error. These hooks use the same fixed envelope and contain no dynamic identifiers or messages. They are inert outside WebView2.

## Tests and acceptance

- A CAD source-contract test must fail before implementation and require the fixed channel/version, 512-byte cap, exact key set, stage/code allowlists, renderer-local source restriction, fixed output format, lifecycle injection, and virtual-host/navigation fixed logs.
- RendererHostClient tests must fail before implementation and verify fixed RPC stage emission without payload/ID leakage.
- App/loader source tests must require the explicit data/content stages.
- All tests and `build:3d` must pass; artifacts must be manually redeployed and hash-checked.
- CAD remains unstaged/uncommitted. The user reopens the 3D preview once and reports the ordered fixed diagnostic stages from Visual Studio Output.

