# Web Model Package Loading Design

## Goal

Restore the original geometry and materials of static catalog models by loading
the Web package exposed by the goods-detail API. Preserve the existing
parameterized-model and OBJ conversion paths as compatibility fallbacks.

This change applies to `occt_demo` and its local Node test backend. It must not
modify, copy files into, commit, or submit changes from `cad_plugin`.

## Confirmed Resource Contract

The content template maps a CAD `TypeId` and size to a catalog resource through
`ResList[].ResId`. The selected `ResId` is sent to:

```http
GET http://i.bim-zeus.home.ke.com/api/resGoods/getGoodsDetailById?id={ResId}
```

For a static resource, the response can contain:

```text
data.modelDTO.webUrl
data.modelDTO.webMd5
data.modelDTO.webName
data.modelDTO.webOptimizeUrl
data.modelDTO.webOptimizeMd5
```

The file named by `webUrl` has a `.pak` suffix but is an AES-encrypted ZIP. A
verified package contains:

- one glTF 2.0 `.gltf` document;
- its external `.bin` buffer;
- diffuse and normal textures under `TextureToUE/`;
- `pakInfo.xml`, which records material slots, texture roles, and UV tiling.

Some parameterized resources, including the currently tested window resources
`2406313` and `2406314`, do not expose `webUrl`. Their converted OBJ output can
still reference PT material codes. Those resources remain on the existing
parameterized conversion and PT material-detail path. Loading static Web
packages does not replace PT material resolution.

## Resource Routing

The existing template selection remains the only source of `ResId`. After goods
details are resolved, the loader selects one of these paths:

1. If a valid `data.modelDTO.webUrl` and `webMd5` exist, request a prepared Web
   package from the local resource bridge and load its glTF entry point.
2. If the resource is parameterized or has no usable Web package, use the
   existing parameterized/static resource resolver and conversion flow.
3. If Web-package preparation or glTF loading fails, retry through the existing
   resolver. A failure for one instance must not stop the rest of the scene.

The first successful path produces the prototype passed to the current
placement code. Position, rotation, mirroring, scaling, click-debug metadata,
and composite-model handling remain unchanged.

## Local Resource Bridge

The Node backend will expose one narrow endpoint that accepts a decimal `ResId`.
It will:

1. request and validate the goods detail;
2. accept downloads only from the configured resource host allowlist;
3. download the `webUrl` package under existing response-size and timeout
   limits;
4. verify the downloaded bytes against `webMd5` before extraction;
5. decrypt and extract using the configured package password;
6. reject absolute paths, parent traversal, links, duplicate unsafe paths, and
   archives that exceed entry-count or expanded-size limits;
7. locate exactly one supported glTF entry point;
8. normalize glTF asset references to portable forward-slash paths contained
   inside the extracted package;
9. atomically publish the prepared files in a cache keyed by `ResId + webMd5`;
10. return a local, same-origin glTF URL and sanitized metadata.

The package password belongs to the bridge configuration and must not be
returned by an endpoint, written into project source, emitted in logs, or
included in the browser bundle. Development obtains it from an environment
variable. The future CAD C++ bridge will implement the same frontend-facing
contract and own the password locally.

The cache is content-addressed by the server-provided MD5. A changed MD5 creates
a new cache entry, so stale resources cannot overwrite current ones. Concurrent
requests for the same key share one preparation promise. Temporary downloads and
partial extraction directories are removed after success or failure.

## Frontend Components

### API client

`ParametricApiClient` gains a Web-package preparation method. In standalone
mode it calls the Node bridge; in CAD-host mode it calls the equivalent host
bridge method. The normalized result contains only the glTF URL, resource key,
and non-sensitive diagnostics.

### Resource resolver

The resolver records whether goods details advertise a Web package, but does
not decrypt or parse it. Existing parameterized/static classifications remain
valid and serve as fallback information.

### Model loader

`ContentModelLoader` tries the prepared Web package before converting a static
resource. It loads the returned URL with Three.js `GLTFLoader`, then stores the
result in the existing prototype cache using `ResId + webMd5` as the versioned
key. Each placed instance still receives the cloning and placement treatment
required by the current loader.

The glTF's PBR materials and texture assignments are authoritative for static
Web packages. Existing semantic material processing may annotate or normalize
known glass behavior, but it must not replace valid package colors or textures
with white fallback materials.

## Error Handling and Diagnostics

Expected bridge error codes distinguish invalid input, missing Web package,
disallowed URL, download failure, checksum mismatch, invalid archive,
decryption failure, unsafe entry, unsupported package layout, and cache failure.
The frontend treats every Web-package error as non-fatal and records a sanitized
fallback reason in debug data.

Logs may include `ResId`, MD5, elapsed time, cache hit/miss, byte counts, entry
counts, and stable error codes. They must not include the package password,
authorization values, or signed URL query strings.

## Verification

Backend tests cover:

- strict request validation and URL allowlisting;
- MD5 verification before extraction;
- correct extraction of an encrypted ZIP fixture;
- rejection of traversal and expansion-limit fixtures;
- glTF URI normalization;
- cache reuse, cache invalidation by MD5, and concurrent request deduplication;
- sanitized error responses and logs.

Frontend tests cover:

- standalone and CAD bridge routing;
- Web-package-first selection for eligible static resources;
- `GLTFLoader` integration and versioned prototype caching;
- preservation of package PBR materials and textures;
- fallback when `webUrl` is absent or preparation/loading fails;
- unchanged parameterized-window and PT-material behavior;
- unchanged placement for cloned instances.

Final verification runs the full backend and frontend test suites,
`npm run build:3d`, and browser inspection against `Drawing2.json`. At least one
real static resource with a Web package must render with its supplied textures,
while the existing parameterized windows remain visible and retain transparent
glass behavior.

## Migration Boundary

No CAD code changes are part of this work. The later migration replaces only
the local Node preparation endpoint with a C++ bridge method that returns the
same normalized result. Frontend resource routing and model loading should not
need another redesign.
