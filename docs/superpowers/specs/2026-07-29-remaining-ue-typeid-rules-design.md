# Remaining UE TypeId Rendering Rules Design

## Goal

Port the remaining source-visible UE special model rules into the OCCT 3D renderer in one batch while preserving the existing unified content pipeline and the already verified behavior for `1313`, `1407`, `1408`, `140c`, and `140d02`.

This work applies only to the OCCT repository. It must not modify, deploy, stage, or commit `cad_plugin`.

## Authoritative Sources

The implementation must follow the source-visible behavior in:

- `TemplateManager.cpp` for CAD TypeId mapping, composite expansion, template selection inputs, size correction, mirror metadata, and ground distance.
- `ParameterDataManager.cpp` for parameterized window and railing values.
- `BIMScene.cpp` for scale, rotation, artificial bounding boxes, and anchor placement.
- `BIMPlanData.cpp` for railing and door-window height calculation.
- `public/data/template.json` for template resource identity and parameter defaults.

Binary UE data tables are outside scope. A rule that exists only in an unavailable binary table must not be guessed.

## Scope

### Remaining special families

| Family | CAD or generated TypeIds | Required behavior |
| --- | --- | --- |
| Standard windows | `1402`, `140a` | Reuse standard-window parameter and placement semantics where a template resource is available. |
| Bay windows | `1403`, `140302`, `140303`, `1404` | Align the UE artificial box spanning local `(-X/2, Y)` to `(X/2, 0)`; for `140302`, vertical flip selects left-side glass instead of the default right-side glass. |
| Arc bay window | `1405` | Preserve the model's semicircular local Y shape, apply the UE Y sign, and offset the CAD footprint center to the model center. |
| Corner bay window | `1406` | Resolve left/right width and wall thickness parameters and align the UE L-shaped artificial box. |
| Railings | parent `140e`, generated `140e01`, `140e02` | Expand the parent path into straight and arc children. Straight children use `140e01` semantics and the `140e` template resource; arc children use `140e02`, arc parameters, and chord-center placement. |
| Door-window | `140f` | Resolve the door/window type, door height, window height, sub-window height, outer length, total length, and derived total height without double-scaling. |
| Special doors | `1305`, `1311` | Preserve existing template mapping and port UE barn-door and pocket-door scale/offset rules. |

### Already implemented rules

`1313`, `1407`, `1408`, `140c`, and `140d02` remain behaviorally unchanged. They may be registered through the same dispatch boundary only when tests prove the refactor is neutral.

### Ordinary content

All other `*_list` records continue through the current unified pipeline:

1. discover every record with a `TypeId`;
2. map CAD TypeId to a template TypeId;
3. select a resource;
4. classify it as static or parameterized from goods detail;
5. load or convert the model;
6. apply generic placement unless an audited special rule exists.

No per-TypeId rule is added merely because an object appears in a particular source list.

## Architecture

### Type rule registry

Add one focused registry that maps an exact normalized TypeId to declarative family facts and small strategy functions. The registry is the single dispatch boundary for:

- template TypeId aliases;
- parameter adapter selection;
- composite expansion selection;
- placement plan selection;
- debug family labels.

Geometry calculations remain in small modules rather than being embedded as large functions in the registry. Existing public resolver and placement APIs remain stable.

### Composite expansion

Generalize the existing free-window expansion boundary so it can also expand `140e` paths atomically:

- straight CAD segments become `140e01` children;
- arc CAD segments become `140e02` children;
- source identity, path order, transforms, and parent fallback identity are retained;
- either all children are committed or the parent fallback remains visible.

The `140d02` window expansion keeps its existing `1401` and `140c` output and behavior.

### Parameter resolution

Parameter adapters add only audited UE values before the existing schema filtering step. Missing optional values are omitted. Missing required geometry makes the special adapter decline the instance so the visible fallback remains.

The following special values must be covered:

- `140302`: default right-side glass; vertical flip selects left-side glass.
- `1406`: left/right width, left/right wall thickness, height, and ground height.
- `140e02`: chord length, sagitta, segment count, radius plus 25 mm, major/minor arc label, and height.
- `140f`: source parameters and derived total height according to the UE type flags.

Template numeric defaults remain lower priority than explicit CAD values. Non-numeric material/model defaults continue through the existing template/resource mechanism.

### Placement

The placement layer computes a plan before cloning the prototype. Each special family supplies only the facts that differ from generic placement:

- artificial local bottom-center;
- axis or rotation compensation;
- scale overrides;
- model-origin versus bounds-center anchoring;
- local center offset.

All transforms retain the established order: axis conversion, model offset, size scaling, local plan flips, plan rotation, and world translation.

Special placement rules are rejected when required values are non-finite or geometry is incomplete. Rejection must not produce a partially placed model.

## Error Handling

- A missing template keeps the matching CAD fallback visible and reports `TEMPLATE_TYPE_NOT_FOUND`.
- A missing resource keeps the fallback visible and reports `TEMPLATE_RESOURCE_MISSING`.
- Invalid composite geometry emits no partial children.
- Invalid special placement returns the existing placement failure shape without leaking signed resource URLs.
- Failure of one instance does not stop other instances or other composite parents.

## Debug Fixtures

Extend the opt-in fixture mechanism without mutating Drawing2:

- keep exact single fixtures such as `?fixture=1408`;
- add fixtures for each remaining geometric family;
- add a combined `?fixture=ue-specials` view for concentrated visual review;
- use asymmetric dimensions and explicit flip variants so incorrect handedness is visible;
- place wall-bound fixtures against known Drawing2 wall segments rather than arbitrary empty space.

Every real loaded model remains clickable under `#debug` and reports its source identity, CAD TypeId, mapped template TypeId, resource identity, parameters, and sanitized placement facts.

## Testing

Implementation follows test-driven development by family:

1. registry and template-alias tests;
2. parameter adapter tests, including missing-field cases and flip variants;
3. composite expansion and atomic commit tests for `140e`;
4. placement matrix and world-bounds tests for each geometric family;
5. fixture immutability and exact-query tests;
6. existing Drawing2 content coverage tests;
7. full `npm test` and `npm run build:3d`;
8. real backend loading and browser visual review of the combined fixture.

## Acceptance Criteria

- Every source-visible UE special branch listed in Scope has an explicit tested OCCT counterpart or a documented no-op because the generic path already matches UE.
- All successfully loaded models are upright and use their CAD footprint, ground height, rotation, and plan flips.
- Bay windows, corner bay windows, railings, and door-windows use the correct artificial anchor rather than raw imported bounds when UE does so.
- Composite railings never leave partial children in the scene.
- Existing verified types retain their behavior.
- Full tests and the production 3D build pass.
- The combined browser fixture has no content-loader failure for resources available from the current backend.
- No `cad_plugin` file is changed or committed.

## Non-goals

- Recreating unavailable UE binary data tables.
- Adding special rules for ordinary soft furniture that already uses generic placement correctly.
- Migrating or deploying files into `cad_plugin`.
- Replacing the Node development transport or the existing CAD native bridge.
