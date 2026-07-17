# ADR-004: TypeScript-first bounded integer geometry kernel

- Status: Accepted for C4
- Date: 2026-07-17
- Checkpoint contract: `c4-canonical-home-v1`

## Context

C4 needs one side-effect-free validator for a schema-valid `CanonicalHomeSnapshot`. Canonical local coordinates and dimensions are integer millimetres, but valid collection and point limits are large enough that unchecked products, accumulated polygon area, or exhaustive pairwise topology work can exceed JavaScript safe-integer or practical resource bounds. The validator must expose those limits; it must not fabricate a dimension, use a floating epsilon as fact, repair authored geometry, or turn a visually plausible result into dimensional truth.

The package boundary is consumed by TypeScript API, domain, and fixture processes today. The C4 contract also reserves a future native or WebAssembly implementation if correctness, licensing, portability, and measured performance justify it.

## Decision

### TypeScript-first public boundary

The initial kernel remains strict TypeScript and preserves:

```ts
validateCanonicalGeometry(snapshot: CanonicalHomeSnapshot): readonly GeometryFinding[]
```

The implementation is deterministic, synchronous, side-effect-free, and provider-free. It does not perform I/O, mutate or repair the snapshot, use wall/ceiling display defaults, or depend on native installation state. Findings and their ID collections are frozen at runtime and sorted by a stable package-owned key.

Checked primitives are exported from the same package for orientation, segment intersection, signed doubled area, checked arithmetic, and polyline length bounds. A primitive returns a discriminated failure when its inputs or result cannot be represented safely; it never returns a rounded overflow.

### Coordinate predicates and arithmetic

- Inputs must be JavaScript safe integers. Canonical schema bounds are narrower, but the exported primitives still fail closed for wider direct callers.
- Addition, subtraction, multiplication, orientation determinants, and shoelace products use `bigint` as an exact sentinel calculation. A numeric result is returned only if every required represented value is within `Number.MAX_SAFE_INTEGER`.
- 2D orientation and intersection use exact determinant signs. Collinear contact and overlap use inclusive integer bounds. There is no epsilon.
- Polygon area is returned as signed doubled square millimetres. Keeping doubled area avoids a half-unit floating representation.
- Each Euclidean path segment is represented by exact integer floor and ceiling square-root bounds. Bounds are accumulated with checked arithmetic. A containment or stair-run result is asserted only when the bounds prove it; an ambiguous integer comparison produces an explicit warning.
- Surface polygons use an exact non-collinear plane basis selected from lexicographically ordered points, exact scalar planarity residuals, and a deterministic dominant-axis 2D projection. Unsafe representable residuals produce a range finding.

These predicates validate authored canonical geometry; they do not redefine it. Point sequences retain authored order. Reversal can change signed area direction, but not the existence or deterministic location of a topology defect.

### Tolerance policy

C4 uses zero floating tolerance for canonical coincidence, collinearity, intersection, planarity, overlap, and level-elevation relationships. Millimetre coordinates that differ are not silently snapped together.

Irrational Euclidean lengths are not rounded into canonical truth. The kernel carries integer lower/upper bounds and reports an indeterminate comparison when those bounds cannot prove equality or containment. A later operation or review workflow may propose a tolerance or repair, but it must be an explicit typed and attributable action outside this validator.

### Validation coverage

The validator reports deterministically located findings, where a level-local point is available, for:

- invalid or duplicate element IDs and missing/wrong-type level, host, room-boundary, and finish-target references;
- unknown, degenerate, repeated, zero-length, self-intersecting, non-planar, or range-unsafe polygons and paths;
- openings outside or ambiguously at host extents, negative sills, excessive tops, and overlapping host intervals;
- empty, missing, wrong-level, disconnected, or non-closed room boundary references;
- identical/missing stair levels, unknown or zero counts, rise/elevation mismatch, run/path mismatch, and indeterminate irrational run comparisons;
- unknown geometry and dimensions without substituted defaults; and
- fixed-object, furnishing, surface, wall, light, camera-position, and camera-target inconsistencies with known level extents.

Reference and entity collections are copied and sorted before analysis. Geometric point sequences are read in authored order. Opening overlap uses a sorted sweep rather than emitting an unbounded all-pairs result. A finding contains stable affected IDs, a fixed code and message, severity, and an optional integer level-local location.

### Complexity and resource bounds

Schema collection limits bound the linear scans. ID/reference indexes are `O(E)` with deterministic `O(E log E)` copied ordering. Polygon and polyline self-intersection is `O(V²)` in the current TypeScript implementation. Opening overlap is `O(O log O)`, and room connectivity is linear in referenced boundary edges after sorting.

The validator permits at most 300,000 non-adjacent segment-pair comparisons per snapshot, consumed in stable element-ID order. If a schema-valid snapshot needs more work, each unvalidated path receives `GEOMETRY_RESOURCE_LIMIT_EXCEEDED`; the validator continues its bounded linear/reference checks. It never silently treats an unexamined shape as valid. The C4 point limit is 512 per path, so one maximum-size polygon can be checked completely while adversarial collections remain bounded.

Arithmetic outside the safe numeric result range produces `GEOMETRY_INTEGER_RANGE_EXCEEDED` on the affected element and skips only the conclusion that depends on that unsafe result. Exact unknown attributed values produce information or warning findings and never a fabricated error-free dimension.

## Native or WebAssembly replacement gate

A native or WebAssembly kernel may replace algorithms behind the frozen TypeScript boundary only when all of the following are recorded:

1. dependency, source, and transitive licence review permits the intended distribution;
2. deterministic golden, property, adversarial, reversal/reordering, non-mutation, and severe-error fixtures return compatible finding codes, severities, affected IDs, and integer locations across supported processes;
3. safe-integer, resource-exhaustion, malformed-installation, and no-native-runtime behavior fails closed with the TypeScript implementation retained as an honest fallback;
4. reproducible benchmarks on representative and maximum bounded snapshots show a material benefit after load/bridge overhead, with no correctness or memory regression; and
5. builds are reproducible for every supported API/test platform and do not introduce broad credentials, provider state, or nondeterministic threading into validation.

Native availability alone is not sufficient to activate a replacement.

## Consequences

- C4 has a portable validator with no provider, GPU, native module, or property data requirement.
- Exact integer predicates avoid architecture-dependent floating tolerances and make range/resource incompleteness visible.
- Some valid but complex snapshots can receive an explicit resource finding instead of a complete quadratic topology result.
- Irrational path comparisons may remain indeterminate until geometry is corrected or reviewed; the kernel does not hide that uncertainty.
- The model remains a bounded 2.5D canonical representation and geometry proposal/validation layer. Passing this validator is not survey, structural, regulatory, planning, professional, or as-built certification.
