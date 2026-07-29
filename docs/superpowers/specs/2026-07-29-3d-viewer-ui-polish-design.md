# 3D Viewer Window Materials and UI Polish Design

## Goal

Improve the OCCT 3D preview without changing CAD Plugin code: render only window glass as transparent, make the resource sidebar close reliably, remove the debug cube control and shortcut help, reduce camera sensitivity, and simplify the right-side controls.

## Scope and Constraints

- Modify only the OCCT worktree on branch `codex/ue-typeid-rendering`.
- Do not modify, deploy, stage, or commit `C:\Users\User\Desktop\cad_plugin`.
- Preserve the resource library's draggable basic models; remove only the floating `测试创建立方体` debug button.
- Preserve window frames and other solid window parts as opaque.
- Preserve model placement, TypeId routing, parameter resolution, resource loading, and CAD bridge behavior.
- Keep the page compatible with the existing Vite build and CAD WebView2 runtime.

## Root Causes

### Imported window materials

Local fallback window geometry already uses a transparent material. Static GLB and parameterized OBJ window models retain the materials supplied by their resource, and the content-model pipeline has no window-specific glass post-processing. Consequently, glass meshes whose source material is opaque remain opaque after placement.

### Resource sidebar close behavior

The resource sidebar represents visibility with the `visible` class, while its resize handler also writes an inline `right` value. `hide()` removes only the class, so an inline `right: 0px` can continue to hold the sidebar onscreen. Presentation state therefore has two competing sources of truth.

### Debug cube

`DragDropManager` injects a fixed-position `测试创建立方体` button whenever the page URL ends in `#debug`. This control is unrelated to model debug information and appears in normal development verification pages.

### Camera sensitivity

`SceneManager` enables OrbitControls damping but leaves rotation and panning speeds at the library defaults. On the large architectural scene and current camera distances, those defaults produce abrupt movement.

### Right-side controls

The right-side UI combines high-priority actions with a large static shortcut reference. FPS and auto-rotation indicators are separately positioned, producing excess visual fragmentation and unnecessary panel height.

## Design

### Window glass material normalization

Add a focused material-normalization module used after a content model is cloned and before it is returned from placement. It will run only for instances whose `sourceList` is `window_list`.

For each mesh material, build a case-insensitive semantic label from the mesh name and material name. Treat the material as glass only when that label contains one of the explicit markers `glass`, `玻璃`, or `窗玻璃`. Do not infer glass merely from color, opacity, mesh size, TypeId, or position because those heuristics can make frames and hardware transparent.

For identified glass materials:

- clone the material so cached prototypes and sibling instances are not mutated;
- set `transparent = true`;
- cap opacity at `0.32`, retaining a lower source opacity when present;
- set `depthWrite = false` to avoid an opaque depth mask;
- set `side = THREE.DoubleSide` so panes remain visible from indoors and outdoors;
- set `needsUpdate = true`.

Material arrays are handled per entry. Unidentified materials remain unchanged. The normalizer returns the model root to allow direct composition in placement code.

### Resource sidebar state

Keep the existing public `show()`, `hide()`, `toggle()`, `collapse()`, and `expand()` methods. Make visibility class state authoritative:

- `show()` clears any stale inline `right` value and adds `visible`;
- `hide()` removes `visible`, clears inline `right`, and resets resize state;
- the header close button calls `hide()`;
- resizing changes only width, not the persistent horizontal position.

Collapsed width remains a separate within-sidebar state. Closing hides the sidebar completely; reopening preserves the current tab but expands the sidebar so the user does not reopen into a narrow icon-only state.

### Debug control removal

Remove the debug-button injection and its helper from `DragDropManager`. Keep `#debug` behavior used for model diagnostics and console information elsewhere. Keep all resource-library model entries, including the draggable cube.

### Camera tuning

Configure OrbitControls centrally in `SceneManager`:

- `rotateSpeed = 0.6`;
- `panSpeed = 0.6`;
- `dampingFactor = 0.1`;
- retain existing zoom limits and wheel zoom behavior.

This makes drag movement roughly forty percent less sensitive while the increased damping smooths stopping motion.

### Right-side UI

Keep the existing DOM IDs and application event wiring. Restructure only `index-3d.html` markup and styles:

- place FPS and auto-rotation status in a compact status row aligned with the controls card;
- retain the operation-mode control;
- place Resource Library and Apply Template actions in a two-column action grid;
- retain the two-by-two quick-view grid;
- remove the Edit Shortcuts label, list, and obsolete shortcut styles;
- use consistent spacing, border radius, button height, and subdued section labels;
- keep the card clear of the resource sidebar when it opens.

No new framework or dependency is introduced.

## Testing

Automated tests will be written before production changes and will verify:

- recognized glass material names become transparent without mutating the original material;
- window-frame materials and non-window models remain unchanged;
- material arrays are normalized selectively;
- sidebar `hide()` clears stale inline positioning and reopening expands predictably;
- OrbitControls receive the agreed speed and damping values;
- the HTML no longer contains the shortcut panel;
- `DragDropManager` no longer creates the floating debug cube button.

After focused tests pass, run the full OCCT test suite, `npm run build:3d`, and `git diff --check`. Then reload the local combined fixture page and visually verify window glass, resource-sidebar close behavior, camera movement, and right-side layout.

## Error and Compatibility Behavior

Glass normalization is best-effort and must not cause model loading to fail. Missing names or materials are ignored. Existing resource materials are preserved when they cannot be classified safely. UI changes retain existing element IDs so `App3D` event binding and CAD WebView integration continue to work.
