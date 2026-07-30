# PT Material Details Design

## Goal

Render `BimRenderMat=5` material-library references from converted parameterized models instead of leaving their OBJ material slots with the white fallback material.

This change is limited to `occt_demo`. It does not modify or copy files into `cad_plugin`.

## Confirmed Data Contract

The model conversion response associates each OBJ material slot with a material record:

```json
{
  "MatName": "789f3795-9f3a-4e08-b026-4385d9d18961",
  "ID": "PT527545889554403328",
  "IsModel": false,
  "BimRenderMat": 5
}
```

`MatName` matches the OBJ `usemtl` name. `ID` is a PT material resource code, not a file URL. PT details are fetched in batches of at most 50 codes through:

```http
POST /api/getContentMaterialDetails
Content-Type: application/json

{"materialCodes":["PT527545889554403328"]}
```

The response can contain both an Unreal Engine `pakFileUrl` and Web-readable `optimizeParam` / `optimizeFileUrl`. Three.js must not download or parse the PAK. It uses the optimization metadata.

## Architecture

### API client

`ParametricApiClient.getMaterialDetails(materialCodes)` will use the existing Node backend route in standalone mode and a host bridge method named `getContentMaterialDetails` when the CAD host is available. It validates and deduplicates PT codes, batches requests to 50 codes, and returns normalized detail items.

Material-detail failures are non-fatal. The model remains visible with its existing fallback material, and the loader records a diagnostic warning rather than failing model placement.

### Material descriptor parsing

A focused material-descriptor module will:

- index material details by `code`;
- parse a BOM-prefixed `optimizeParam` JSON string;
- fall back to fetching `optimizeFileUrl` only when inline `optimizeParam` is absent or invalid;
- parse the nested `materialParameter` JSON;
- recognize glass from `modelType === "4"`, a master-material name containing `Glass`, or the Chinese material name containing `玻璃`;
- expose normalized scalar/color hints without coupling parsing to Three.js objects.

The numeric UE parameter keys are treated as protocol hints. This change will map only parameters whose meaning is established by current fixture data and existing rendering behavior. Unknown parameters remain preserved in metadata and do not block rendering.

### Loader integration and caching

For each converted prototype, the loader collects unique non-model entries where `BimRenderMat=5` and `ID` matches `PT\\d+`. It resolves those codes in one batched request before applying material semantics.

The loader caches:

- PT detail promises by material code so repeated windows share one request;
- fetched optimization JSON by URL;
- the converted model prototype separately from instance-specific material clones.

Applying PT details must not mutate shared Three.js materials used by unrelated model instances. Materials that need glass/PBR changes are cloned before mutation.

### Three.js mapping

Resolved material descriptors attach to the OBJ material selected by exact `MatName` equality.

- Glass becomes transparent, uses opacity no greater than `0.32`, disables `depthWrite`, and renders double-sided.
- Opaque materials receive available base color, metalness, roughness, and opacity hints.
- Missing or unrecognized descriptors keep the original OBJ material unchanged.
- PAK URLs are retained only as diagnostic metadata and are never fetched by the browser.

## Error Handling

- Invalid or missing PT codes are ignored.
- A failed batch does not reject the model load.
- Invalid `optimizeParam` falls back to `optimizeFileUrl`.
- If both optimization sources fail, the material remains a fallback material.
- Logs and debug metadata must not expose signed query strings or authorization data.

## Verification

Automated tests will cover:

- API batching, deduplication, standalone/CAD routing, and partial failure;
- BOM and nested JSON parsing;
- glass classification for `PT527545889554403328`-shaped fixture data;
- exact OBJ material-slot matching;
- cache reuse across repeated model instances;
- graceful fallback when material details are unavailable;
- no browser request to a `.pak` URL.

The final verification is the complete test suite, `npm run build:3d`, and browser inspection of the real `Drawing2.json` windows. The glass panes must be transparent while frames remain opaque and correctly colored.
