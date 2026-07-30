# Zstd Material Routing Design

## Goal

Use the material metadata returned by `modelUrlToObj` as the authoritative source for Three.js material semantics. Remove the additional material-detail request that was introduced only to infer whether a material is glass.

This change applies only to `occt_demo`. It must not modify or commit `cad_plugin`.

## Source Protocol

The decompressed rendering payload contains the same logical information described by `floorplan.json`:

- OBJ meshes identify materials through `usemtl`.
- Each material metadata entry identifies the OBJ material through `MatName`.
- `BimRenderMat` and `IsModel` determine the semantic category.
- `ID` carries a goods, `PT`, or `MX` resource identifier depending on the category.
- `BIMTransformStr`, `UniqueID`, `ModelHidden`, and `WhiteTemplateMatName` are model metadata rather than PBR material properties.

The material router must accept both an object keyed by OBJ material name and an array of material entries. It must normalize field types because upstream JSON may encode booleans and numbers as strings.

## Architecture

### Content material router

`ContentMaterialSemantics.js` owns protocol normalization, classification, metadata attachment, and local semantic material adjustments. `ContentModelLoader` remains responsible for obtaining and parsing model data and invokes the router once after OBJ parsing.

The router maps a metadata entry to a Three.js material by `MatName`. If `MatName` is absent, an object-map key may be used as its material name. It attaches normalized metadata to `material.userData` so later placement and debugging code can inspect the original category and resource ID.

### Placement-safe glass handling

The cached prototype records that a material is glass but does not replace the cached material with a per-instance material. `applyWindowGlassMaterials` clones only marked glass materials when a model instance is placed, then applies transparent glass parameters. This prevents selection or later material edits on one instance from mutating another instance or the cache.

Name-based glass detection remains only as a compatibility fallback for older OBJ/GLTF resources that do not provide rendering metadata.

### No material-detail network dependency

`ParametricApiClient.getMaterialDetails` and the loader call to it are removed. Glass classification must not depend on material names returned by a second service, UE `optimizeParam`, or a CAD bridge method that does not yet exist.

The existing model conversion request is unchanged. The router consumes its returned `material` member directly.

## Classification Rules

| `BimRenderMat` | `IsModel` | Category | Current Three.js behavior |
| --- | --- | --- | --- |
| `0` | `false` | Tiling | Preserve parsed OBJ material; attach goods `ID` and `tiling` semantics. |
| `1` | `false` | Paint | Parse an `MTLCOLOR` color from `MatName`, apply it to the material color, and attach `paint` semantics. |
| `2` | `false` | Grout | Parse an `MTLCOLOR` color, apply it with a non-metallic rough finish, and attach `grout` semantics. |
| `3` | `false` | Glass | Attach `glass` semantics; instance placement creates the transparent glass material. |
| `4` | `false` | Window-frame loft | Preserve an opaque material and attach `window-frame-loft` semantics. |
| `5` | `false` | Material library | Preserve the parsed material and attach the `PT` resource `ID` plus `material-library` semantics. This is the future texture-resolution seam. |
| `0` | `true` | Static soft/hard model | Attach model metadata without overriding the source model material. |
| `6` | `true` | Parametric model/accessory | Attach `MX` metadata without overriding the parsed accessory material. |

Unknown combinations must be marked `unknown` and must preserve the parsed material.

## Color Parsing

`MatName` may contain `MTLCOLOR` followed by six or eight hexadecimal digits and an optional underscore separator.

- Six digits are interpreted as `RRGGBB`.
- Eight digits are interpreted as `AARRGGBB`; the final six digits supply RGB and the first two digits may supply opacity where the category supports it.
- Malformed color markers do not throw and do not alter the original color.

## Error Handling

- Missing or malformed `material` data returns the parsed model unchanged.
- A metadata entry that cannot be matched by `MatName` is retained in normalized model-level metadata for diagnostics but does not alter arbitrary meshes.
- A single invalid entry cannot fail the complete model load.
- The router never performs network requests.
- Existing OBJ parse and model-load error codes remain unchanged.

## Debug Information

Every matched Three.js material receives normalized fields under `userData`:

- `contentMaterialCategory`
- `contentMaterialCode`
- `contentMaterialIsModel`
- `contentBimRenderMat`
- `contentMaterialIsGlass`
- `contentMaterialSource`

The model root retains unmatched model entries in `root.userData.contentModelMaterials` so click/debug output can expose the upstream information without changing rendering.

## Testing

Tests must be written before production changes and must demonstrate their expected failure.

Unit tests cover:

- normalization of object-map and array response shapes;
- all supported `BimRenderMat` and `IsModel` combinations;
- six- and eight-digit `MTLCOLOR` parsing;
- mapping by `MatName` and fallback to an object-map key;
- unknown and malformed entries preserving source materials;
- glass metadata driving transparent per-instance clones;
- cached prototype materials remaining unchanged;
- absence of any material-detail API request during parameterized OBJ loading.

After unit tests pass, run the full test suite and the 3D production build. Browser validation uses the existing debug scene and verifies at least glass, opaque frames, paint colors, and absence of failed material-detail requests in the console/network log.

## Out of Scope

- Downloading or converting UE PAK material assets.
- Resolving real texture maps for tiling or `PT` material-library IDs.
- Reproducing Unreal path-tracing, GI, or lighting settings.
- Changes to the CAD plugin or its C++ bridge.

The attached `PT` and goods IDs deliberately remain available as the stable extension point for a later texture-resolution implementation.
