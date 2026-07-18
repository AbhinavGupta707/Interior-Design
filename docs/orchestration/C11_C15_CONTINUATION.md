# C11–C15 Authorised Continuation

## Authority and terminal boundary

The user authorised sequential implementation of active checkpoints C11, C12, C13, C14 and C15 on 2026-07-18 after C10 closed at `2cfa04772493b8fd60446edf9dc75fced7b5557b`. C10's accepted contract remains immutable; this document records the subsequent authority. C15 is terminal for this run. C16 is not authorised and must not be opened, scaffolded or launched.

`ai_native_architecture_blue_sky/docs/implementation/08_ACTIVE_BLUE_SKY_M1_EXECUTION_PLAN.md` is controlling. Older C11–C19 labels in `04_POST_M1_AND_GPU_ROADMAP.md` are historical identifiers only.

## Sequential execution rule

Only one checkpoint is active. For each checkpoint the orchestrator must:

1. inspect the integrated predecessor and current environment;
2. research current primary sources needed for the contract;
3. freeze schemas, authz actions, migration allocation, feature/provider flags, lane ownership, reasoning and gates in a committed prelude;
4. launch only the adaptive, non-overlapping project worktree lanes declared by that contract;
5. monitor without duplicating or prematurely taking over active work;
6. review every worker diff and commit, merge in declared dependency order and repair integration only on `main`;
7. run full repository verification plus checkpoint-specific contract, property, integration, security, performance and user-surface gates;
8. record real evidence, explicit skips/`NOT RUN` states, limitations and SHAs in durable evaluation and ledger records;
9. commit and push a clean closure before opening the next checkpoint.

The 20-minute task heartbeat is a continuity guard, not an implementation lane. It may resume safe work only when the task is idle and must never overlap current workers.

## Cross-checkpoint decisions

### Provider, privacy and data policy

- DQ-021 remains conservatively resolved for this run as **local deterministic adapters only**.
- External LLM, still-enhancement, video-enhancement, voice and music providers are disabled. No paid service, credential, outbound inference call, real customer data or training permission is required.
- Provider ports, manifests and honest unavailable states are production architecture. Fixture output is never presented as provider output.
- Accessibility, health, household, address and evidence details are treated as private project data. They are minimised, never logged as raw prompts, and are not sent to an external model.
- AI emits expiring typed proposals. Only an authorised person can confirm a brief change, model operation or design branch. A model never receives database credentials or direct mutation authority.

### Product and professional boundaries

- Product language is `interior-design assistant` or `interior-design agency workspace`, not an unreviewed claim of registered architect, engineer or approved professional.
- Structural, regulatory, clinical-accessibility, cost-certainty and live product-availability questions are captured and routed to explicit review; the application does not invent an answer.
- Existing, proposed and as-built state remain separate. Every design/render/video binds exact brief, snapshot, branch, specification, source, tool and configuration versions.

### C12/C13 asset dependency

C12 freezes a small generic `InteriorAssetRef` interface with exact integer dimensions, licence/source status and stable content/version identifiers. Its deterministic starter assets are creator-owned synthetic fixtures. C13 then supplies a richer versioned catalogue conforming to that interface. This preserves checkpoint order without letting C12 invent product data.

### C14/C15 durable product ownership

The active lane descriptions are amended by the controlling plan so C14 and C15 include tenant-safe job persistence, leases, cancellation/retry, storage/publication fencing and complete web generation/status/view/playback journeys. Renderer or encoder libraries alone cannot close either checkpoint.

### Hardware and closure

- The Mac is the local baseline for exact software gates. FFmpeg/ffprobe 8.1 are installed. Blender must be installed, pinned and proven through a real headless CPU or Metal render before C14 can close.
- C14 requires an actual Blender render and geometry pass set from a synthetic exact model; fake image fixtures are not renderer evidence.
- C15 requires actual Blender frames plus actual FFmpeg encoding and ffprobe validation; fake video fixtures are not encoder evidence.
- CUDA/OptiX, Windows/NVIDIA high-resolution rendering, external generative media, physical RoomPlan and representative-home/professional studies remain separate `NOT RUN` release evidence unless genuinely executed. A checkpoint may close locally with real deterministic Mac evidence and visibly disabled optional capabilities; it may not claim those unavailable profiles.
- Pause new render/video jobs if free space is below the greater of 15 GiB or three times the estimated job bytes.

## Adaptive checkpoint map

| Checkpoint | Lanes | Frozen purpose                                                                                            | Migration                 | Required real user/runtime gate                                                                            |
| ---------- | ----: | --------------------------------------------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| C11        |     3 | structured brief, bounded local consultation, agency workspace                                            | `0011_design_briefs.sql`  | local Postgres/API plus responsive, keyboard and multi-browser consultation journey; no canonical mutation |
| C12        |     4 | deterministic constraints/layout/assets, proposal runtime, option UX                                      | `0012_design_options.sql` | accepted brief to distinct valid operation bundles and explicitly confirmed isolated branches              |
| C13        |     3 | rights-aware generic catalogue, room specifications, selection UX                                         | `0013_specifications.sql` | exact option/catalog/spec linkage, safe replacement through C5/C10 and browser schedules                   |
| C14        |     4 | render scene, Blender/durable backend, optional disabled enhancement, render UX/QA                        | `0014_render_jobs.sql`    | real headless Blender still and passes plus signed artifact and browser compare/status journey             |
| C15        |     4 | camera path/authoring, durable Blender/FFmpeg video, optional disabled enhancement/narration, temporal QA | `0015_video_jobs.sql`     | real frames, encode, ffprobe, captions and accessible multi-browser playback journey                       |

Only the current checkpoint migration is added to the migration registry during its prelude.

## Regression and acceptance baseline

Every checkpoint runs `UV_CACHE_DIR=.cache/uv pnpm verify`, `git diff --check`, the complete clean migration chain where persistence changes, explicit tenant/role/IDOR checks, structured-log redaction checks and checkpoint-focused live tests. Browser order is:

1. Playwright for repeatable Chromium, Firefox, WebKit, desktop, mobile and keyboard coverage;
2. in-app Browser for a visible local journey when the controller can acquire a tab;
3. branded Chrome when extension/logged-in Chrome state is specifically relevant;
4. Computer Use for native application or OS-level interactions that cannot be proved through a purpose-built tool.

Unavailable controllers are recorded as `NOT RUN`; separate Playwright evidence is reported honestly rather than relabelled. The complete iOS Simulator suite is a regression after C11 and C15, not sensor evidence.
