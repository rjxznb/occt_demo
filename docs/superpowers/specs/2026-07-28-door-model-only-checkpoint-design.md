# Door-model-only checkpoint design

## Goal

Make `door_list` render only backend-resolved real models so the user can validate door count, placement, orientation, and size without local Box geometry obscuring failures.

## Scope

- Process only `door_list` in this checkpoint.
- Keep the existing `window_list` Box behavior unchanged.
- Do not change soft furnishings, rooms, walls, VR navigation, or the CAD native bridge API.

## Rendering behavior

- Do not add visible local door Box meshes to the scene.
- Continue using door geometry required only as CSG cutters for wall openings; cutters must remain non-visible and must not become click targets.
- Send normalized `door_list` instances through the existing unified content-model pipeline.
- A successfully placed backend door model is visible and clickable.
- A failed door selection, request, download, parse, or placement leaves the corresponding opening empty; it must not restore a visible Box fallback.
- Window Box meshes remain visible and retain their existing success/failure fallback behavior until the next checkpoint.

## Diagnostics

Door failures log only allowlisted fields: `sourceList`, `sourceIndex`, `typeId`, `resId`, and `errorCode`. Signed URLs, raw responses, tokens, and model payloads must not be logged.

## Verification boundary

Automated tests will prove that visible door Boxes are omitted, door cutters remain available for CSG, window Boxes are unchanged, door instances still enter the unified loader, and door failures do not recreate visible fallbacks. After tests and the 3D build pass, the build output will be synchronized to both the CAD resource directory and `ke_arx_cache`, then work will stop for user validation in AutoCAD.
