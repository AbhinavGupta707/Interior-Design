# Plan-parser v1 promotion rules

An adapter is not promotable from unit tests, reference fixtures, generated screenshots or schema conformance alone. Promotion requires a separately versioned producer manifest and an observation bundle produced through the real isolated parser boundary against the frozen holdout catalog.

## Mandatory prerequisites

1. The adapter has an approved origin, licence, weights/data rights record and allowed service-processing purpose. Training use is separately decided and remains denied for this repository fixture catalog.
2. The exact adapter, model/tool/normalizer versions and manifest SHA-256 are recorded. No provider key, paid call, GPU or outbound network is needed for the required v1 gate.
3. Producer source cannot import, enumerate or branch on holdout fixture IDs, hashes or catalog paths. The holdout import guard passes unchanged.
4. Every declared in-box and hard-negative fixture has exactly one strict observation. Missing outputs, crashes, timeouts, malformed results and abstentions remain in their original denominators.
5. The producer/live evaluation and security opt-ins run without skips. Reference-harness passes never substitute for these runs.
6. Source SHA-256, asset, project, tenant, rights, status, page and normalized-input scope match exactly. Any cross-scope violation is an automatic rejection.

## Absolute gates

- accepted in-box coverage is at least 90%;
- hard-negative abstention is exactly 100%;
- severe error count is zero;
- cross-tenant/source/rights violation count is zero;
- wall endpoint P90 is at most 50 mm;
- opening-centre P90 is at most 75 mm;
- calibration residual P90 is at most 25 mm;
- parser wall time never exceeds 30 seconds per page; and
- confidence ECE is at most 0.15 only when at least 20 evaluable confidence samples exist. A smaller sample is `insufficient-sample`, not a pass.

A severe error is any wrong level, unhosted opening, invalid/self-intersecting room, hidden omitted region, source mismatch, hard-negative false acceptance or wall endpoint error over 250 mm presented as acceptable. Severe errors are counted individually and cannot be averaged away.

## Beating the deterministic reference

Passing the absolute gates is necessary but not sufficient. Against the same frozen source hashes, a candidate must:

- reach at least the reference 90% accepted coverage, 100% hard-negative abstention, zero severe errors and zero cross-scope violations;
- be no worse than the reference 35 mm wall P90, 42 mm opening P90, 14 mm calibration P90 and 0.12000000000000004 ECE; and
- strictly improve at least one of accepted coverage, wall P90, opening P90, calibration P90 or ECE without regressing another.

The most direct improvement is accepting the faint tenth in-box plan safely, producing greater than 90% coverage while retaining every other bound.

## Correction and processing claims

Automated review duration and action counts prove instrumentation only. They cannot pass the provisional human correction targets. Until a rights-approved human study has sufficient samples, correction time must remain `not-measured`; no 8-minute median or 15-minute P90 claim is permitted.

CPU, memory and wall-time observations must identify hardware, runtime and tool versions. They may enforce the hard 30-second local deadline but cannot be described as production throughput or scale evidence without a production-shaped run.

## Promotion decision record

The decision record must include:

- adapter/model/tool/normalizer manifest and SHA-256;
- exact holdout fixture hashes and observation bundle hash;
- all denominator counts, failures, abstentions and safe codes;
- severe-error detail;
- error distributions, confidence bands, ECE and risk/coverage;
- processing observations and hardware/runtime description;
- correction instrumentation with human timing explicitly `not-measured` unless a study exists;
- security and live E2E command results, including every named skip; and
- an accountable reviewer confirming rights, source isolation and the no-direct-mutation boundary.

Any missing prerequisite, `not-evaluable` required metric, live skip, severe error, rights ambiguity or scope violation rejects promotion.
