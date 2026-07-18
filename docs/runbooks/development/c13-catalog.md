# C13 catalog ingestion and publication

This runbook operates the C13 creator-authored catalog lane. It is a local, deterministic pipeline: it reads only repository-owned files, validates every byte before admission, publishes immutable content-addressed objects, and makes a release visible with one atomic head operation.

The lane does not ingest from the network. It has no arbitrary URL, archive, scrape, upload, provider, paid-service, customer-data, price, stock, delivery, supplier, or training-permission surface.

## Owned fixture set

`packages/catalog/fixtures/source/release.json` describes eleven synthetic assets:

- all eight exact immutable C12 starter refs;
- `compact-armchair`, a creator-authored furnishing alternative;
- `floor-finish-mineral-tone`, a creator-authored finish alternative;
- `wall-sconce`, a creator-authored light alternative.

Each asset has a real GLB, a 512 by 512 metadata-free RGBA PNG, a source receipt, and the shared creator-owned licence text. The receipts state that no external network or third-party source was used. Training permission is denied. Raw fixture redistribution is denied. Commercial service use, design derivatives, thumbnail display, and rendered-output distribution are explicitly reviewed and approved.

These files are bounded proxies for testing and design placement. They are not branded products, purchasing recommendations, surveyed geometry, structural truth, availability evidence, or as-built state.

## Validation boundary

The pure `@interior-design/catalog` kernel is dependency-injected through `KhronosValidatorPort`. The spatial-worker `PinnedKhronosValidator` is the production adapter and invokes `gltf-validator@2.0.0-dev.3.10` from the existing `@interior-design/scene-compiler` installation. It fails closed when the package cannot be resolved, its version differs, it reports any error or warning, or it throws.

The kernel also applies stricter catalog rules:

- exact declared SHA-256 and media type for every source byte;
- GLB v2 with exactly JSON and BIN chunks, no URI, external resource, `extras`, camera, animation, skin, image, texture, unsupported extension, graph cycle, negative transform, or non-finite accessor value;
- right-handed glTF metres, +Y up, +Z front, 1000 millimetres per metre, floor-centred pivot, and envelope bounds within 2 millimetres;
- normals, UVs, indexed triangles, declared accessor bounds, byte-range/alignment checks, and the frozen node/mesh/material/vertex/triangle limits;
- PNG signature, CRC, chunk order, RGBA8/sRGB interpretation, non-interlaced decoding, bounded inflation and dimensions, with every metadata or APNG chunk rejected;
- strict UTF-8 licence/receipt text with terminal newline and no controls, bidi overrides, credential-shaped data, or token-shaped data;
- concluded licence equality, approved review, pinned SPDX list version, service processing, commercial/derivative/render/thumbnail grants, raw redistribution denied, and training denied.

All public failures use stable catalog codes and non-reflective messages. Artifact bytes, local paths, object keys, source receipts, internal source URIs, credentials, and signed access URLs are not telemetry dimensions.

## Local execution

Install the frozen workspace dependency graph first:

```sh
pnpm install --frozen-lockfile
```

Run the real ingestion path through the spatial-worker tests. These tests instantiate `RepositoryCatalogSource`, the pinned Khronos adapter, and the memory, filesystem, and S3-compatible publication stores:

```sh
pnpm --filter @interior-design/spatial-worker exec vitest run test/catalog --exclude 'dist/**'
```

For an executable worker integration, construct these four objects inside the existing worker composition layer:

```ts
const source = await RepositoryCatalogSource.create(repositoryFixtureRoot);
const publication = await FileSystemCatalogPublicationStore.create(catalogPublicationRoot);
const pipeline = new CatalogIngestionPipeline({
  publication,
  source,
  validator: new PinnedKhronosValidator(),
});
const result = await pipeline.execute({ signal });
```

Both roots must be explicit absolute internal paths. The source reader rejects traversal and every symlink component. Do not point either root at a user upload, archive extraction, network mount with untrusted writers, or broad filesystem location.

For repository-local S3-compatible storage, inject the already configured narrow AWS command client. The store accepts no endpoint or credentials of its own:

```ts
const publication = new S3CatalogPublicationStore(derivedBucketCommandClient);
```

It is fixed to the `derived` bucket, `catalog/sha256/**` content prefix, and `catalog/releases/<semver>/head.json` release-head prefix. Root composition owns the concrete client and live local-storage readiness check.

`execute` returns either a complete publication or a safe diagnostic. `ingest` throws a typed `CatalogError` for callers that already have a worker error boundary. An `AbortSignal` cancels stalled reads, hooks, validation, or staging waits. The frozen ingestion deadline is 60 seconds.

## Publication protocol

Objects are installed under `objects/sha256/<prefix>/<sha256>`. The bytes must hash to their path; an existing different body is an immutable identity conflict. The release manifest is another content-addressed object.

Only after every required object is readable with its exact length and SHA-256 does the filesystem store install `release-heads/<semver>.json`. It writes and fsyncs a private pending file, then uses an atomic hard-link create. Concurrent identical publishers produce one new head and one replay. Same-version/different-body publication fails. A crash, timeout, or cancellation before the link may leave unreachable content-addressed objects, but exposes no release or partial asset list.

The S3-compatible store uses conditional `If-None-Match: *` writes. Every content object carries the exact base64 SHA-256 object checksum, SHA-256 and storage-kind metadata, media type, and content length. Existing objects are accepted only when all identity fields and the server-reported checksum match. Before the conditional release-head write, the store checksum-enabled HEAD-verifies the manifest and every required artifact. An identical pre-existing head is a replay; a conflicting object or head is never overwritten. The live integration gate additionally performs a GET and post-download hash.

Release heads and asset arrays are canonical and sorted. Re-running the same source bytes reproduces the same asset IDs, artifact IDs, hashes, release ID, manifest bytes, and head bytes.

## Isolated API integration

`services/platform-api/src/modules/catalog` deliberately is not centrally composed in this lane. The integration owner must inject:

- a `CatalogRepository` populated from an accepted release head;
- a `CatalogArtifactStorage` constrained to the catalog content-addressed prefix;
- the existing identity and project repositories;
- `registerCatalogRoutes` in the central platform composition layer.

The frozen routes are read-only: list/get releases, list/get assets, and get short-lived artifact access. Every route authenticates `catalog:asset:read` and verifies project membership before disclosure. Asset listing is stably ordered and cursor-paginated with a maximum page of 24 and release maximum of 512. The strict wire filters are `kind`, `rights`, `source`, `query`, `limit`, and optional `cursor`; L3's exact `kind=all&rights=all&source=all&query=&limit=24` default normalizes to no filters. The response is `{ assets, releaseId, total, nextCursor? }`, and a cursor is bound to the release and normalized filter identity. Artifact access is five minutes, `private, no-store`, bound to an exact artifact identity, byte length, media type, and SHA-256, and audited by tenant, user, project, request, and artifact IDs. The public service strips internal `rights.sourceUri`.

The service method `requireSelectableAsset` is the integration boundary for new specifications and substitutions. Callers must supply the exact release-manifest SHA-256 and asset-version SHA-256. Published status, approved lifecycle and rights, and availability of all four required artifacts are rechecked server-side. A withdrawn, expired, deprecated, superseded, quarantined, missing, or hash-mismatched record remains readable as history but returns a conflict for new selection.

The current dependency graph resolves the pinned validator without a new root-owned export. If a future packaging change removes the scene-compiler installation anchor, the narrow integration seam is a scene-compiler export that returns the pinned `gltf-validator` module's `validateBytes` and `version` functions; do not replace it with structural validation.

## Fixture regeneration

The committed fixtures are generated entirely from the C12 refs and repository-authored constants. Regenerate them only when intentionally reviewing fixture bytes and all resulting hashes:

```sh
node --conditions=development --import ./services/spatial-worker/node_modules/tsx/dist/loader.mjs packages/catalog/scripts/generate-fixtures.ts
```

After regeneration, run all checks below and inspect every binary/hash change. No network access is needed or permitted.

## Verification

```sh
pnpm --filter @interior-design/catalog lint
pnpm --filter @interior-design/catalog typecheck
pnpm --filter @interior-design/catalog exec vitest run test --exclude 'dist/**'

pnpm --filter @interior-design/spatial-worker lint
pnpm --filter @interior-design/spatial-worker typecheck
pnpm --filter @interior-design/spatial-worker exec vitest run test/catalog --exclude 'dist/**'

pnpm --filter @interior-design/platform-api lint
pnpm --filter @interior-design/platform-api typecheck
pnpm --filter @interior-design/platform-api exec vitest run test/c13/catalog --exclude 'dist/**'

pnpm exec eslint tests/security/catalog
pnpm exec tsc -p tests/security/catalog/tsconfig.json
pnpm exec vitest run --config tests/security/catalog/vitest.config.ts

git diff --check
```

The focused suites prove deterministic replay, actual pinned-validator invocation, byte/hash/MIME enforcement, hostile GLB/PNG/manifest rejection, rights failures, traversal and symlink rejection, deadline cancellation, concurrent publication, filesystem and conditional-S3 conflict behavior, crash-before-head behavior, no partial visibility, stable filtering/cursors, L3 default-query compatibility, API authorization/tenant isolation, internal-URI redaction, short-lived access, historical readability, and selection blocking.

No browser, GPU, LiDAR, physical-device, provider, live object-store service, or production database evidence is produced by this lane. The filesystem and memory stores plus bounded S3 command-client fake provide local integration evidence only; central composition and live local/deployed storage/database verification remain integration-owner responsibilities.
