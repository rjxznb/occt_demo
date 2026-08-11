# Panorama Spatial Navigation Design

## Goal

Improve standalone panorama point placement and navigation by using real three-dimensional furniture collisions, directional WASD point switching, and a compact mini-map card without the separate point-information panel.

## Scope

This change applies only to the standalone panorama page in `occt_demo`. It does not modify the ordinary 3D preview, VR page, CAD Plugin, model loading, point persistence format, or panorama capture pipeline.

## Three-dimensional furniture collision

`collectContentObstacleBounds` will retain all six finite bounds from each content-model root: `minX`, `minY`, `minZ`, `maxX`, `maxY`, and `maxZ`.

The panorama camera collision volume is an axis-aligned clearance box centered on the camera point. The existing `cameraRadius` value of 80 mm is used as its half-size on X, Y, and Z. A furniture obstacle blocks a point only when the expanded obstacle overlaps the camera point on all three axes:

- `x` lies in `[minX - radius, maxX + radius]`;
- `y` lies in `[minY - radius, maxY + radius]`;
- `z` lies in `[minZ - radius, maxZ + radius]`.

Therefore a camera point more than 80 mm above a furniture top, or more than 80 mm below its bottom, remains valid even when its XY projection overlaps the furniture. Obstacles lacking finite Z bounds retain the legacy XY-only behavior for compatibility with older callers and tests; obstacles collected from the Three.js scene always include Z.

Room containment and wall-clearance validation remain planar because CAD room polygons describe the floor plan.

## Directional WASD point navigation

Browsing mode will interpret `W`, `A`, `S`, and `D` as one-shot point-selection commands. Edit mode keeps the existing continuous movement behavior. Arrow keys remain edit-mode movement keys and are not assigned to browse navigation, so the browser and accessibility behavior of arrow keys is unchanged.

A pure directional resolver will receive:

- the active point;
- all valid candidate points;
- the live camera yaw in CAD degrees;
- one of `forward`, `backward`, `left`, or `right`.

The resolver uses the project Z-up basis:

- forward: `(cos(yaw), sin(yaw))`;
- right: `(sin(yaw), -cos(yaw))`;
- backward and left are the corresponding negatives.

For every candidate, it computes the normalized direction from the active point and its dot product with the requested basis. Candidates outside a 60-degree cone are rejected, equivalent to a dot product below `cos(60°) = 0.5`. Remaining candidates are ordered by:

1. largest dot product, meaning the smallest angular deviation;
2. shortest planar distance;
3. stable original point order.

If no candidate qualifies, the active point does not change. A successful command reuses the point-selection state flow, including saving the current live view, but supplies a directional transition pose as described below. Repeated `keydown` events with `event.repeat === true` are ignored so one physical key press triggers at most one transition.

WASD transitions preserve the complete live view from the source point. The transition target combines the selected point's `x`, `y`, and `z` with the source camera's live `yaw`, `pitch`, and `fov`. The 0.8-second transition therefore changes position only and never turns or zooms the camera. The source point still stores its live view before selection, while the destination point's previously stored view remains unchanged. Selecting a point through the mini-map, a panorama hotspot, or the previous/next controls continues to use that destination point's saved view.

The browse-mode key handler prevents the default action only for recognized WASD commands and only when the application is ready and not editing.

## Compact mini-map controls

The standalone point-information panel is removed from `index-panorama.html`, including its point count, point rows, collapse control, and action footer. The application no longer constructs or renders `PanoramaPointList`, and removes the unreachable page-level handlers for rename, delete, set-initial, single-point restore, and point-panel collapse. The underlying `PanoramaPointStore` APIs and persisted draft schema remain unchanged.

`PanoramaMiniMap` owns the complete mini-map card body. Beneath the map stage it renders a two-button action row:

- `新增点位`, invoking `onAdd`;
- `恢复全部`, invoking `onRestoreAll`.

These callbacks reuse `PanoramaApp.beginCreatePoint` and `PanoramaApp.restoreAllPoints`. The separate empty-state “create first point” button remains available.

When the mini-map card is collapsed, both the map stage and action row are hidden. Expanding restores both. Point selection continues through mini-map markers and panorama hotspots.

## Error and edge behavior

- Missing obstacle data keeps the validator's existing degraded mode.
- Invalid or empty Three.js boxes are skipped.
- A missing live camera pose causes WASD navigation to do nothing rather than guessing an orientation.
- Invalid points, the active point itself, and coincident points are excluded from directional selection.
- Directional navigation is disabled while editing, loading, empty, or errored.
- “恢复全部” keeps the existing confirmation prompt and no-op behavior when there are no draft changes.

## Testing

Automated tests will cover:

- collected furniture obstacles include finite Z bounds;
- XY-overlapping furniture above or below the camera does not block placement;
- full XYZ overlap still returns `BLOCKED`;
- each direction uses the live yaw basis and the 60-degree cone;
- angular alignment wins before distance and ties remain stable;
- browse WASD dispatches one directional transition while repeated keys and edit mode do not;
- browse WASD preserves live yaw, pitch, and FOV while changing only the destination position;
- mini-map, hotspot, and previous/next selection still restore the destination point's saved view;
- the panorama page no longer exposes the point-information panel;
- mini-map actions invoke their callbacks and collapse with the map;
- the full test suite and production 3D build remain successful.

Browser QA will confirm camera placement over low furniture, one-step WASD transitions after rotating the view, and the compact mini-map layout.
