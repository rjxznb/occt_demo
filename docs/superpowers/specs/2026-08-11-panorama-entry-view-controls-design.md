# Panorama Entry View and Control Layout Design

## Goal

Make the standalone panorama page open at an explicitly authored entry point and live camera view, simplify the chrome around the panorama, and make position adjustment a clearly signaled temporary mode.

## Scope

This change applies only to the standalone panorama page in `occt_demo`. It does not modify CAD Plugin, invoke a rendering service, or implement offline panorama submission.

## Entry View Semantics

The entry view is composed of:

- the active panorama point ID;
- the live camera `yaw`;
- the live camera `pitch`;
- the live camera `fov`.

The existing persisted `initialPointId` and per-point `views` fields remain authoritative. The store will expose one atomic operation that validates the point, writes its live view, makes it the initial point, persists once, and notifies once.

On every fresh page initialization, the valid `initialPointId` takes precedence over `lastActivePointId`. Ordinary point switching during the same page session remains unchanged. If the saved initial point no longer exists or is invalid, initialization falls back to the first valid point.

The mini-map card contains a new button labelled `设为进入视角`. Clicking it captures the current scene-manager camera pose and commits the active point and view together. Invalid or unavailable camera state produces no write and shows a concise failure toast; a successful write shows a success toast.

## Layout

The existing top information bar is removed completely, including its plan, room, point, white-model badge, edit button, and disabled generation placeholder.

The mini-map Liquid Glass card moves from the upper-left to the upper-right. Its expanded action area contains:

- `新增点位`;
- `恢复全部`;
- `设为进入视角`.

The existing bottom-center browse controls and edit controls remain in their current roles.

A compact Liquid Glass action dock is added to the lower-right with:

- `位置微调`, replacing the old `编辑点位` label and action;
- `提交渲染`, retained as a UI-only placeholder with no network, native bridge, capture, or offline-render side effect.

The lower-right dock remains visible during adjustment. While adjustment is active, both the adjustment button and `提交渲染` are disabled. Saving or cancelling adjustment restores both buttons to their browse-mode state. Loading, empty, and error phases keep actions disabled when there is no valid active point.

## Adjustment Visual State

Position adjustment uses the approved `A · 雾蓝边缘` treatment. The panorama viewport receives a non-interactive overlay made from layered, low-saturation grey-blue inset shadows:

- a narrow, slightly stronger edge light;
- a broad, faint secondary bloom;
- smooth opacity transitions on entry and exit;
- no pure electric blue, hard outline, flashing, or obstruction of panorama input.

The effect is active only while the app body has the existing `panorama-editing` state class. It must honor `prefers-reduced-motion` by removing the transition while retaining the static state indication.

## Component Responsibilities

### `PanoramaPointStore`

- Persist the entry point and its view atomically.
- Prefer the saved initial point during fresh initialization.
- Preserve existing in-session point selection and draft compatibility.

### `PanoramaMiniMap`

- Render the new entry-view action.
- Report intent through an `onSetEntryView` callback.
- Continue owning add, restore, select, collapse, and create interactions.

### `PanoramaApp`

- Read the current live pose from `SceneManager`.
- Delegate the atomic entry-view write to the store.
- Coordinate success/failure feedback.
- Keep lower-right action availability synchronized with phase and edit mode.

### Page and styles

- Remove the top bar markup and unused top-bar styles.
- Add the lower-right action dock markup.
- Move the mini-map to the upper-right.
- Add the approved edit-mode edge treatment and responsive placement.

## Error and Fallback Behavior

- No active point: the entry-view action is unavailable.
- No finite live `yaw`, `pitch`, or `fov`: no state is persisted and a failure toast is shown.
- Repository save failure follows the store's existing persistence-result behavior and must not crash the page.
- Deleted or invalid initial point: the next fresh initialization selects the first valid point.
- `提交渲染` intentionally has no click side effect in this scope.

## Testing

Automated tests will verify:

- fresh initialization always prefers `initialPointId` over `lastActivePointId`;
- setting an entry view persists point ID and yaw/pitch/FOV in one observable change;
- invalid points and incomplete live poses do not change the entry view;
- the mini-map renders and reports the new action;
- the app captures the active live camera pose for the action;
- ordinary browse/edit behavior remains unchanged;
- `提交渲染` is disabled during adjustment and restored after save or cancel;
- the page contract removes the top bar and includes the lower-right action dock;
- CSS places the mini-map upper-right and provides the approved reduced-motion-safe adjustment glow.

Browser QA will confirm the authored view is restored after a full reload, the mini-map and action dock do not overlap, and the adjustment glow remains subtle over light and dark scene regions.
