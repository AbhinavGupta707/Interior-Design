# C6 inference worker and plan-parser adapter

## Purpose and authority boundary

The C6 inference worker turns one already-approved, already-normalized plan page into either a strict
`c6-plan-proposal-v1` proposal or an explicit abstention. Its output is an immutable proposal only. It
cannot access the platform database, object store, C5 preview/commit routes, credentials, or network,
and it cannot mutate canonical home state.

The baseline has no paid provider, API key, model download, outbound inference request, GPU, or
training path. It uses Python 3.12 standard-library code for deterministic fixture/vector parsing and
a bounded CPU grayscale raster baseline. Extracted text is accepted only in the vector `labels` array;
the parser never interprets it as instructions, never places its contents in diagnostics, and never
uses it to change geometry or policy.

## Process protocol

Invoke the package without a shell and put the service source root on `PYTHONPATH`:

```sh
PYTHONPATH=services/inference-worker/src \
  python3 -m inference_worker.plan_parser < envelope.json > result.json
```

The CLI accepts no arguments. Stdin is capped at 32 MiB and must contain exactly:

```json
{
  "normalizedInput": {},
  "request": {
    "jobId": "30000000-0000-4000-8000-000000000001",
    "limits": {
      "maximumCandidates": 200,
      "maximumOutputBytes": 5242880,
      "timeoutMilliseconds": 30000
    },
    "normalizedInputSha256": "64-lower-case-hex-characters",
    "parserMode": "deterministic-fixture",
    "schemaVersion": "c6-plan-parser-input-v1",
    "source": {}
  }
}
```

`request` is validated against the frozen request boundary, including exact fields, UUIDs, source
identity, rights, dimensions, page, SHA-256, mode, and literal limits. A malformed request is too
unscoped to form a schema-valid result, so the process exits `64`, emits no stdout, and writes only a
constant safe code such as `C6_PARSER_INPUT_INVALID` to stderr. Once a valid request is available, all
supported input, geometry, confidence, deadline, and resource failures produce a strict abstention.
No exception text, input text, path, URL, source byte, or environment value is written to stderr.

## Normalized input v1

The lane-local normalized schema is `c6-normalized-plan-v1`. It is intentionally narrower than source
PDF, SVG, PNG, or JPEG. The spatial worker owns hostile-media handling and rewriting into this format.
All object field names are ASCII identifiers, all numbers are safe integers, nesting is capped, unknown
fields are rejected, and `sourceSha256`, `width`, and `height` must exactly match the frozen request.
The SHA-256 in `request.normalizedInputSha256` is calculated over UTF-8 JSON with keys sorted,
no insignificant whitespace, unescaped Unicode, and no floating-point values.

### Fixture and vector geometry

`kind` is `fixture` for `deterministic-fixture` or `vector` for `deterministic-vector`:

```json
{
  "height": 8000,
  "kind": "vector",
  "labels": [
    {
      "region": {
        "maximum": { "x": 7000, "y": 5000 },
        "minimum": { "x": 2000, "y": 2000 }
      },
      "text": "Untrusted room label"
    }
  ],
  "openings": [
    {
      "confidence": 90,
      "end": { "x": 5000, "y": 1000 },
      "openingKind": "door",
      "start": { "x": 4000, "y": 1000 }
    }
  ],
  "schemaVersion": "c6-normalized-plan-v1",
  "sourceSha256": "64-lower-case-hex-characters",
  "walls": [
    {
      "confidence": 90,
      "end": { "x": 9000, "y": 1000 },
      "start": { "x": 1000, "y": 1000 }
    }
  ],
  "width": 10000
}
```

The deterministic baseline currently publishes only one connected, closed, non-self-intersecting
straight-edged boundary. Every endpoint must have degree two. Duplicate walls, disconnected cycles,
zero-area boundaries, intersections, ambiguous traversal, an unhosted or multiply-hosted opening, and
overlapping openings abstain as `ambiguous-topology`. Each opening marker must lie strictly inside
exactly one full wall centreline. This deliberately narrow baseline abstains instead of inventing a
multi-room face decomposition.

### Metadata-free raster

`kind` is `raster-gray8` for `deterministic-raster`:

```json
{
  "encoding": "gray8-base64",
  "height": 800,
  "kind": "raster-gray8",
  "pixelsBase64": "one-row-major-byte-per-pixel-as-base64",
  "schemaVersion": "c6-normalized-plan-v1",
  "sourceSha256": "64-lower-case-hex-characters",
  "width": 1000
}
```

The decoded byte length must equal `width * height` and may not exceed 20 megapixels. Bytes are
row-major grayscale only: `0` is black and `255` is white; there are no headers, profiles, metadata,
filenames, or embedded text. The CPU baseline thresholds at 127, collapses line bands, and supports one
rectangular outer boundary with up to four interior line gaps. A supported gap becomes a hosted
`openingKind=unknown` candidate plus an explicit unresolved region requiring manual classification.
Additional line bands, tiny or dominating gaps, and ambiguous topology abstain rather than being hidden.

## Determinism, confidence, and output

- Canonical normalized JSON is SHA-256 pinned before geometry processing.
- Candidate UUIDv5 values derive from source SHA, candidate kind, and canonical geometry, so label text
  and job retries cannot move candidate identity.
- Proposal UUIDv5 values pin the job, normalized hash, adapter ID, and adapter version.
- Parser manifests name the exact deterministic mode/normalizer and hash their canonical manifest.
- The deterministic `createdAt` value is `1970-01-01T00:00:00.000Z`; workflow/audit persistence owns
  real processing timestamps. This keeps byte-for-byte fixture evidence reproducible.
- Candidate count is capped at 200. Proposal publication requires every emitted candidate and the
  resulting overall confidence to be at least 75. Lower confidence becomes `low-confidence`.
- Unknown raster opening kinds remain visible in `findings` and `unresolvedRegions`; they are never
  silently accepted.
- The CLI re-encodes compact canonical JSON and replaces an oversized result with a bounded
  `resource-limit` abstention before writing stdout.

Cooperative CPU checks enforce the frozen 30-second internal deadline and monotonic cancellation.
The TypeScript adapter additionally owns the external wall-clock deadline and abort signal. A timed-out
or aborted process can never return late output to its caller.

## TypeScript adapter

`packages/provider-adapters/src/plan-parser/index.ts` exports `IsolatedPlanParserAdapter` directly from
its allocated subpath. C6 workers must pass an exact executable and argument vector; for local Python:

```ts
const adapter = new IsolatedPlanParserAdapter({
  command: "python3",
  arguments: ["-m", "inference_worker.plan_parser"],
  pythonPath: "services/inference-worker/src",
});
```

The adapter uses `spawn` with `shell: false`. It validates the frozen request before spawn, validates
and hashes integer-only normalized JSON, caps input/output/stderr, enforces timeout/abort, parses exactly
one JSON result, validates the frozen result schema, and rechecks job/project/source/hash/parser mode.
The child environment is rebuilt from a small allowlist: locale, `PATH`, required Windows process keys,
deterministic Python flags, and the explicitly supplied `PYTHONPATH`. Cloud, provider, token, credential,
home, and caller-specific variables are not inherited. Child stderr is never copied into public errors.

Failures are represented by bounded adapter codes (`INVALID_REQUEST`, `INVALID_NORMALIZED_INPUT`,
`NORMALIZED_INPUT_HASH_MISMATCH`, `PARSER_UNAVAILABLE`, `PARSER_TIMEOUT`, `PARSER_ABORTED`,
`PARSER_OUTPUT_TOO_LARGE`, `PARSER_OUTPUT_MALFORMED`, `PARSER_OUTPUT_INVALID`,
`PARSER_SOURCE_MISMATCH`, `PARSER_STDERR_TOO_LARGE`, or `PARSER_EXITED`) with only availability,
timeout, and non-zero exit marked retryable.

The provider package barrel and package export map remain orchestrator-owned. Integration must add the
`./plan-parser` export and connect this adapter to the spatial-worker lane after merge; this worker does
not make either shared edit.

## Verification

Focused checks from the repository root:

```sh
pnpm --filter @interior-design/provider-adapters lint
pnpm --filter @interior-design/provider-adapters typecheck
pnpm --filter @interior-design/provider-adapters test:unit
pnpm --filter @interior-design/provider-adapters build

PYTHONPATH=services/inference-worker/src uv run ruff check services/inference-worker
PYTHONPATH=services/inference-worker/src uv run ruff format --check services/inference-worker
PYTHONPATH=services/inference-worker/src uv run mypy --strict services/inference-worker/src \
  services/inference-worker/test
PYTHONPATH=services/inference-worker/src uv run pytest -q services/inference-worker/test
```

The TypeScript unit suite invokes the real Python CLI for cross-language canonical-hash and deterministic
result parity. Separate hostile child fixtures cover malformed/schema-invalid/oversized output, timeout,
abort, source swapping, and the no-secret environment. Python tests cover fixture/vector/raster behavior,
topology and hosting, source mismatch, low confidence, prompt-like label text, immutability, deadline,
cancellation, malformed input, and bounded compact output.

No live provider, network, GPU, customer plan, survey claim, or hardware gate applies to this baseline.
