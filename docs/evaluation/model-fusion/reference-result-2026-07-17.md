# C9 independent synthetic reference result — 17 July 2026

## Result

The deterministic independent reference pack passes its synthetic acceptance rule. This is not C9 producer/live or representative-home evidence.

| Gate                         | Actual                  | Target             | Status |
| ---------------------------- | ----------------------- | ------------------ | ------ |
| Expected case acceptance     | 7 / 7                   | 7 / 7              | passed |
| Meaningful-improvement cases | 4 / 4                   | improve or abstain | passed |
| Honest-abstention cases      | 3 / 3                   | allowed safe code  | passed |
| Fused severe errors          | 0                       | 0                  | passed |
| Aggregate calibration ECE    | 112,916 millionths (24) | at most 150,000    | passed |
| Missing fixture observations | 0                       | 0                  | passed |
| Unknown fixture observations | 0                       | 0                  | passed |

The four proposed cases each reduce the declared quality penalty by 966,936 millionths (96.6936%) against the best eligible single source and do not regress a declared primary metric. This intentionally clean synthetic result validates evaluator behavior; it is not an expected real-property accuracy rate.

## Failure-inclusive denominators

| Candidate class | Total | Full | Partial | Abstained | Failed |
| --------------- | ----: | ---: | ------: | --------: | -----: |
| Fusion          |     7 |    2 |       2 |         3 |      0 |
| Eligible source |    22 |    0 |      20 |         1 |      1 |

The one source abstention and one source failure remain in the 22 eligible-baseline denominator. Assertion-only candidates are ineligible as dimensional baselines and remain visible as the dedicated honest-abstention fixture.

## Proposed-case metric observations

| Metric                    |    Fused P90 / value |
| ------------------------- | -------------------: |
| Translation error         |                 7 mm |
| Rotation error            |  23,000 microdegrees |
| Scale error               |               20 ppm |
| Dimension error           |                10 mm |
| Topology errors           |                    0 |
| Supported-region coverage | 1,000,000 millionths |
| Quality penalty           |    10,486 millionths |

Across all seven fused attempts, deterministic reference latency has P90 2,461 ms and peak-memory observation P90 25,992,192 bytes. These values describe the fixture adapter only; they do not establish producer latency, memory, concurrency or property-scale capacity.

Automated review instrumentation contains four samples, 18 actions and P90 40 ms. Human correction time is **NOT MEASURED**, with zero human-study samples.

## Focused evidence

- test-fixture package: 7 files / 50 tests passed, including four C9 fixture tests;
- independent fusion evaluation: 2 files / 6 tests passed;
- independent fusion security: 5 files / 28 tests passed; and
- synthetic Playwright: 9 / 9 desktop, mobile and keyboard journeys passed with zero unexpected console/page/HTTP/request/external-network failures and no horizontal overflow.

The report adapter manifest is `d632747fcebafef7480d1292bb8d22bf5328b02dce017e24432d6a53f6dc6622` (`c9-independent-synthetic-reference-adapter` 1.0.0).

## Explicit non-evidence

- C9 producer, platform API, spatial worker, database and real BFF integration: **NOT RUN**;
- physical iPhone/iPad, LiDAR and RoomPlan accuracy: **NOT RUN**;
- COLMAP/Open3D, neural/GPU/CUDA and provider execution: **NOT RUN**;
- representative-property accuracy and field calibration: **NOT RUN**;
- human correction study: **NOT MEASURED**; and
- canonical mutation/operation-draft behavior in the merged producer: **NOT RUN** (the independent boundary and mock assert the required zero-mutation contract only).
