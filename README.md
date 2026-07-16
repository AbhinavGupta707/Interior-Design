# Interior Design

AI-native complete home-design system: capture and reconstruct a home, maintain a source-aware canonical model, form an interior-design brief, generate editable options, experience them in 2D/3D/stills/video, decide, and produce an implementation handoff.

## Active programme

The controlling execution plan is [`ai_native_architecture_blue_sky/docs/implementation/08_ACTIVE_BLUE_SKY_M1_EXECUTION_PLAN.md`](ai_native_architecture_blue_sky/docs/implementation/08_ACTIVE_BLUE_SKY_M1_EXECUTION_PLAN.md).

M1 contains nineteen sequential checkpoints, C0–C18. Each checkpoint uses two to four project-scoped Codex worktree lanes with exclusive file ownership. Only one checkpoint is integrated at a time.

## Repository layout

```text
apps/                 web and native iOS applications
services/             platform, spatial and inference services
workers/              isolated rendering/media executors
packages/             domain, geometry, operations and shared libraries
infrastructure/       local-first and optional cloud modules
tests/                cross-package contract, security, E2E and evaluation suites
docs/                 ADRs, orchestration records and runbooks
ai_native_architecture_blue_sky/
                      preserved source research dossier and implementation analysis
```

## Development posture

- Local fixtures and open-source/deterministic adapters first.
- No paid provider or cloud dependency is required for C0.
- Customer media, datasets, model weights, secrets and generated captures/renders never enter Git.
- Native RoomPlan completion requires a supported physical Apple device; simulator tests alone are insufficient.
- CUDA-specific evidence is produced on the separate Windows/NVIDIA workstation when the active checkpoint requires it.

Run `pnpm verify` after dependencies are installed. Checkpoint-specific setup and commands live under `docs/runbooks/`.
