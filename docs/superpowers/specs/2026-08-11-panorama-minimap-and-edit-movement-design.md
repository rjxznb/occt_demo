# Panorama Mini-map and Edit Movement Design

## Goal

Make the standalone panorama mini-map match the original 3D page's light, fine-line appearance, remove camera direction rays, and make point editing move relative to the live viewing direction without snapping the camera.

## Mini-map

- Keep the existing `PanoramaMiniMap` layout and point selection behavior.
- Use the original 3D mini-map's light stage, pale room fills, 1.4 px rounded outlines, and yellow/blue circular markers.
- Do not create or render `.panorama-map-direction` elements.
- Retain active and dirty marker states, collapse behavior, and point creation.

## Edit movement

- Treat the live `SceneManager.getCameraPresetPose()` yaw as the source of truth for every movement step.
- Pass that yaw into `PanoramaEditController.applyMovement` so movement follows the direction currently visible to the user, including view rotations made after edit mode starts.
- Use the camera-right basis `(sin(yaw), -cos(yaw))`; this makes D/right move to the visible right and A/left move to the visible left in the project's Z-up coordinate system.
- Position previews update position only. They must not reset yaw, pitch, or FOV.
- When saving, capture the live camera view into the edit controller before committing so the final draft includes the user's current orientation.
- Cancelling restores the entry point and entry view snapshot.

## Verification

- Unit tests cover absence of direction-line elements, right/left movement basis, live-yaw movement, and position-only preview behavior.
- The complete test suite and production build must pass.
- Browser QA covers rotating during edit mode, then moving, and confirms that the view does not snap back.

