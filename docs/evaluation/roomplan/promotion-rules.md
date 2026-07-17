# C7 RoomPlan deterministic promotion rules

## Denominators

The evaluator freezes the fixture list before observations are loaded. Every declared attempt stays in exactly one denominator:

- **in-box:** supported-device, rights-cleared attempts expected to produce a proposal;
- **hard-negative:** incompatible, unsafe, out-of-rights or out-of-budget attempts expected to abstain;
- **physical structure:** in-box physical attempts containing at least two connected rooms captured in one compatible world space.

Missing observations, safe failures, crashes, timeouts, cancellations after worker lease and abstentions on in-box inputs reduce accepted coverage. A hard-negative failure is not counted as a correct abstention unless it returns the frozen bounded code. Repeated retries remain attempts when they correspond to distinct field sessions; an idempotent replay of one command is one observation.

## Provisional C7 thresholds

These thresholds are frozen for C7 evaluation before physical data is acquired. They are acceptance thresholds, not claims about Apple RoomPlan or production capacity.

| Gate                                     |         Threshold | Severe/failure rule                                                                              |
| ---------------------------------------- | ----------------: | ------------------------------------------------------------------------------------------------ |
| accepted in-box coverage                 |      at least 90% | denominator includes missing, failed and abstained in-box attempts                               |
| hard-negative safe abstention            |      exactly 100% | any proposal is a severe false acceptance                                                        |
| source and proposal/package hash linkage |      exactly 100% | any mismatch is severe                                                                           |
| canonical mutations from C7 conversion   |         exactly 0 | any mutation is severe                                                                           |
| severe errors                            |         exactly 0 | includes cross-scope output, hash mismatch, false acceptance and wall endpoint error over 250 mm |
| wall endpoint absolute error P90         |    at most 100 mm | physical, reference-measured proposals only                                                      |
| opening centre absolute error P90        |    at most 100 mm | physical, reference-measured proposals only                                                      |
| connected-room alignment residual P90    |    at most 150 mm | compatible physical structure attempts only                                                      |
| confidence expected calibration error    |      at most 0.15 | not evaluable below 50 physical confidence samples                                               |
| observed worker wall time                | at most 60,000 ms | fixture-scale ceiling, not a scale claim                                                         |
| observed worker peak resident memory     | at most 1,024 MiB | fixture-scale ceiling; operating-system kill counts as failure                                   |
| physical in-box minimum                  |       12 attempts | zero is `not-evaluable`, partial shortfall is failed                                             |
| physical hard-negative minimum           |        4 attempts | must include incompatible world space and rights withdrawal                                      |
| physical structure minimum               |        4 attempts | each contains at least two connected rooms                                                       |

Nearest-rank P90 is used after sorting non-negative absolute errors. No clipping, winsorising, average substitution or exclusion of large errors is allowed. Spatial metrics are calculated only from a documented independent reference measurement or reference model. Synthetic coordinates never enter physical accuracy distributions.

## Severe error taxonomy

- `SOURCE_HASH_MISMATCH`: observation source differs from the frozen fixture source.
- `PROPOSAL_PACKAGE_HASH_MISMATCH`: proposal does not link to the exact package manifest.
- `CANONICAL_MUTATION`: conversion directly calls or effects canonical mutation.
- `HARD_NEGATIVE_FALSE_ACCEPTANCE`: a hard negative receives a proposal.
- `SEVERE_WALL_ENDPOINT_ERROR`: any measured endpoint error exceeds 250 mm.
- `MISSING_OBSERVATION`: a declared fixture has no result.
- any producer-reported severe code, including cross-tenant/source output, invalid topology hidden as success or incompatible world-space merge.

Severe errors are listed individually and cannot be averaged away by aggregate accuracy.

## Promotion decision

Promotion requires all of the following:

1. adapter evidence kind is `producer-live`, with an immutable adapter version and manifest SHA-256;
2. every deterministic gate is `passed`;
3. physical sample minimums are satisfied with per-capture rights records;
4. permission denial, one-room, connected-room structure, interruption/relocalisation or safe restart, low-light/low-texture guidance, offline resume and hash linkage field evidence is complete;
5. no unresolved high/critical security finding or C7/C18 physical-device blocker remains.

Synthetic results alone always remain promotion-ineligible.
