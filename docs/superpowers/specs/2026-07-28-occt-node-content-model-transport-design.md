# OCCT Node content-model transport design

## Goal

Make the standalone OCCT 3D renderer load real door and other content models through `C:\Users\User\Desktop\parametric-lab\backend`, while preserving the existing C++ bridge transport when the same renderer runs inside the CAD WebView.

The first end-to-end acceptance dataset is `Drawing2.json`: all 15 normalized `door_list` instances must enter the content-model pipeline, resolve template resources, request model details, load or convert their resources, and produce an explicit success/failure summary.

## Boundaries

- Modify the OCCT frontend and `parametric-lab/backend` only.
- Do not modify, stage, commit, or otherwise change `cad_plugin`.
- Keep the existing CAD bridge method names and payloads unchanged.
- Keep the local door Box removal from the door-model checkpoint. A failed real door remains an empty opening.
- Do not change window rendering behavior in this checkpoint.

## Transport selection

`ParametricApiClient` remains the single business-facing client.

- When `RendererHostClient.isAvailable()` is true, use the CAD transport:
  - `getParametricGoodsDetail`
  - `getContentGoodsDetails`
  - `convertParametricModel`
- Otherwise, use the Node HTTP transport at `http://localhost:3100`:
  - `GET /api/getGoodsDetail?id=<resId>` for the existing single-detail contract
  - `POST /api/getContentGoodsDetails` with `{ "resIds": ["..."] }` for batched content details
  - `POST /api/modelUrlToObj` with `{ "url": "...", "parameters": [...] }` for parameterized conversion

The loader, template resolver, resource resolver, and placement code must receive equivalent normalized responses regardless of the selected transport.

## Node backend contract

### Batch goods details

`POST /api/getContentGoodsDetails` accepts one JSON object containing only `resIds`.

- `resIds` must contain 1–50 unique decimal-string IDs.
- Each ID must be non-empty and no longer than 128 bytes.
- The backend forwards the batch to the same upstream endpoint used by the C++ implementation.
- Successful upstream JSON is returned without semantic reshaping so the existing frontend normalizer handles both transports identically.

### Model conversion

The existing `POST /api/modelUrlToObj` contract is retained and hardened to match the C++ boundary:

- URL must be HTTP or HTTPS and no longer than 8192 bytes.
- At most 64 parameters are allowed.
- Each parameter has a non-empty name no longer than 128 bytes and a finite numeric value.
- Existing model conversion flags remain unchanged.

### Operational limits and errors

- Apply explicit upstream timeouts and response-size limits.
- Validate upstream HTTP status before parsing success responses.
- Return stable JSON errors with `code`, `message`, and `status`.
- Use the existing frontend-compatible codes where applicable: `INVALID_ARGUMENT`, `NETWORK_ERROR`, `HTTP_ERROR`, `RESPONSE_TOO_LARGE`, and `INVALID_RESPONSE`.
- Logs may contain method, status, elapsed milliseconds, response bytes, and error code. They must not print signed model URLs, full upstream bodies, model contents, or tokens.

## Frontend behavior

For Node transport, `getGoodsDetails()` sends batches of at most 50 IDs to `/api/getContentGoodsDetails` instead of issuing one `/api/getGoodsDetail` request per resource. The existing maximum concurrency and result normalization remain in place for multiple batches.

Transport selection occurs once when `ParametricApiClient` is constructed. Standalone browser execution must select `node`; an iframe hosted by the CAD renderer shell must select `cad`.

`ContentModelLoader` continues to report per-run summary and allowlisted per-instance failures. The transport layer must preserve error codes so an empty door opening can be traced to selection, detail lookup, download, conversion, parsing, or placement.

## Verification

### Automated

- Backend contract tests cover valid batching, invalid/duplicate IDs, limits, timeout/error mapping, response-size handling, and sanitised logging.
- Frontend tests prove standalone mode selects Node, CAD embedding selects the bridge, Node detail lookup uses the batch endpoint, and both transports normalize equivalent results.
- Existing OCCT tests and the production 3D/VR build must remain green.

### End to end

Run the Node backend and serve the OCCT production build locally. With `Drawing2.json`, verify:

1. the parser reports 15 door content instances;
2. the backend receives a batch goods-details request;
3. each selected door resource follows its static-GLB or parameterized conversion path;
4. `[ContentLoader] scene summary` reports real loaded/skipped/failed counts;
5. the browser scene contains the successfully loaded door model groups and no visible local door Boxes.

Only after this standalone OCCT path is demonstrated will the build be synchronized for a separate CAD runtime checkpoint.
