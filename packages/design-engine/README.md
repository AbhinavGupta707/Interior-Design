# `@interior-design/design-engine`

Pure deterministic C12 constraint, spatial-validation, bounded-search, Pareto and diversity engine. It is proposal-only: it cannot persist, authorise or confirm model mutations.

## Public API

`deriveDeterministicDesignConstraints(input: unknown)` is the narrow job-preflight port. Runtime validation accepts an exact candidate-independent shape containing only the accepted C11 brief and content pin, C4 source/working references and snapshots, typed brief facts, explicit keep-outs, valid finish-target policy and the versioned boundary-touch system policy. It returns the frozen constraints and `constraintsSha256`, or a typed abstention. It accepts no candidates, assets, search controls, clocks or providers.

`runDeterministicDesignEngine(input: unknown)` accepts the full frozen C12 job input and calls that same preflight implementation before search. A platform job can therefore freeze the constraint set at creation and a worker can rederive identical IDs and hashes before publication. It returns either:

- a successful declaration with derived C12 constraints, exact C12 operation bundles, replayed canonical candidate snapshots/hashes, non-dominated candidates and a complete pairwise diversity matrix; or
- a typed, privacy-minimised abstention. Abstentions never echo brief statements or asset payloads.

The remaining public exports are version/resource constants and TypeScript input/result types.

The shared set never contains candidate-generated element IDs. It deterministically retains exact canonical levels, spaces, fixed geometry and valid common finish hosts, adds explicit keep-outs, and accepts typed brief facts only when their referenced elements exist in the common working snapshot. A fact that could apply only to some templates causes a typed abstention. Candidate furnishing containment, collision, per-side asset clearance, vertical fit, binding and finish-face validation remain mandatory rejection gates, without being misreported as shared constraint passes. Every retained operation bundle contains exactly one truthful result for every frozen constraint.

Candidate templates carry bounded integer objective vectors from the trusted placement-producer port. The engine keeps those proxies separate from hard constraint results, normalises their order, rejects conflicting scores for semantically identical candidates and computes the stable Pareto frontier. Brief prose is never parsed into geometry or an objective score; hard brief entries require an explicit typed computational fact or the engine abstains.

## Determinism and geometry

- Coordinates/dimensions are integer millimetres; rotations are integer milli-degrees.
- Arbitrary rotations use a frozen BigInt CORDIC kernel and a `10^12` trigonometric scale. All subsequent predicates use exact BigInt arithmetic with no epsilon.
- Room, obstacle and keep-out boundary contact are three explicit policy values.
- Furnishing/fixed-object rectangles use an exact separating-axis test. General room/keep-out polygons use exact segment/winding predicates, including concave containment.
- Per-side asset clearance is applied in the local `positive-y` forward-axis convention before rotation.
- Search examines a stable semantic ordering and ends only at the configured candidate-count budget. It never reads time, randomness, provider state, GPU state or thread order.

## Hash and diversity rules

Canonical declarations sort object keys and stable-ID collections before SHA-256 hashing. Bundle hashes bind exact operations and source declarations; candidate snapshot hashes come from the C5 reducer. Semantic diversity deliberately excludes option/template/operation/generated-element UUIDs, reasons, names, rationale prose and rendered media. It covers asset inventory, semantic assignment slots, placement, material bindings and operation signatures.

Creator-owned synthetic `bounded-proxy` assets are the only accepted C12 asset contract. External network/provider execution, customer data, training permission, price, stock and professional claims are outside this package.
