# C4 canonical-model evaluation pack

## Purpose and boundary

This pack independently evaluates the frozen `c4-canonical-home-v1` schema, canonical ordering inputs, profile separation, and geometry finding contract. All homes, IDs, evidence references, dimensions, names, and amendments are deterministic synthetic data. They identify no customer, address, provider record, or real property.

The pack is a software contract, not survey, structural, regulatory, planning, professional, or as-built evidence. In particular, the valid home leaves every wall's structural role explicitly unresolved through `STRUCTURAL_STATUS_UNKNOWN`. The as-built profile exists only to test state separation and says `AS_BUILT_STATUS_UNCONFIRMED`; it does not claim installed condition.

## Valid profile goldens

The valid authored fixture has two levels, four rooms, floors and ceilings, fourteen walls, hosted doors and windows, a stair, fixed cabinet, loose furnishing, floor finish, light, and camera. Known values use synthetic source-derived claims and immutable evidence-reference IDs. Proposed and as-built furnishing amendments are user-attributed. Every element and claim ID is stable and opaque.

| Profile  | Derivation          | Canonical UTF-8 bytes | Independent SHA-256                                                |
| -------- | ------------------- | --------------------: | ------------------------------------------------------------------ |
| existing | absent, as required |                68,923 | `587ebdfa03235b2dbf0346e7558398636057e735a014fdb9ca08d696ad4dda6f` |
| proposed | existing hash       |                69,173 | `c13a92cbc6312dd08ab9dca4f2cd4dea82bdeedc9b5ab50171e7bb1ff69004b1` |
| as-built | proposed hash       |                69,173 | `dc339d56d8a20a7bb4d23a1cc04b760fd1d675c06bf41e3b2dfdb91df6d233cc` |

The reference oracle validates the snapshot first, recursively sorts JSON object keys, sorts entity collections and reference sets by stable ID, and sorts limitations by `code + detail`. Authored polygon and path point order remains unchanged. Hash input includes the canonical snapshot fields and excludes record timestamps, actors, database sequence, snapshot ID, and transport envelope. It is deliberately independent test code and must not be imported by production packages.

Determinism coverage:

- 24 insertion-order variants from fixed seed `0x0c4a11ce` must retain the existing golden hash;
- 64 generated rectangle cases from fixed seed `0x00c4f17e` use a BigInt shoelace oracle;
- JSON round trip must retain exact canonical bytes;
- an independent Node process round-trips the canonical JSON bytes and recomputes byte length and SHA-256; and
- a one-millimetre camera-position change must change the hash.

## Retained geometry matrix

Every entry below is schema-valid so geometry validation cannot avoid it by failing schema parsing. Locations are level-local integer millimetres. The source data records affected ID sets and each exact location; the readable aliases below refer to the stable IDs in `canonicalFixtureIds`.

| Fixture ID                              | Adversarial condition                                                                   | Required finding code — severity — location                                                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `c4-geo-001-missing-references`         | missing opening host, finish target, and fixed/furnishing/light/camera level references | `HOST_WALL_REFERENCE_MISSING` — error; `TARGET_REFERENCE_MISSING` — error; four `LEVEL_REFERENCE_MISSING` — error; no fabricated location          |
| `c4-geo-002-degenerate-polygons`        | collinear space and floor surface                                                       | `SPACE_POLYGON_DEGENERATE` — error — ground `(0,0)`; `SURFACE_POLYGON_DEGENERATE` — error — ground `(0,0)`                                         |
| `c4-geo-003-self-intersecting-polygons` | crossing space and floor-surface rings                                                  | `SPACE_POLYGON_SELF_INTERSECTION` — error — ground `(0,0)`; `SURFACE_POLYGON_SELF_INTERSECTION` — error — ground `(0,0)`                           |
| `c4-geo-004-zero-repeated-wall`         | zero-length and repeated wall segments                                                  | `WALL_PATH_ZERO_LENGTH_SEGMENT`, `WALL_PATH_REPEATED_VERTEX`, and `WALL_PATH_SELF_INTERSECTION` — error — ground `(0,0)`                           |
| `c4-geo-005-self-intersecting-wall`     | crossing multi-segment wall                                                             | `WALL_PATH_SELF_INTERSECTION` — error — ground `(0,0)`                                                                                             |
| `c4-geo-006-invalid-openings`           | out-of-host door, overlapping windows, sill plus height beyond host                     | `OPENING_OUTSIDE_HOST_EXTENT` — error — ground `(5000,0)`; `OPENING_OVERLAP` and `OPENING_ABOVE_HOST_HEIGHT` — error — ground `(0,0)`              |
| `c4-geo-007-room-boundaries`            | disconnected bounded-by graph and endpoint/boundary disagreement                        | `ROOM_BOUNDARY_DISCONNECTED` and `ROOM_BOUNDARY_NOT_CLOSED` — error — living `(0,0)`; `ROOM_BOUNDARY_INCONSISTENT` — error — kitchen `(5000,0)`    |
| `c4-geo-008-stair-missing-level`        | missing destination level                                                               | `LEVEL_REFERENCE_MISSING` — error; no fabricated location                                                                                          |
| `c4-geo-009-stair-identical-levels`     | identical source and destination                                                        | `STAIR_LEVELS_IDENTICAL` — error — ground `(4200,1000)`                                                                                            |
| `c4-geo-010-stair-relationship`         | rise exceeds run and total rise misses destination                                      | `STAIR_RUN_PATH_MISMATCH` and `STAIR_RISE_LEVEL_MISMATCH` — error — ground `(4200,1000)`                                                           |
| `c4-geo-011-stair-elevation`            | rise times count differs from level elevation delta                                     | `STAIR_RISE_LEVEL_MISMATCH` — error — ground `(4200,1000)`                                                                                         |
| `c4-geo-012-unknown-wall-dimensions`    | attributed unknown wall height and conflicting thickness                                | `WALL_HEIGHT_UNKNOWN` and `WALL_THICKNESS_UNKNOWN` — information — ground `(5000,0)`                                                               |
| `c4-geo-013-unsafe-arithmetic`          | 512-point repeated extreme ring overflows safe integer accumulation                     | `GEOMETRY_INTEGER_RANGE_EXCEEDED`, `SPACE_POLYGON_REPEATED_VERTEX`, and `SPACE_POLYGON_SELF_INTERSECTION` — error — ground `(-10000000,-10000000)` |

The twelve error-bearing fixtures are the severe-error denominator. The unknown-dimension fixture remains in the overall denominator but is not relabelled as severe. A crash, timeout, omitted result, wrong code, wrong severity, wrong affected-ID set, or wrong location is a miss; it is never removed from the denominator.

## Retained schema matrix

These inputs intentionally fail before geometry validation and remain in a separate schema denominator.

| Fixture ID                                    | Required rejection                      |
| --------------------------------------------- | --------------------------------------- |
| `c4-schema-001-duplicate-element-id`          | cross-collection duplicate element ID   |
| `c4-schema-002-coordinate-overflow`           | coordinate above `10,000,000 mm`        |
| `c4-schema-003-dimension-overflow`            | dimension above `1,000,000 mm`          |
| `c4-schema-004-non-finite`                    | non-finite number outside I-JSON        |
| `c4-schema-005-proposed-derivation-missing`   | proposed profile without source hash    |
| `c4-schema-006-existing-derivation-forbidden` | existing profile with a derivation hash |

## Scoring and execution

Report all counts, not only percentages:

- schema acceptance: valid profiles and all geometry fixtures accepted / 16;
- schema rejection: intended schema failures rejected / 6;
- exact geometry case pass rate: exact finding-set matches / 13;
- severe-case detection: severe fixtures with every required error / 12;
- finding precision and recall over exact `(code, severity, affected IDs, location)` tuples;
- uncaught exceptions, timeouts, and non-finite calculations / all attempted cases; and
- canonical golden matches by profile, ordering variant, process, and round trip.

The independent pack runs without a producer implementation:

```sh
pnpm --filter @interior-design/test-fixtures test:unit
pnpm exec vitest run --config tests/geometry/canonical/vitest.config.ts
```

The second command reports 19 producer tests as explicitly skipped while
`C4_RUN_PRODUCER_INTEGRATION` is absent: three domain-canonical golden checks, three valid-profile
geometry checks and thirteen retained adversarial checks. This is a visible unresolved integration
state, not passing producer evidence. After the domain and geometry producers are merged, run:

```sh
C4_RUN_PRODUCER_INTEGRATION=1 pnpm exec vitest run --config tests/geometry/canonical/vitest.config.ts
```

That opt-in suite calls `@interior-design/geometry-kernel` and requires exact code, severity, location, and affected-ID-set agreement for all thirteen cases. Producer messages remain free to be clearer, but cannot weaken or hide the structured result.

## Residual limitations

- The fixture is a small conventional 2.5D home and does not cover curved, sloped, georeferenced, mesh, or freeform geometry.
- Exact authored direction and polygon start remain hash-significant in C4; the pack does not claim geometric-equivalence hashing.
- The independent oracle covers the retained fixtures, not every possible geometry input, and is not production validation code.
- No database, API, tenant, browser, physical-device, GPU, provider, survey, or customer-data evidence is produced by this lane.
- Producer integration and any finding-code reconciliation remain an integration gate until the opt-in suite runs against the merged geometry kernel.
