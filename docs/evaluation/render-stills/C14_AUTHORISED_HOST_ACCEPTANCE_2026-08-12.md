# C14 authorised-host acceptance and production close-out - Session B

Date: 2026-08-12 Session B, completed 2026-08-13 Europe/London
Branch: codex/c14-windows-acceptance
Required base: dab5580f9a476eeb33aeea66ae98c872706a156c
Final counted source: 1e9b7e227e6d96e4b65842dde8191f97fb97a54d
Decision: **C14 CLOSED**

## Scope and evidence boundary

This record closes the deferred C14 authorised-host gate for the exact Linux Blender CPU profile below. It supplements the historical Session A record; it does not rewrite that session's honest no-Blender result.

One primary gpt-5.6-sol / xhigh agent used the authorised regular, non-symlink Linux Blender executable, CPU Cycles, one render thread, and disposable loopback PostgreSQL and SeaweedFS. It did not use CUDA, OptiX, GPU/Metal rendering, native Windows Blender, Blender MCP/add-ons, model downloads, customer data, an enhancement provider, production deployment, merge, or PR.

Raw artifacts remain in the ignored local directory docs/evaluation/render-stills/artifacts/c14-windows-wsl-2026-08-12-session-b. This minimised record, the ledger and L4 update are tracked. No database passwords, opaque download tokens, signed URLs, raw host names, user names, IP addresses or unnecessary machine identifiers are recorded.

## Root causes and fixes

- Retained failed outputs had identical pixels. PNG bytes differed only in volatile Date, RenderTime and Cycles timing text chunks/CRCs; EXR bytes differed only in Date and RenderTime header strings.
- c14-render-container-normalization-v1 removes only those named PNG fields and replaces equal-length EXR time values in place. PNG IDAT, EXR offset tables/pixel payload and non-volatile metadata remain unchanged. Regression tests prove preservation and idempotence.
- Acceptance recorded five replay failures but returned success. It now fails closed on every missing/unequal role and records both hash sets.
- Durable evidence now includes independent PNG/EXR validation, actual finite EXR channels, Cryptomatte membership, GLB/bounds, camera, materials, light, palette, geometry, disk, process and timeout proof.
- OCIO is explicitly path/hash pinned. Root tsx is pinned. Segmentation now uses Raw/None, one CPU sample, a 0.01 box filter and no denoise, so only exact palette/background colours remain.
- Production mode now composes registerC14Module, loopback Fastify, composeC14RenderRunner and IsolatedStillRenderer. FrozenInertRenderer remains an explicitly labelled control-plane mode only.
- The first real publication exposed Fastify's 100-character route-parameter default: an encrypted opaque token returned 414. The server now admits the centralized 12,288-character bound and rejects longer values; regression tests cover both limits.

No threshold or exact-byte contract was weakened.

Implementation commits were dbb227c904df5394720779a08d437234415df0b3 and 1e9b7e227e6d96e4b65842dde8191f97fb97a54d. Both were pushed before the counted run, which began from a clean tree at the latter SHA.

## Preflight

The remote source resolved exactly to the required base; the branch was created from it without reset/rebase; the initial tree was clean. Both AGENTS files, active/master M1 plans, C14 contract/close-out/hardware plans, renderer runbook, evaluation and ledger were read completely. More than 350 GiB was free. Docker client/server/Compose worked. The Blender path was a regular non-symlink executable. All required source/inspection/evaluation files existed, and the final output directory did not.

## Phase 1 - authorised-host acceptance

    C14_ACCEPTANCE_BLENDER_PATH=/home/abhinav/opt/blender-5.2.0-linux-x64/blender pnpm exec tsx workers/blender-renderer/scripts/host-acceptance.ts --output-directory docs/evaluation/render-stills/artifacts/c14-windows-wsl-2026-08-12-session-b

Exit 0; outcome passed. acceptance-evidence.json SHA-256: d1313de0438d9b35666aa088a95ff77f132f4d0f086f826a86ed6781a16d77a5.

- Blender 5.2.0 LTS, build fbe6228777e7.
- Executable: 83e8261eace07a5337f71b52d156c1eece1a6ba913403cc6406182ae58bacf27.
- Renderer script: 1cdaf63c4d6c1911c4f697ab38e88abfaaf8ebd0ac725958e94582953bf30a17.
- EXR inspector: cb6fcba0be4181c6b96e575c86155880d5e262eac7aa2a31b9ed6d000d8656f3.
- OCIO: 47a7d83e79c1d21f49ba6c505efe311da723471688c614b5c366e1da7eb8ea3a.
- Privacy-minimised host fingerprint: c8d4f734dc49e710b47fee4c3723955f32fb39eca58c43dc8af220661196e49c.
- Profile: cycles-cpu-geometry-safe-v1, 256x256, 16 samples, seed 14, one thread, no denoise, 45,000 ms.
- Smoke: 64x64, one sample, passed in 2,388 ms. Primary: 1,965 ms. Replay: 1,971 ms.
- Disk: 376,895,320,064 bytes available versus 21,474,836,480 required; passed.
- One worker, 65,536-byte process-output bound; timeout, output-limit and executable-hash mismatch regressions passed.

### Exact-byte replay

| Role              |  Bytes | Primary and replay SHA-256                                       | Exact |
| ----------------- | -----: | ---------------------------------------------------------------- | ----- |
| geometry-safe-png | 15,505 | d5487c6164f0c3bb0bb1189873a5325d78eb5231f0503409fc57d15d6839c00d | yes   |
| multilayer-exr    | 63,281 | 6d8ddd18c378669ee88273ff3ff49831e786a13aa653aa81c7289249aa1f5948 | yes   |
| depth-exr         | 12,150 | 110a7ed818cc2fed93a0894ceddb1b1998956c70f24e28a0cbd4f5cc6c06c4d7 | yes   |
| normal-exr        |  6,001 | 234d01ad5d7442a10defd7e3fa4b75d8e9997bcda537b855281af1c0c1cc8904 | yes   |
| segmentation-png  |  3,363 | cf369f9b34336a18c44db37aefbda49d2cb98c21787a9b70e88d30230b0e0aac | yes   |

Primary/replay manifests truthfully identify distinct executions, but every artifact byte hash is exact and source/render-scene identity matched. Geometry had zero changed/outside-mask pixels, 10,000 bp protected-edge agreement and 10,000 bp segmentation IoU.

The multilayer EXR had Combined RGBA, Z.V, Normal XYZ and CryptoObject00 rgba; depth had depth.V; normal had normal XYZ. All inspected pixels were finite. Cryptomatte exactly contained the renderable furnishing and light. The GLB had six expected IDs, safe bounds, no drivers/scripts, external resources or unsafe extensions. Camera/material/rights/light matched. Segmentation had 2,275 palette pixels and 63,261 background pixels with no missing/unexpected colours.

## Phase 2 - production-composed journey

    docker compose -p c14-session-b -f infrastructure/local/compose.yaml up -d postgres object-storage
    C14_TEST_DATABASE_URL=$C14_ACCEPTANCE_DATABASE_URL pnpm exec vitest run services/platform-api/test/c14/render-stills/postgres.integration.test.ts

Postgres/PostGIS and SeaweedFS became healthy on loopback with fresh project volumes. Local-socket database creation failed peer authentication; the loopback TCP retry with repository fixture credentials succeeded. The focused PostgreSQL gate passed 8/8 with no skip.

The live test was run with C14_RUNNER_TEST_RENDERER_MODE=blender, loopback database/object-store endpoints, the evidence output path, C14_RENDER_WORKER_ENABLED=true, verified-authorised-host, cycles-cpu-geometry-safe-v1, and the exact Phase 1 pins/profile above:

    pnpm exec vitest run tests/integration/render-stills/live-production.integration.test.ts

Result: 1/1 passed. production-journey-evidence.json SHA-256: 6300078b32ff8bdc25dfeaa66eccaa96f23f4912740962621937c08678a22710.

- Project 5797f4cb-8b84-4a3a-8e8f-8d1bd982d2a2; scene job 3763dae5-f0c2-4076-a5cb-1aca133e2010; scene 55b2feee-642c-40a8-8d18-201a26a96c4b; source artifact 3778a4c9-52c5-438c-bc5d-7b7079a0663b.
- Scene GLB a02aa8f67cdf4c1bba95849cbeed4117782d403948952b340cf45ba6e20fad9b; scene manifest 839045e2fd86bbe5666f483f227f6a8c5682a120d8dc31b290d3b06c32d0bb7e; render-scene manifest 99f6754290868f5621ddd466caa52f254f358e7021b73275c2dc88dfb1b74d28; source snapshot dac3efea7e48f462e0e72f3b81ee813ccd46dbf18adf18790099261b2d658a16.
- C13 specification e5ff7d18-b3f9-424c-848e-e79473e3590b revision 2, hash a9ddeb1b9ee6b871c3f02fd9c878fe685ed3e9878d2ddd226cdc8f4c1e90af96; catalog c6b46506-b801-5203-a136-b7118dcd7cec, hash 489e8f28ed441290de95cb012874eeca2c27f6f0171de953c3f91765c9a8e35b.
- Render job 2a2e3fc7-fec6-46b0-81b5-86495a90ea55; result ee445fed-f660-4c2b-8958-c950cc59949d.
- Canonical model state before/after was equal.

### Published and fresh-download hashes

Each artifact was fetched twice through separately minted opaque HTTP URLs. Only URL hashes are retained. Downloaded bytes were independently re-hashed and decoded/inspected.

| Role              | Artifact ID                          |  Bytes | Published/download SHA-256                                       | URL hashes                                                                                                                          |
| ----------------- | ------------------------------------ | -----: | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| geometry-safe-png | ac82312c-daea-537b-9c09-0661eb40766d |  3,776 | 633b861bcce53ed8d1d10af9b2cf4e7ef13abdb81e3e2dfea9ce095bc4a4e2f0 | 09526a0267177786bef25d307c07439f4d39eca3b7859efa938b41d9e975a720 / 678674e065c54f6e9097a487e4467abf96e6f5f705068e0cfb5276a840aa86e6 |
| multilayer-exr    | 23492f1d-2992-5a96-950b-93695ac92577 | 12,453 | 9e388d5e71b537a95684099da211d7adfe836b390eb64180bae43612672408c0 | b35bec3a95fdb4670058b52a36dd4707fe0ed719799ef02617bb2fb3a2681bf0 / 3e3a88cb0dd64b2f565137aff997b217544fb49041b1e7f501d7ccc7ce941d8f |
| depth-exr         | d72c5f5f-e4e2-54b1-ab23-816ef0bd8bd0 |  1,942 | 382e424c8aed56e82c92c63a6a4eef0581b594295397c9d99613f8d29d3eabea | 592aa7c584217ee411edacb6e2372d36d5182ba8f0a89200b3cb1ee06215228f / a13164f3883c079ea2b583e4c7a211f970cc6ab96fb5e7cdd943aa71634ea0d1 |
| normal-exr        | f0bf25a8-7e54-5b55-85be-1ccd829c36cf |  2,500 | 018c028d3712fd3f96d9f44b97f723306f76488432da8d191c446537c0a46c94 | 561f79e0776b4239b1d7e0a581d482e391d272b5aa95e09c99b017712316b304 / 344fdf870e875565793793350c46a5da0cdf0d3651f5f3c38817861362e4a078 |
| segmentation-png  | 0b5190cf-58c1-5f6e-9586-75f163390aaa |  2,520 | bf21a3c4c6203ab9a2a2dca875b9e210d3cbe3b4648c25cb9383afb4f75eb0e3 | e6b323ad01652e1de067e06c0228a3a4ba4e69bb3e755d6409a7d03e3f687878 / 56319f1caff10974286cc2025e5a07a8ecd38966b729aad6efad51a10641f055 |

All downloads decoded at 256x256 with exact type/length/hash. EXRs were finite with required channels and expected furnishing Cryptomatte. Segmentation had 70 palette and 65,466 background pixels, no missing/unexpected colours. No artifact was synthetic or inert.

## Final gates and skips

- Focused renderer 18/18; spatial worker 17/17; API composition/server passed (server 6/6); root tsx passed.
- Environment-enabled pnpm test:c14 passed: render-scene 15, renderer 18, API 26 including PostgreSQL 8, spatial 6, web 9, evaluation 8, standalone 18, enhancement/security 22, live production 1, API seam 13, boundary 3. Mandatory C14 skips: zero.
- UV_CACHE_DIR=.cache/uv pnpm verify passed formatting/lint/typecheck/unit/build, Ruff, strict MyPy and Python 133 passed / two honest capability skips.
- pnpm test:contract and pnpm test:integration exited 0; security 921/921; geometry 43/43.
- Pinned mcr.microsoft.com/playwright:v1.61.1-noble digest sha256:5b8f294aff9041b7191c34a4bab3ac270157a28774d4b0660e9743297b697e48: onboarding 6/6 and C14 22/22 across Chromium, Firefox and WebKit desktop/mobile.
- docker compose -p c14-session-b -f infrastructure/local/compose.yaml down --volumes removed exactly the two project containers, two project volumes and one project network; follow-up listings were empty.
- git diff --check passed before evidence commit.

Native browser execution lacked shared libraries; install-deps reached an interactive sudo boundary and was terminated without installation. The pinned official disposable image supplied the bounded browser environment.

Skip inventory: zero mandatory C14 skips. The two verify skips are unavailable COLMAP/Open3D capabilities unrelated to C14. Generic no-service root contract/integration runs retain expected service-capability skips (API 51, spatial 3); they are not substituted for C14 evidence. Relevant C14 PostgreSQL ran 8/8 and production-composed ran 1/1 with services.

## Closure

C14 is closed for this exact Linux Blender 5.2.0 LTS CPU profile and source. CUDA, OptiX, GPU, Metal and other profiles remain unavailable/unclaimed. C15 was not opened. No merge or PR was created.
