# ADR-006 — Provenance, uncertainty and purpose-specific review

- Status: Accepted for C4
- Date: 2026-07-17
- Contract: `c4-canonical-home-v1`

## Context

Precision, confidence and visual polish do not establish truth. Every knowledge-bearing C4 value needs an attributable claim or must remain explicitly unknown. Evidence, inference, user assertion and professional review are different concepts and must not collapse into a generic `verified` flag. Existing, proposed and as-built states must also remain independently addressable.

## Decision

Every attributed value is exactly one of:

- `knowledge: known`, with a value and a known attribution; or
- `knowledge: unknown`, with an explicit reason and no fabricated value.

Known attribution states are `observed`, `source-derived`, `fused`, `inferred` and `user-asserted`. Their invariants are:

- observed, source-derived, fused and inferred claims require at least one immutable evidence reference;
- fused and inferred claims, and only those claims, require confidence in integer basis points from 0 through 10,000;
- user assertions require an attributable user actor;
- all claims identify a bounded method name, kind and version; and
- evidence references form a unique set whose canonical order is raw UTF-16 stable-ID order.

Unknown is a separate attribution state with one of the frozen reasons. Unknown may retain evidence references, for example when evidence conflicts, but it cannot carry a plausible default value or a reviewed status.

Review is either `not-reviewed` or `reviewed-with-limitations`. A review names exactly one purpose (`concept`, `planning`, `technical`, `construction` or `as-built-record`), reviewer, timestamp and at least one limitation. Public helpers ask whether an attribution is reviewed _for a requested purpose_. There is no purpose-free `verified`, `approved` or truth boolean.

A claim ID identifies immutable claim content. Repeating the same claim is idempotent. Changing state, method, evidence, confidence, actor or review under the same claim ID is rejected; a meaningful transition requires a fresh claim ID. Selection is explicit by claim ID. The implementation does not automatically select the largest confidence value or fall back to another claim when the requested one is absent or ambiguous.

Existing, proposed and as-built snapshots are separate model profiles. Existing snapshots do not carry `derivedFromSnapshotSha256`; proposed and as-built snapshots require it. Profile selection is exact and never falls back across states.

## Canonical provenance and integrity

Canonicalisation follows RFC-8785-style JSON Canonicalization Scheme principles over a strict I-JSON subset:

- object member names sort recursively by raw UTF-16 code units without locale comparison or Unicode normalization;
- entity collections sort by stable element ID;
- evidence and topology reference sets sort by stable ID;
- known limitations sort by code/detail and review limitations by their string key;
- all other arrays preserve authored order, including polygon and polyline point sequences;
- duplicate decoded JSON keys, lone surrogates, unsupported JavaScript values/objects, non-finite numbers, unsafe integers and negative zero are rejected; and
- serialization is exact UTF-8 using ECMAScript JSON primitive formatting.

SHA-256 covers only the validated frozen snapshot canonical bytes. Schema version, project/model/property IDs when present, profile, coordinate contract, attributed values, evidence references, limitations and elements are included. Snapshot record ID, actor/time, database version and transport/persistence envelope metadata are excluded. The exact byte length and digest are recomputable after ordinary JSON/JSONB and fresh-process round trips.

## Consequences

- Unknown data remains visible and usable without becoming a renderer default masquerading as fact.
- Confidence is one bounded inference/fusion attribute, not a substitute for source quality, tolerance or accountable review.
- Review can be reused only for its declared purpose and limitations.
- Changes to evidence order or object insertion order do not change a hash, while value, provenance, limitation and geometric sequence changes do.
- Source evidence remains immutable; a new interpretation creates a new claim/snapshot rather than rewriting history.

## Limitations

C4 records attribution mechanics; it does not prove evidence accuracy, reviewer competence, licence scope, sensor calibration, professional appointment or suitability beyond the declared review. Confidence basis points are not calibrated probabilities unless a later evaluation establishes that claim. A reviewed concept model is not thereby suitable for planning, technical design, construction or an as-built record. C4 does not infer hidden interiors, structural conditions, regulatory outcomes, cost, availability or surveyed/as-built truth.

## Native/WASM portability

TypeScript and the platform SHA-256 implementation are the first kernel. The public boundary consists of strict JSON-compatible data, exact UTF-8 canonical bytes, byte length, digest and retained golden fixtures. A future native/WASM implementation must reproduce sorting by UTF-16 code units, ECMAScript number/string output, domain-only array normalization, rejection behaviour and hashes exactly. Porting may replace algorithms only after licence, correctness and performance evidence; it cannot introduce Unicode normalization, locale sorting, alternate profile fallback or a second canonical representation.
