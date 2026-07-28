# Unified Content-Model Discovery and Dispatch Design

## Goal

Every array-valued `*_list` in a CAD drawing JSON must participate in one
content-resource decision before rendering. List names must not decide whether
an object is static, parameterized, or locally generated. Objects with no usable
model resource keep their existing local geometry behavior.

This design applies to the standalone OCCT renderer and its Node transport. It
must preserve the existing CAD bridge contracts for later integration, but this
checkpoint does not modify, synchronize, stage, or commit the `cad_plugin`
repository.

## Current Gaps

The current registry enumerates only `soft_list`, `door_list`, `window_list`,
and `radiator_list`. The scene orchestrator then removes `soft_list` from the
unified content loader and sends it through a legacy parameterized-only path.
Consequently:

- newly exported `*_list` fields can be silently omitted;
- a list name can incorrectly predetermine resource kind;
- static objects inside a traditionally parameterized list cannot use the
  static loader;
- parameterized windows currently receive generic furniture parameter names,
  producing incorrect dimensions.

Resource dispatch after detail lookup already has the correct fundamental
boundary: resource type 1 is a static Web GLB and resource type 8 is a
parameterized Web JSON resource. The redesign preserves and strengthens that
boundary.

## Architecture

### Dynamic discovery

The registry scans every own property whose name ends with `_list` and whose
value is an array. Each record containing a non-empty `TypeId` becomes a
candidate with stable identity `sourceList:sourceIndex`.

Discovery captures only source facts:

- source list and source index;
- TypeId;
- BasePoint, Points, Size, and outer transform fields;
- BlockInnerInfo;
- an existing local-renderer/fallback identity when one exists.

Discovery does not classify a candidate as static or parameterized.
Non-array `_list` properties and records without TypeId are ignored safely.

### Template selection and local-geometry classification

Every candidate is checked against `template.json` using the existing UE-style
TypeId mapping and resource selection rules.

- A selected ResId enters the batch detail request set.
- A missing template entry or an entry with no usable resource becomes
  `local-geometry` and does not trigger a detail request.
- Known opening-only types such as TypeId `1307` remain `opening-only` rather
  than acquiring a guessed resource.

Rooms, independent walls, niches, pillars, and similar structural objects keep
their existing local geometry when no model resource is selected. The unified
pipeline must not invent a Box or other fallback that did not already exist.
Door failures therefore continue to leave openings empty, while existing
window and structural fallbacks remain visible.

### Detail lookup and resource-kind dispatch

Selected ResIds are deduplicated and requested through the existing batch
transport. CAD embedding continues to use `getContentGoodsDetails`; standalone
mode continues to use `POST /api/getContentGoodsDetails`.

Resource kind is determined only from detail data:

- type 1 with a valid `webV2Url`: `static-glb`;
- type 8 with a valid `parameterizedWebJsonUrl`: `parametric-obj`;
- type 8 without a usable Web URL may fall back to `parameterizedJsonUrl` for
  compatibility;
- supported resources with missing URLs and unknown resource types remain
  isolated failures and keep any existing local fallback.

The source list never participates in this dispatch decision. One list may
therefore contain static, parameterized, and local-geometry objects.

## Parameter Resolution

Parameterized resources all use the same conversion transport, but parameter
names are resolved by a dedicated `ParametricParameterResolver` rather than by
generic registry normalization.

Resolution priority is:

1. Type-specific semantic adapter.
2. `ModelParamterMap` from the selected template entry when populated.
3. Generic compatibility aliases for ordinary content models.
4. No overrides, allowing the resource's defaults, when no reliable mapping is
   available.

Type-specific adapters are required when CAD field semantics do not match model
parameter names. The initial verified mappings are:

### Standard window, TypeId 1401

| Parameter model name | CAD source |
| --- | --- |
| `宽度` | `BlockInnerInfo.长` |
| `高度` | `BlockInnerInfo.高度` |
| `离地` | `BlockInnerInfo.离地高度` |
| `墙厚` | `BlockInnerInfo.宽` |

### Corner window, TypeId 1407

| Parameter model name | CAD source |
| --- | --- |
| `右宽`, `左宽` | `BlockInnerInfo.长`, `BlockInnerInfo.宽`, with orientation resolved from the footprint |
| `高度` | `BlockInnerInfo.高度` |
| `离地` | `BlockInnerInfo.离地高度` |
| `右墙厚`, `左墙厚` | `BlockInnerInfo.外边长`, `BlockInnerInfo.外边宽`, aligned with the corresponding side |

The corner adapter must use footprint direction to assign left and right; it
must not rely only on object-property order.

Generic aliases retain current soft-content compatibility, including ordinary
length, width, and height names. Parameters are deduplicated by final name,
limited to 64 entries, and include only finite numeric values at this boundary.
Scene position, rotation, horizontal flip, vertical flip, and ground placement
remain scene transforms and are not model-size parameters.

Parameterized resources with no usable overrides still call the parameterized
conversion endpoint. They never switch to the static loader merely because
their CAD parameter mapping is empty.

## Irregular Geometry

TypeId `140d02` is not treated as an ordinary window adapter in the first
implementation checkpoints. Drawing2 exports it with zero X/Y Size, irregular
six- or ten-point footprints, and no matching template resource. It therefore
remains on its existing local geometry path while its dedicated free-window
construction or resource mapping is investigated separately.

Multi-point footprints are not collapsed to an axis-aligned bounding rectangle
for parameterization. Points remain available to both type-specific adapters
and local geometry renderers.

## Scene Integration and Fallbacks

Local geometry may be created by the existing renderers before asynchronous
content lookup completes. A model placement is transactional from the user's
perspective:

1. load or convert the prototype;
2. parse and validate its Mesh content;
3. compute placement from source transforms and footprint;
4. add the placed root to the scene;
5. only then hide the matching existing fallback.

Failures before step 4 cannot hide a fallback. Observer and diagnostic failures
after placement cannot remove a successfully placed model.

Legacy `soft_list` loading is retired only after the unified path has regression
coverage for static and parameterized soft objects. During the transition, the
same source identity must never be rendered by both pipelines.

## State and Diagnostics

Each discovered object ends in one of these states:

- `local-geometry`: no usable model selection; existing renderer remains;
- `static-pending` or `parametric-pending`: resource selected and loading;
- `placed`: real model inserted; matching fallback hidden;
- `fallback-visible`: selected resource failed; existing fallback retained;
- `opening-only`: intentional opening with no visible fallback.

The scene summary is emitted as a directly readable numeric log line containing
at least:

```text
discovered localGeometry staticSelected parametricSelected placed fallbackVisible openingOnly failed
```

Failure records expose only `sourceList`, `sourceIndex`, `typeId`, `resId`,
`resourceKind`, and `errorCode`. Signed URLs, upstream bodies, raw model data,
tokens, and response contents are never logged.

## Error Handling

Discovery, template selection, batch detail lookup, resource resolution,
prototype loading, conversion, parsing, and placement isolate failures per
object wherever possible. A failed batch may mark only its selected records;
successful batches and unrelated local geometry continue.

Stable error codes are retained for invalid inputs, missing templates,
unsupported resources, network failures, model parse failures, and placement
failures. A top-level pipeline exception is diagnostic only and must not tear
down the rest of the room scene.

## Testing Strategy

### Discovery tests

- discover every array-valued `*_list` without a whitelist;
- retain source list and original source index;
- ignore non-array fields and records without TypeId;
- retain irregular Points and zero Size candidates long enough to choose local
  geometry instead of silently dropping them.

### Classification tests

- classify static and parameterized resources from detail data, never list
  names;
- support a static and a parameterized object in the same source list;
- avoid detail requests for local-geometry and opening-only records;
- preserve partial successes across failed batches.

### Parameter tests

- generate verified 1401 standard-window parameters;
- assign 1407 side widths and wall thicknesses using footprint orientation;
- retain generic soft-content aliases;
- deduplicate names, reject non-finite values, and enforce the 64-entry limit;
- use empty overrides for unknown parameterized types without changing their
  resource kind.

### Scene tests

- hide an existing fallback only after successful scene insertion;
- retain structural and window fallbacks on every failure phase;
- preserve opening-only behavior for 1307 and door failures;
- prevent double-rendering while the legacy soft path is retired.

### Runtime checkpoints

1. Verify dynamic discovery and resource dispatch without visual regressions.
2. Verify 1401 standard-window dimensions and placement.
3. Verify 1407 corner-window dimensions, side assignment, and placement.
4. Investigate and implement 140d02 free-window geometry separately.

Each checkpoint runs focused tests, the complete OCCT suite, the production 3D
build, and a standalone browser validation against Drawing2 before user review.

## Repository Boundaries

Implementation is limited to:

- `D:\occt_demo\.worktrees\cad-renderer-parametric-bridge`;
- `C:\Users\User\Desktop\parametric-lab\backend` only if the established
  transport contract requires a verified backend fix.

No file in `C:\Users\User\Desktop\cad_plugin` may be modified, synchronized,
staged, committed, reset, or discarded during these checkpoints.
