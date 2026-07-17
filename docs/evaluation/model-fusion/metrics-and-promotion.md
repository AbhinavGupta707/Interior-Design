# C9 fusion metrics and promotion rule

## Metric units

All persisted fixture truth and observations use safe integers. No floating-point value enters fixture identity or hashing.

| Metric                    | Definition                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| Translation error         | Euclidean difference between estimated and exact translation, integer millimetres        |
| Rotation error            | Euclidean norm of shortest-axis Euler differences, integer microdegrees                  |
| Scale error               | absolute difference from exact scale, integer parts per million                          |
| Dimension error           | absolute room width/length/height difference, integer millimetres                        |
| Missing dimensions        | three missing values for each truth room absent from the candidate                       |
| Topology error            | symmetric-difference count between exact and candidate edge sets                         |
| Coverage                  | supported truth regions covered / all supported truth regions, millionths                |
| Calibration ECE           | ten fixed confidence bands, absolute confidence/accuracy difference, weighted millionths |
| Latency                   | observed deterministic adapter wall duration, integer milliseconds                       |
| Peak memory               | observed deterministic adapter resource value, integer bytes                             |
| Automated correction time | monotonic completion minus start, integer milliseconds; instrumentation only             |
| Human correction time     | `NOT_MEASURED`; no proxy or synthetic substitution is permitted                          |

Distributions report count, median, P90, P95 and maximum. Translation, rotation, scale, dimension, topology, coverage and calibration are declared; latency and peak memory are observations, not production capacity claims.

## Quality penalty

The comparison score is an integer millionths penalty: lower is better. It is the rounded mean of seven declared components:

1. translation P90 / 250 mm;
2. rotation P90 / 5,000,000 microdegrees (5 degrees);
3. scale P90 / 25,000 ppm;
4. dimension P90 / 250 mm;
5. topology symmetric difference / exact topology-edge count;
6. 1,000,000 minus coverage millionths; and
7. missing dimension count / 12 exact dimension values.

Each numeric error component is capped at 4,000,000. A missing error distribution receives the cap; missing values are not treated as zero. This score is an evaluation index for the declared synthetic property box, not a physical-error unit or population estimate.

## Severe errors

Fusion must have zero severe errors. The evaluator independently detects:

- missing source transform;
- translation above 1,000 mm, rotation above 10 degrees or scale error above 100,000 ppm;
- room dimension error above 500 mm;
- unsupported room, topology or region geometry;
- geometry fabricated in a required-unknown/occluded region;
- a required unknown or discrepancy hidden from review;
- wrong level count; and
- a disconnected component hidden or component count changed.

Severe errors are attached to the exact fixture and never averaged. Baseline severe errors remain visible in each comparison. The acceptance gate counts fused severe errors and requires exactly zero.

## Case rule

For every meaningful-improvement fixture:

1. evaluate every eligible single-source candidate, retaining failures and abstentions;
2. choose the successful single-source candidate with the lowest declared quality penalty (stable source-ID tie break);
3. require fused quality-penalty reduction of at least 150,000 millionths (15%);
4. require translation, rotation, scale, dimension, topology, coverage and missing dimensions not to regress against that best source; and
5. require zero fused severe errors.

If there is no successful eligible baseline, a proposal cannot claim improvement. The safe result is an expected, allowed abstention.

For every honest-abstention fixture, the fused status must be `abstained`, the safe code must be in the fixture allowlist and no geometry metrics may be emitted. A failed job, unexpected proposal or unapproved abstention code does not pass.

The dataset gate requires all expected cases to pass. Missing observations remain failed cases. Aggregate fused calibration ECE must be at most 150,000 millionths with the declared sample count. These gates cannot be waived by a good average.

## Promotion boundary

The reference report always sets:

```text
promotion.eligible = false
representativeAccuracyClaim = false
humanCorrectionTime = NOT_MEASURED
```

Reasons are fixed: the adapter is independent synthetic reference evidence, human correction time is unmeasured and representative-home accuracy is not established. Producer-live promotion additionally requires merged producers, exact manifests, disposable PostGIS/API/worker evidence, integrated browser evidence and the unavailable hardware/runtime gates to remain truthfully named.
