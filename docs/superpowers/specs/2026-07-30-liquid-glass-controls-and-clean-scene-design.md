# 3D Viewer Liquid Glass Controls and Clean Scene Design

## Goal

Apply the approved Apple-inspired Liquid Glass treatment to the persistent right-side 3D viewer controls, and return the visible verification page to the real bundled Drawing2 scene without synthetic TypeId fixtures.

This change is limited to OCCT. It does not modify or deploy CAD Plugin files.

## Scope

### Included

- Restyle the fixed `#controls` panel in `index-3d.html` using the approved light Liquid Glass direction.
- Reduce the panel from 208px to exactly 154px wide at the normal desktop breakpoint.
- Preserve the existing controls, event bindings, IDs, and behavior.
- Keep status, operation, resource, and quick-view controls readable at the smaller size.
- Verify the normal Drawing2 entry without a `fixture` query parameter.
- Remove synthetic TypeId models from the user-facing verification tab by navigating to the clean URL.

### Excluded

- No CAD Plugin changes or deployment.
- No new controls or interaction modes.
- No change to the resource sidebar's information architecture.
- No deletion of `src/dev/SceneFixtures.js` or its automated tests. Fixtures remain opt-in development tools and are never injected when the URL has no exact supported `fixture` value.
- No use of TypeId-specific production filtering to hide models from a real CAD drawing.

## Visual Design

The persistent panel becomes a compact floating glass surface:

- width: `154px` at the normal desktop breakpoint;
- light, translucent layered gradient rather than a flat dark fill;
- `backdrop-filter` using blur, saturation, and mild contrast;
- a bright top-left specular highlight and a subtle blue environmental reflection;
- thin white translucent border with inset highlights;
- soft neutral shadow that separates the panel from the 3D scene;
- rounded outer corners around `22px`;
- Apple system blue for the active viewing mode;
- neutral translucent buttons for secondary actions;
- compact type and spacing sized for the reduced panel.

Pseudo-elements create only decorative reflections and must use `pointer-events: none`. The actual control content stays above them with an explicit stacking layer.

## Interaction and Accessibility

- Existing button IDs and JavaScript bindings remain unchanged.
- Hover feedback uses a small brightness/scale response without moving surrounding layout.
- Focus-visible controls retain an obvious blue outline.
- Text remains dark enough to read over the light surface.
- Browsers without backdrop-filter support receive an opaque light fallback, so the panel remains usable rather than transparent and illegible.
- The four quick-view controls stay in a two-column grid.

## Clean Scene Behavior

Synthetic TypeId models are controlled exclusively by the exact `fixture` query parameter through `withSceneFixture`. The normal verification URL is:

`http://127.0.0.1:4179/index-3d.html?codex=liquid-glass-20260730#debug`

It intentionally omits `fixture=ue-specials`. Therefore the scene contains only objects from the bundled Drawing2 data while the fixture implementation remains available for regression testing.

## Verification

- Add a focused style contract test for the compact Liquid Glass surface and its fallback.
- Keep the existing scene-fixture tests to prove fixtures are opt-in and exact-match only.
- Run the complete OCCT test suite.
- Run `npm run build:3d`.
- Run `git diff --check`.
- Reload the clean URL and visually verify:
  - the panel matches the approved light Liquid Glass direction;
  - controls remain legible and clickable;
  - the panel is materially smaller than the current 208px version;
  - no `ue-specials` synthetic TypeId models appear;
  - the real Drawing2 scene still loads normally.
