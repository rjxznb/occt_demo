# 140d02 Free-Window Rendering Design

## Goal

Render the two `window_list` TypeId `140d02` records in `Drawing2.json` as
the same composite parameterized windows produced by the UE implementation.
Each free-window outline is decomposed into standard and arc window segments,
then every segment follows the existing unified template, detail, conversion,
placement, and debug pipeline.

This work is an extension of the unified content-model pipeline. It does not
restore a second window-only loader and does not add a direct `140d02` resource
mapping.

## Verified Reference Behavior

The implementation is based on these verified facts:

- `Drawing2.json` contains exactly two `window_list` records with TypeId
  `140d02`. Their CAD `Size` values are zero, but their `Points` contain an
  even number of vertices and nonzero bulges.
- `template.json` contains no `140d02` entry and therefore no `140d02` ResId.
- The UE mapping identifies `140d02` as `FreeWindow`.
- UE calls `SplitPointsToRectangleAndArcSegments`, maps straight segments to
  TypeId `1401`, and maps arc segments to TypeId `140c`.
- The current template maps `1401` to ResId `2406313` and `140c` to ResId
  `2423932`.
- Both details currently resolve as type-8 parameterized web resources.
- UE derives arc-window parameters named `弦长`, `拱高`, `窗扇数量`, and
  `高度`, and places an arc window at its arc apex with its local right axis
  pointing toward the circle center.

For the checked-in `Drawing2.json`, deterministic decomposition must produce:

- `window_list:1`: one `1401` segment and one `140c` segment;
- `window_list:2`: three `1401` segments and one `140c` segment;
- total: four `1401` segments and two `140c` segments.

## Scope

### Included

- Preserve CAD bulge paths during content-model discovery.
- Decompose only exact TypeId `140d02` before template classification.
- Reproduce UE straight/arc segment classification and geometry adjustment.
- Route all generated segment candidates through `ContentModelLoader`.
- Resolve `140c` parameters and placement from its adjusted CAD arc.
- Treat every original free window as an all-or-nothing composite for visible
  scene insertion and fallback hiding.
- Preserve safe click-debug identity for both the original free window and the
  generated segment.
- Add focused unit, integration, Drawing2 coverage, and browser checkpoint
  verification.

### Excluded

- Procedurally modeling a replacement window frame in Three.js.
- Inventing a `140d02` template entry or backend resource.
- Modifying the backend transport or CAD plugin.
- Extending the same custom-shape decomposition to `140e` railings in this
  change.
- Changing the existing wall-opening cutter geometry.

## Data Model

### Preserved CAD path

`ContentModelRegistry` adds a normalized `cadPath` to each discovered candidate:

```js
cadPath: Array<{ x: number, y: number, z: number, bulge: number }>
```

Only finite values are retained. Missing Z and bulge values normalize to zero.
The existing sampled `footprint` remains unchanged for fallback geometry and
ordinary content placement. `cadPath` is the authoritative source only for
custom-shape decomposition and arc mathematics.

### Generated segment identity

A pure free-window adapter consumes discovered candidates and returns either
the original candidate or generated children. Every generated child contains:

```js
{
  instanceId: "window_list:1#segment:0",
  sourceList: "window_list",
  sourceIndex: 1,
  parentInstanceId: "window_list:1",
  compositeSegmentIndex: 0,
  compositeSegmentCount: 2,
  generatedFromTypeId: "140d02",
  typeId: "1401" | "140c",
  cadPath,
  footprint,
  size,
  basePoint,
  groundHeight,
  rawBlockInnerInfo
}
```

`sourceList` and `sourceIndex` intentionally remain the original CAD identity.
The child `instanceId` is unique for loading and debugging. The parent identity
controls fallback visibility and source-level summary counting.

## Decomposition Algorithm

The adapter reproduces UE's `SplitPointsToRectangleAndArcSegments` contract:

1. Require at least four points and an even point count.
2. Split the path into equal front and back halves.
3. Reverse the back half so front and back points correspond.
4. For every adjacent pair in the front half, construct one four-point strip
   from the matching front and back edges.
5. A segment is an arc when the first front vertex has a nonzero bulge within
   the UE-compatible tolerance. Otherwise it is straight.
6. Straight strips are adjusted to a centered, consistent-thickness rectangle
   and emitted as TypeId `1401`.
7. Arc strips retain the inner arc, calculate the corresponding offset outer
   arc, normalize the point order to the UE `140c` convention, and emit TypeId
   `140c`.

The input path is already in final CAD world coordinates. Generated candidates
must not apply the parent `OutXScale`, `OutYScale`, rotation, or flips again to
their world-space footprint. Original signs may be retained as debug metadata,
but they are not an additional scene transform.

If validation or any segment calculation fails, the adapter returns the
original `140d02` candidate unchanged. Classification then retains its current
local-geometry fallback without issuing a detail request.

## Template and Resource Dispatch

Expansion runs after discovery and before template classification. The
classifier therefore sees normal `1401` and `140c` candidates and remains free
of list-name or composite-type special cases.

The existing resource rules remain authoritative:

- `1401` selects ResId `2406313` from `template.json`;
- `140c` selects ResId `2423932` from `template.json`;
- detail data, not TypeId or source-list name, decides static versus
  parameterized dispatch;
- both current resources resolve through the parameterized conversion path;
- no request is made for `140d02` itself.

## Parameter Resolution

### Standard segments

Generated `1401` candidates reuse the existing standard-window adapter. The
adapter receives generated semantic values equivalent to:

- window width: the adjusted segment length in millimeters;
- wall thickness: the adjusted segment depth in millimeters;
- height: the original `140d02` height;
- ground height: the original `140d02` ground height.

### Arc segments

The `140c` adapter derives values from the normalized inner arc:

- `弦长`: absolute inner-arc chord length in millimeters;
- `拱高`: absolute inner-arc sagitta in millimeters;
- `窗扇数量`: `ceil(arcLengthMillimeters / 600)` with a minimum of one;
- `高度`: the original `140d02` height in millimeters.

Scene transforms, arc center coordinates, URLs, resource IDs, and bulge values
are not conversion parameters. The existing finite-number, unique-name, and
64-parameter limits continue to apply.

## Arc Placement

`ContentModelPlacement` adds a TypeId `140c` placement adapter:

1. Read the adjusted inner arc from points 3 to 0, matching the UE convention.
2. Compute its circle center and arc apex from the chord and bulge.
3. Place the model origin at the world-space arc apex.
4. Rotate the model around world Z so its local positive X direction points
   from the arc apex toward the circle center.
5. Apply the existing parameterized-model axis normalization so the model is
   upright in the Z-up scene.
6. Align the model bottom to the original free window's ground height.
7. Do not scale the converted model to the CAD bounding box a second time; the
   parameterized output already embodies chord, sagitta, sash count, and
   height.

The generated straight segments continue to use the existing `1401` placement
path and their adjusted rectangular footprints.

## Composite Scene Commit

Each original `140d02` is one composite. Its generated roots are initially
inserted into an identity staging group rather than directly into the visible
room group.

- If every expected segment is placed, the staging group is attached to the
  room group, each child root is marked as content-model content, and the
  original `window_list:sourceIndex` fallback is hidden once.
- If any segment fails selection, detail lookup, conversion, parsing, or
  placement, the staging group is discarded and the original fallback remains
  visible.
- Successful children from an incomplete composite must never remain visible
  over the fallback.
- Ordinary non-composite content keeps its existing incremental insertion and
  fallback behavior.

The loader receives a narrow placement-target callback so generated composite
children can select their staging group. The orchestration layer owns composite
commit or rollback; resource resolution and conversion remain entirely inside
`ContentModelLoader`.

## Summary and Diagnostics

The exact existing summary shape remains unchanged.

- `discovered` counts unique original CAD source identities, so expanding two
  free windows into six segments does not inflate the source-object count.
- `staticSelected`, `parametricSelected`, and `placed` count actual segment
  load units.
- Rolled-back composite children do not count as terminally placed.
- A failed composite counts its original visible fallback once, even if more
  than one child fails.

Failure logs retain the loader's exact existing allowlist:
`sourceList`, `sourceIndex`, `typeId`, `resId`, `resourceKind`, and `errorCode`.
For a generated failure, `typeId` is the generated `1401` or `140c` TypeId;
`sourceList` and `sourceIndex` still identify the original free window. Segment
details remain available only in bounded click-debug data. Signed URLs,
response bodies, model data, and unbounded exception text remain prohibited.

Click debug information for a generated child includes safe values for:

- original identity (`window_list:n`, source TypeId `140d02`);
- segment identity and index;
- generated TypeId (`1401` or `140c`);
- selected ResId and resource kind;
- finite derived parameters and placement facts.

## Test Strategy

### Pure geometry tests

- Reject odd, short, non-finite, and structurally invalid paths without partial
  expansion.
- Prove straight and arc classification follows the first front bulge.
- Prove reversed back-half pairing and deterministic child order.
- Prove adjusted arc point order matches the `140c` inner-arc convention.
- Prove input world coordinates are not transformed a second time.

### Drawing2 regression

- Assert exactly two original `140d02` source identities.
- Assert expansion produces four `1401` and two `140c` children in stable order.
- Assert no `140d02` ResId request is created.
- Assert request selection includes `2406313` and `2423932`.

### Parameter and placement tests

- Assert literal chord, sagitta, arc length-derived sash count, height, and
  ground values for both checked-in arc segments.
- Assert the arc model is upright, its origin equals the computed arc apex, its
  heading points toward the circle center, and its bottom is at 900 mm.
- Assert no footprint scale is applied after parameterized conversion.

### Composite integration tests

- All children succeed: commit exactly one composite group and hide exactly one
  parent fallback.
- Any child fails: commit no child roots and retain the parent fallback.
- Ordinary windows preserve their current immediate placement behavior.
- Summary and diagnostic counts use source identities and terminal composite
  state rather than transient staged roots.

### Runtime checkpoint

After focused tests, the complete OCCT test suite and `build:3d` succeed, reload
`http://127.0.0.1:4179/index-3d.html` and inspect only the two free windows:

- both contain all expected straight and arc model segments;
- the arcs follow the CAD footprints and face the correct direction;
- every segment is upright and begins at the 900 mm ground height;
- no original fallback overlaps a completed composite;
- no half-composite remains visible after a child failure;
- console output contains no `140d02` detail request and no unsafe diagnostics.

Stop for user visual approval after this checkpoint. Do not proceed to CAD
deployment or broader final acceptance until both windows are confirmed.

## Repository Boundary

All source, tests, documentation, and build work stays inside:

`D:\occt_demo\.worktrees\cad-renderer-parametric-bridge`

The backend may be inspected but is modified only if runtime evidence proves a
transport defect. `C:\Users\User\Desktop\cad_plugin` must not be modified,
staged, committed, synchronized, reset, or cleaned.
