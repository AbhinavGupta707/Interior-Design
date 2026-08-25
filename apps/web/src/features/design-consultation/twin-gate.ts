import type { DesignBrief, ModelBranch, ModelSnapshotRecord } from "@interior-design/contracts";

export type ConsultationTwinGate =
  { readonly kind: "ready" } | { readonly kind: "stale"; readonly message: string };

export function consultationTwinGate(
  brief: DesignBrief,
  snapshot: ModelSnapshotRecord,
  branches: readonly ModelBranch[],
): ConsultationTwinGate {
  const confirmedCurrent = branches.some(
    ({ headSnapshotId, revision, sourceSnapshotId }) =>
      revision > 0 && headSnapshotId === snapshot.id && headSnapshotId !== sourceSnapshotId,
  );
  if (!confirmedCurrent) {
    return {
      kind: "stale",
      message:
        "Design options require a confirmed exact-current twin. Return to the home journey and commit reviewed corrections before generating alternatives.",
    };
  }
  const reference = brief.modelReference;
  if (
    reference &&
    (reference.modelId !== snapshot.modelId ||
      reference.snapshotId !== snapshot.id ||
      reference.snapshotSha256 !== snapshot.snapshotSha256)
  ) {
    return {
      kind: "stale",
      message:
        "The accepted brief references an older model snapshot. Reconcile and accept a fresh brief revision before generating options.",
    };
  }
  return { kind: "ready" };
}
