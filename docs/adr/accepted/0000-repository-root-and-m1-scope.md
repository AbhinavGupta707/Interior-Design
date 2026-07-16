# ADR-0000: Repository root and complete M1 scope

- Status: accepted
- Date: 2026-07-17
- Owner: product/orchestrator

## Decision

Use `/Users/abhinavgupta/Desktop/Interior Design` as the Git, monorepo and Codex project root. Preserve the research dossier initially under `ai_native_architecture_blue_sky/`.

M1 is the Complete Home Design System in `08_ACTIVE_BLUE_SKY_M1_EXECUTION_PLAN.md`, including native iOS capture, multimodal reconstruction/fusion, interior-design options, photoreal stills, deterministic and labelled enhanced video, decision tools and implementation handoff.

## Rationale

The selected root is already the saved Codex project/sidebar group. Codex worktrees require a Git repository and copy the selected repository. Root alignment prevents nested discovery/configuration ambiguity and gives every worker the same instructions and committed evidence.

The expanded M1 is intentionally much larger than the former trust-kernel milestone. Sequential checkpoints preserve the trust kernel while delivering the complete user experience requested.

## Consequences

- C0 has four lanes rather than three because native iOS is now a first-class surface.
- Physical LiDAR device evidence is mandatory for capture completion.
- Windows/NVIDIA evidence is checkpoint-specific, not a separate product programme.
- Paid-concierge validation and paid cloud/provider choices do not gate local engineering.
- Generated media remains separate from canonical dimensional truth.
