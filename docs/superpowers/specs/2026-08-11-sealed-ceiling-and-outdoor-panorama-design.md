# Sealed Ceiling and Outdoor Panorama Design

## Goal

Improve indoor camera-preset preview in the 3D viewer in two ways:

1. The ceiling must completely cover the dwelling without narrow gaps over wall bands or between adjacent room polygons.
2. Transparent windows must reveal a lightweight outdoor scene that is available offline and does not require a server request.

The normal bird's-eye editor view must remain open from above, and current real-time interaction performance must be preserved.

## Current Behavior and Root Cause

`RoomRenderer` currently creates one ceiling mesh by cloning each room floor mesh and moving it to `z = 2800` mm. Room floor polygons describe interior clear space, not the complete structural footprint. Wall thickness and small discontinuities between adjacent room polygons are therefore not covered, which produces visible ceiling gaps from an indoor viewpoint.

Window glass is already normalized to a transparent material. The scene behind it, however, is only a blue-gray vertical gradient. The glass transmits the background, but there is no recognizable outdoor scenery.

## Chosen Design

### Complete ceiling slab

Build the primary ceiling from `data.outline.outlineRings` instead of from room floors:

- Create a `THREE.Shape` from `outlineRings.outer`.
- Add every valid `outlineRings.holes` entry as a `THREE.Path` hole.
- Generate a flat, double-sided mesh at `z = 2800` mm.
- Use the existing neutral ceiling material.
- Mark the mesh as `userData.type = "ceiling"`.
- Keep it hidden in the ordinary bird's-eye view.
- Show it when a camera preset becomes active and hide it when preset preview exits.

The outline covers the structural wall bands as well as the room interiors, so a single slab closes the gaps without polygon expansion or overlapping room meshes.

If no valid outline ring is available, retain the existing room-floor ceiling meshes as a fallback. The fallback remains hidden outside camera-preset preview.

### Local procedural outdoor panorama

Introduce a small component responsible only for generating and owning the outdoor background texture. It will:

- Draw a 2048 x 1024 equirectangular canvas once during scene initialization.
- Include a soft sky gradient, horizon haze, distant low-contrast buildings, layered tree silhouettes, and a muted ground band.
- Avoid text, logos, identifiable landmarks, remote URLs, and runtime downloads.
- Configure the resulting `THREE.CanvasTexture` for equirectangular background mapping and sRGB color space.
- Assign it to `scene.background` while leaving the existing PMREM `scene.environment` unchanged, so authored PBR materials retain their current lighting response.
- Dispose the canvas texture during `SceneManager.destroy()`.

The panorama is intentionally distant and low contrast. It supplies readable scenery through transparent windows without competing visually with the interior or requiring 3D exterior geometry.

### Lighting behavior

The ceiling will receive light but will not cast shadows. This preserves the current bright preview and avoids turning interiors dark when entering a preset point. Existing directional, hemisphere, ambient, and PMREM lighting remain unchanged.

Window materials continue to use the existing transparent-glass normalization. No fake emissive window material is introduced.

## Component Boundaries

### `RoomRenderer`

- Builds the outline-based ceiling and room-based fallback.
- Owns the ceiling mesh collection.
- Exposes `setCeilingsVisible(visible)` without knowledge of camera controls.

### `App3D`

- Shows ceilings after a camera preset is successfully entered.
- Hides ceilings before restoring the previous camera state.

### `OutdoorPanorama`

- Generates and owns only the procedural background texture.
- Has no dependency on CAD data, camera presets, or room geometry.
- Exposes creation and disposal behavior that can be tested independently.

### `SceneManager`

- Installs the generated panorama as the scene background.
- Disposes it with the rest of the scene resources.
- Keeps the existing environment lighting texture separate.

## Error Handling and Fallbacks

- Invalid outer rings do not abort room rendering; room-floor ceilings are used instead.
- Invalid hole rings are ignored individually.
- Failure to obtain a 2D canvas context falls back to the existing gradient background.
- Outdoor panorama creation never performs network I/O.
- Resource disposal must be safe when initialization was only partially completed.

## Testing

Use test-driven development for each behavior:

1. A failing ceiling-geometry test proves that a valid outline creates one primary ceiling with preserved holes, rather than one ceiling per room.
2. A failing fallback test proves invalid or missing outline data retains room-based ceilings.
3. Existing visibility tests continue to prove entry shows ceilings and exit hides them.
4. A failing outdoor-panorama test proves the generated texture is local, equirectangular, sRGB, reusable, and disposable.
5. Full unit tests and `build:3d` must pass.
6. Browser validation with `fixture=cameras` must confirm:
   - the indoor ceiling is visually sealed;
   - scenery is visible through transparent windows;
   - exiting restores an unobstructed bird's-eye view;
   - the browser console has no errors.

## Out of Scope

- Photorealistic HDR downloads or server-side environment APIs.
- Low-poly exterior buildings or trees with camera parallax.
- Per-room decorative suspended-ceiling profiles.
- Changing the CAD camera data format.
- Changing window model placement or material-detail resolution.
