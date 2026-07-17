# ADR-003 — Canonical coordinate and unit system

- Status: Accepted for C4
- Date: 2026-07-17
- Contract: `c4-canonical-home-v1`

## Context

The canonical home model must survive persistence, replay, process changes and later renderer/export implementations without accumulating unit conversions or silently acquiring a global location. Plans, captures, reconstruction outputs, geospatial context and runtime scenes use different axes, units, tolerances and authority. A visually plausible transformation is not evidence that an interior dimension or global alignment is established.

## Decision

The C4 canonical model uses a right-handed project-local Cartesian system:

- `+X` is east, `+Y` is north and `+Z` is up;
- linear dimensions, offsets and local coordinates are signed integer millimetres;
- angles are integer milli-degrees;
- the origin convention is `project-local-model-origin`; and
- calculations must remain within both the frozen field bounds and JavaScript safe-integer bounds.

The canonical values are integers. Metres, floating-point transforms and radians are derived only at a named renderer or exchange boundary. A derived representation must retain the exact source snapshot hash and its transform/configuration; it cannot become canonical dimensional truth by looking convincing.

A global anchor is either `not-established` or an attributed `EPSG:27700` easting/northing in integer millimetres. An address, property identity point or contextual map location does not establish the exact interior and is never copied into the global anchor as geometry authority. Source drawing, capture and reconstruction coordinate systems remain immutable evidence with explicit transforms when later checkpoints introduce them.

Geometric point sequences retain authored order. C4 exact-state hashing does not rotate polygon starts, reverse winding or treat direction changes as equivalent. The geometry kernel reports topology/geometric findings separately.

## Exchange boundaries

Canonical JSON is the internal system of record. It is not IFC, glTF, GeoJSON, USD/USDZ, a mesh, point cloud, NeRF or Gaussian splat.

- glTF is a runtime delivery format with metre/radian and runtime-axis conventions. C10 must perform and record an explicit millimetre/unit/axis transform. A GLB is derived from an exact snapshot and is never the editable C4 source.
- GeoJSON is WGS 84 longitude/latitude in decimal degrees under RFC 7946. It is suitable for an explicit geospatial exchange boundary, not for storing project-local integer-millimetre interiors.
- IFC and USD/USDZ may be versioned professional or platform exchange artifacts. Round-tripping them does not silently replace the canonical snapshot or its provenance.

## Consequences

- Domain validation can use deterministic integer predicates and reject unsafe arithmetic rather than tolerate floating-point drift.
- Renderers and exporters own explicit, testable conversions; fallback wall thicknesses, ceiling heights and materials remain display configuration and are not written as facts.
- A global anchor stays unknown until attributable evidence establishes it.
- Exact hashes change when authored point direction or polygon start changes, even if a later geometry comparison considers the shapes equivalent.

## Limitations

C4 is a bounded 2.5D information kernel, not a survey, structural model, planning determination, construction setting-out record or as-built truth claim. Integer millimetres express storage precision, not measurement accuracy. C4 does not establish geodetic transformation accuracy, capture drift, hidden construction, deformation, tolerances or professional suitability. Those remain attributed evidence, limitations and purpose-specific review concerns.

## Native/WASM portability

TypeScript is the initial implementation. Public fixtures use explicit integers, coordinate metadata and canonical UTF-8 bytes so a future native or WASM kernel can be compared byte-for-byte. A replacement must pass the retained hashes, bounds, negative-zero/unsafe-number rejection and geometric-order cases before adoption. Native integer widths and overflow behaviour must be explicit; implementation-specific floating-point or locale behaviour cannot alter canonical state.
