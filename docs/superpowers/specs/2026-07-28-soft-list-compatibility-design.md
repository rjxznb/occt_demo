# Soft-list compatibility restoration design

## Goal

Restore the previously working parameterized `soft_list` rendering path without blocking the newer all-content model pipeline, while preventing the same CAD instance from being rendered twice.

## Confirmed cause

Commit `ecc3cd3` replaced the scene's `loadParametricModels(data.softlists.softlists, ...)` call with `loadContentModels(data.contentModels.contentModels, ...)`. That made existing soft furnishings depend on the new iframe-to-native batch RPC path. When that path does not start in CAD, both the new content models and the formerly working parameterized soft furnishings disappear.

## Design

`RoomRenderer` will route content through two explicit sets:

1. Legacy soft furnishings come from `data.softlists.softlists` and are loaded by `loadParametricModels` using the original per-resource `getParametricGoodsDetail` behavior.
2. The unified loader receives `data.contentModels.contentModels` after excluding `sourceList === "soft_list"`; it continues handling other CAD `*_list` fields through the batch/static-or-parametric pipeline.

The split is based on normalized `sourceList`, not category or model type, because the source list identifies ownership unambiguously. It also prevents the same `soft_list` record from entering both loaders.

## Compatibility-loader requirement

`ParametricModelLoader` must regain an independent legacy implementation. It must not delegate to `ContentModelLoader`, otherwise restoring the call site would still leave soft furnishings dependent on the broken batch bridge.

The restored loader will keep the established external API and debug metadata used by click inspection. No CAD native bridge API or WebView entry is changed by this repair.

## Failure handling

The two asynchronous loads are isolated. A failure in the unified non-soft pipeline must not cancel or suppress legacy soft furnishings, and a failed soft furnishing must not prevent other content models from loading. Each path retains a distinct diagnostic prefix so CAD runtime logs identify which boundary failed.

## Verification

Automated regression coverage will prove:

- `soft_list` instances are excluded from the unified loader input.
- legacy soft-list input invokes the independent per-resource detail/conversion path.
- non-soft content instances still reach `ContentModelLoader`.
- scene integration does not duplicate soft furnishings.
- the existing content-loader and scene test suites remain green.

Runtime validation remains necessary in AutoCAD because the final WebView-to-C++ bridge cannot be fully exercised by the frontend unit tests.
