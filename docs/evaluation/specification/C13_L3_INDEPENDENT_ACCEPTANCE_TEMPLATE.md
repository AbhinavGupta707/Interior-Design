# C13-L3 independent acceptance record

Use one copy of this record per tested commit. Attach artifacts by content hash or durable CI URL; do not paste access tokens, private rights receipts, catalog payloads, notes, or customer data.

## Evidence identity

- Commit SHA: `<sha>`
- Frozen activation: `ab9498dc45c45de8f6a155227ab01a6fb0203a6b`
- Reviewer and date: `<name> · <ISO-8601>`
- Evidence class: `deterministic creator-authored synthetic fixtures`
- Browsers: `<Chromium version> · <Firefox version> · <WebKit version>`
- API target: `<deterministic mock | production-composed local stack>`
- Artifact locations and SHA-256: `<links and hashes>`

The lane-owned mock proves contract consumption, BFF rejection boundaries, interaction recovery, accessibility semantics, and responsive behavior. It is not evidence for the orchestrator-owned production-composed browser gate, real database isolation, C12/C5/C10 execution, provider output, GPU output, or physical-device behavior.

## Required commands

Record the exit code and durable output for each command.

```text
pnpm --filter @interior-design/web lint
pnpm --filter @interior-design/web typecheck
pnpm --filter @interior-design/web exec vitest run test/materials-products
pnpm exec vitest run tests/evaluation/specification tests/performance/specification
pnpm exec tsc -p tests/e2e/specification/tsconfig.json --noEmit
pnpm exec tsc -p tests/evaluation/specification/tsconfig.json --noEmit
pnpm exec tsc -p tests/performance/specification/tsconfig.json --noEmit
pnpm exec playwright test --config tests/e2e/specification/playwright.config.ts
pnpm --filter @interior-design/web build
git diff --check
```

## Browser acceptance matrix

For each row record `pass`, `fail`, or `not run`; never promote `not run` to inferred evidence.

| Case                                                                                                 | Chromium desktop    | Firefox desktop     | WebKit desktop      | Chromium 390×844    | Firefox 390×844     | WebKit 390×844      |
| ---------------------------------------------------------------------------------------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| Owner keyboard workflow, immutable board update, bounded preview, confirmation, exact scene job link | `<status>`          | `n/a by lane split` | `n/a by lane split` | `n/a by lane split` | `n/a by lane split` | `n/a by lane split` |
| Catalog pagination, source/rights/model/scale/commercial labels, four schedule captions              | `n/a by lane split` | `<status>`          | `<status>`          | `n/a by lane split` | `n/a by lane split` | `n/a by lane split` |
| Viewer inspect-only and editor mutation controls                                                     | `<status>`          | `<status>`          | `<status>`          | `n/a by lane split` | `n/a by lane split` | `n/a by lane split` |
| Foreign tenant non-disclosure                                                                        | `<status>`          | `n/a by lane split` | `n/a by lane split` | `n/a by lane split` | `n/a by lane split` | `n/a by lane split` |
| Stale rights, malformed upstream, service error, and session expiry recovery                         | `<status>`          | `<status>`          | `<status>`          | `n/a by lane split` | `n/a by lane split` | `n/a by lane split` |
| Offline transition and interrupted preview without mutation                                          | `<status>`          | `<status>`          | `<status>`          | `n/a by lane split` | `n/a by lane split` | `n/a by lane split` |
| Document-width containment and local table overflow                                                  | `n/a by lane split` | `n/a by lane split` | `n/a by lane split` | `<status>`          | `<status>`          | `<status>`          |

## Semantic and security assertions

- [ ] Optional `confirmationId` was UUID-validated in the client, verified by the API, and never treated as authority.
- [ ] Tenant, actor, and role authority came only from the HTTP-only session and server response.
- [ ] Viewer mutation controls were disabled and the server rejected viewer mutations.
- [ ] Foreign-tenant responses disclosed no specification identifiers or content.
- [ ] Frozen C13 schemas rejected incomplete, malformed, over-broad, or mismatched upstream payloads closed.
- [ ] Artifact access exposed only the strict signed-access fields; raw object keys, derivation metadata, embedded credentials, URL fragments, and non-loopback HTTP were rejected.
- [ ] Mutation requests carried bounded bodies, exact expected revisions, and idempotency keys.
- [ ] Pre-confirmation copy said `bounded catalog preview` and disclaimed canonical C5/C10 truth.
- [ ] The exact `/viewer/:projectId?jobId=:sceneJobId` link appeared only after confirmation.
- [ ] Existing and as-built mutation counters remained zero.
- [ ] Session storage contained only opaque specification, line, and candidate identifiers; local storage contained no feature payload.
- [ ] Notes, schedules, rights records, preview payloads, descriptions, and commercial data were absent from browser persistence.
- [ ] Creator-owned generic, locally licensed, rights withdrawn/review-required, bounded proxy, validated local model, and incomplete representation boundaries were visible.
- [ ] Price, supplier, stock/availability, and delivery were explicitly `not provided`.
- [ ] No draggable elements were present; keyboard actions, focus recovery, polite status, captions, headers, and table semantics were verified.
- [ ] Offline, interruption, stale, retry, service error, and session-expiry states preserved inspectable state and made no hidden mutation.

## Performance record

- Schedule projection fixture size and repetitions: `<values>`
- Median / p95 / maximum duration: `<values and units>`
- Browser navigation-to-ready duration: `<value and browser>`
- Owner workflow duration: `<value and browser>`
- Threshold result and environment caveat: `<result>`

Performance checks use synthetic in-process fixtures and are regression alarms, not production capacity evidence.

## Integration seams for the orchestrator

1. Central composition and navigation are outside C13-L3 ownership. Verify the composed C12 link supplies `confirmationId`, the API verifies it against the authoritative confirmation, and the confirmed C13 link opens the exact C10 `sceneJobId`.
2. The frozen `updateSelectionBoardRequestSchema` carries decision state and note only. The workspace displays exact immutable room assignments and preserves review-required ambiguity; adding room-assignment editing requires a later shared-contract revision.
3. The frozen `catalogAssetVersionSchema` requires model, thumbnail, licence/source artifacts, and a declared scale. The BFF rejects incomplete asset payloads closed and the UI explains the inspect-only missing-representation boundary; representing incomplete assets as valid records requires a later shared-contract revision.
4. Run the production-composed browser gate against the real authorised API, database, C12 confirmation, C5 snapshot, and C10 scene job. Do not reuse the mock result as that gate.

## Explicit non-evidence

- Physical device, LiDAR, camera, browser assistive-technology pairing, GPU/render worker, provider/model, paid service, and network-ingested catalog: `<not run unless independently attached>`
- Customer or licensed production data: `prohibited for this lane`
- Price, supplier, stock, availability, delivery, cost, structural, regulatory, or professional certainty: `not asserted`

## Reviewer decision

- Decision: `<accept | reject | accept with named follow-up>`
- Blocking findings: `<none or issue links>`
- Follow-ups and accountable owner: `<items>`
- Reviewer signature and timestamp: `<name · ISO-8601>`
