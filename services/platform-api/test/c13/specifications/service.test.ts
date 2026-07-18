import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  actor,
  correlation,
  createSpecification,
  creationRequest,
  only,
  projectId,
  replacementAsset,
  required,
  seedReplacement,
  testRuntime,
} from "./support.js";

async function preview(runtime: Awaited<ReturnType<typeof createSpecification>>) {
  const asset = seedReplacement(runtime);
  const revision = runtime.specification.currentRevision;
  return runtime.service.createPreview({
    actor,
    correlation,
    idempotencyKey: randomUUID(),
    projectId,
    request: {
      elementId: only(revision.lines).elementId,
      expectedBranchRevision: revision.branchRevision,
      expectedSpecificationRevision: revision.revision,
      replacementAssetVersionId: asset.versionId,
    },
    specificationId: runtime.specification.specificationId,
  });
}

describe("C13 specification service", () => {
  it("creates only from the authoritative C12 join and replays the exact result", async () => {
    const runtime = testRuntime();
    const key = randomUUID();
    const command = {
      actor,
      correlation,
      idempotencyKey: key,
      projectId,
      request: creationRequest,
    };
    const first = await runtime.service.create(command);
    const replay = await runtime.service.create(command);
    expect(replay).toEqual({ replayed: true, specification: first.specification });
    await expect(
      runtime.service.create({
        ...command,
        request: { ...creationRequest, catalogReleaseSha256: "0".repeat(64) },
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("creates immutable selection-board revisions and rejects stale updates", async () => {
    const runtime = await createSpecification();
    const line = only(runtime.specification.currentRevision.lines);
    const result = await runtime.service.updateSelectionBoard({
      actor,
      correlation,
      idempotencyKey: randomUUID(),
      projectId,
      request: {
        entries: [
          {
            assetVersionId: line.assetVersionId,
            elementId: line.elementId,
            note: "Synthetic note",
            state: "shortlisted",
          },
        ],
        expectedRevision: 1,
      },
      specificationId: runtime.specification.specificationId,
    });
    expect(result.specification.currentRevision).toMatchObject({ revision: 2 });
    expect(
      await runtime.service.revisions(
        actor.tenantId,
        projectId,
        runtime.specification.specificationId,
      ),
    ).toHaveLength(2);
    await expect(
      runtime.service.updateSelectionBoard({
        actor,
        correlation,
        idempotencyKey: randomUUID(),
        projectId,
        request: { entries: [], expectedRevision: 1 },
        specificationId: runtime.specification.specificationId,
      }),
    ).rejects.toMatchObject({ code: "SPECIFICATION_REVISION_CONFLICT" });
  });

  it("atomically commits C5/specification, then requests C10 and exposes exact scene bindings", async () => {
    const runtime = await createSpecification();
    const proposed = await preview(runtime);
    const result = await runtime.service.confirm({
      actor,
      correlation,
      idempotencyKey: randomUUID(),
      projectId,
      request: {
        expectedCandidateSnapshotSha256: proposed.preview.candidateSnapshotSha256,
        expectedSpecificationRevision: 1,
        previewId: proposed.preview.previewId,
      },
      specificationId: runtime.specification.specificationId,
    });
    expect(result).toMatchObject({ sceneState: "requested" });
    expect(runtime.sceneRequests).toHaveLength(1);
    const binding = await runtime.repository.resolveConfirmedSceneBinding(
      actor.tenantId,
      projectId,
      result.confirmation.sceneJobId,
    );
    expect(binding).toMatchObject({
      catalogReleaseSha256: creationRequest.catalogReleaseSha256,
      modelSnapshotSha256: result.confirmation.resultSnapshotSha256,
      specificationRevision: 2,
    });
    expect(binding?.lines[0]).toMatchObject({
      selectionSource: { kind: "confirmed-substitution" },
    });
  });

  it("keeps the committed model/specification when the post-commit scene request fails", async () => {
    const runtime = await createSpecification(testRuntime({ failScene: true }));
    const proposed = await preview(runtime);
    const result = await runtime.service.confirm({
      actor,
      correlation,
      idempotencyKey: randomUUID(),
      projectId,
      request: {
        expectedCandidateSnapshotSha256: proposed.preview.candidateSnapshotSha256,
        expectedSpecificationRevision: 1,
        previewId: proposed.preview.previewId,
      },
      specificationId: runtime.specification.specificationId,
    });
    expect(result.sceneState).toBe("retry-required");
    expect(
      (await runtime.service.get(actor.tenantId, projectId, runtime.specification.specificationId))
        .currentRevision.revision,
    ).toBe(2);
  });

  it("fences expiry, withdrawn rights, concurrency, changed-body replay and injected rollback", async () => {
    const expiredRuntime = await createSpecification();
    const expiring = await preview(expiredRuntime);
    expiredRuntime.clock.advance(3_600_001);
    await expect(
      expiredRuntime.service.confirm({
        actor,
        correlation,
        idempotencyKey: randomUUID(),
        projectId,
        request: {
          expectedCandidateSnapshotSha256: expiring.preview.candidateSnapshotSha256,
          expectedSpecificationRevision: 1,
          previewId: expiring.preview.previewId,
        },
        specificationId: expiredRuntime.specification.specificationId,
      }),
    ).rejects.toMatchObject({ code: "PREVIEW_EXPIRED" });

    const withdrawnRuntime = await createSpecification();
    seedReplacement(withdrawnRuntime, replacementAsset("withdrawn"));
    await expect(
      withdrawnRuntime.service.createPreview({
        actor,
        correlation,
        idempotencyKey: randomUUID(),
        projectId,
        request: {
          elementId: only(withdrawnRuntime.specification.currentRevision.lines).elementId,
          expectedBranchRevision: 1,
          expectedSpecificationRevision: 1,
          replacementAssetVersionId: replacementAsset("withdrawn").versionId,
        },
        specificationId: withdrawnRuntime.specification.specificationId,
      }),
    ).rejects.toMatchObject({ code: "CATALOG_BINDING_CHANGED" });

    const rollbackRuntime = await createSpecification();
    const rollbackPreview = await preview(rollbackRuntime);
    rollbackRuntime.repository.failureStage = "after-model";
    await expect(
      rollbackRuntime.service.confirm({
        actor,
        correlation,
        idempotencyKey: randomUUID(),
        projectId,
        request: {
          expectedCandidateSnapshotSha256: rollbackPreview.preview.candidateSnapshotSha256,
          expectedSpecificationRevision: 1,
          previewId: rollbackPreview.preview.previewId,
        },
        specificationId: rollbackRuntime.specification.specificationId,
      }),
    ).rejects.toThrow("Injected failure");
    expect(
      (
        await rollbackRuntime.service.get(
          actor.tenantId,
          projectId,
          rollbackRuntime.specification.specificationId,
        )
      ).currentRevision.revision,
    ).toBe(1);

    rollbackRuntime.repository.failureStage = undefined;
    const key = randomUUID();
    const request = {
      expectedCandidateSnapshotSha256: rollbackPreview.preview.candidateSnapshotSha256,
      expectedSpecificationRevision: 1,
      previewId: rollbackPreview.preview.previewId,
    };
    const first = await rollbackRuntime.service.confirm({
      actor,
      correlation,
      idempotencyKey: key,
      projectId,
      request,
      specificationId: rollbackRuntime.specification.specificationId,
    });
    expect(
      (
        await rollbackRuntime.service.confirm({
          actor,
          correlation,
          idempotencyKey: key,
          projectId,
          request,
          specificationId: rollbackRuntime.specification.specificationId,
        })
      ).confirmation,
    ).toEqual(first.confirmation);
    await expect(
      rollbackRuntime.service.confirm({
        actor,
        correlation,
        idempotencyKey: key,
        projectId,
        request: { ...request, expectedCandidateSnapshotSha256: "0".repeat(64) },
        specificationId: rollbackRuntime.specification.specificationId,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("revalidates authoritative pins and rights, and permits exactly one concurrent confirmation", async () => {
    const staleRuntime = await createSpecification();
    const staleAsset = seedReplacement(staleRuntime);
    const staleSourceKey = [
      actor.tenantId,
      projectId,
      staleRuntime.specification.specificationId,
      staleAsset.versionId,
    ].join(":");
    const staleSource = required(
      staleRuntime.repository.substitutionSources.get(staleSourceKey),
      "Synthetic stale source missing.",
    );
    staleRuntime.repository.substitutionSources.set(staleSourceKey, {
      ...staleSource,
      branchRevision: staleSource.branchRevision + 1,
    });
    await expect(
      staleRuntime.service.createPreview({
        actor,
        correlation,
        idempotencyKey: randomUUID(),
        projectId,
        request: {
          elementId: only(staleRuntime.specification.currentRevision.lines).elementId,
          expectedBranchRevision: staleRuntime.specification.currentRevision.branchRevision,
          expectedSpecificationRevision: staleRuntime.specification.currentRevision.revision,
          replacementAssetVersionId: staleAsset.versionId,
        },
        specificationId: staleRuntime.specification.specificationId,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_CHANGED" });

    const withdrawnRuntime = await createSpecification();
    const withdrawnPreview = await preview(withdrawnRuntime);
    const retained = required(
      withdrawnRuntime.repository.previews.get(
        [actor.tenantId, projectId, withdrawnPreview.preview.previewId].join(":"),
      ),
      "Synthetic retained preview missing.",
    );
    Reflect.set(retained.command.verified.asset, "lifecycle", "withdrawn");
    await expect(
      withdrawnRuntime.service.confirm({
        actor,
        correlation,
        idempotencyKey: randomUUID(),
        projectId,
        request: {
          expectedCandidateSnapshotSha256: withdrawnPreview.preview.candidateSnapshotSha256,
          expectedSpecificationRevision: 1,
          previewId: withdrawnPreview.preview.previewId,
        },
        specificationId: withdrawnRuntime.specification.specificationId,
      }),
    ).rejects.toMatchObject({ code: "CATALOG_BINDING_CHANGED" });

    const concurrentRuntime = await createSpecification();
    const concurrentPreview = await preview(concurrentRuntime);
    const request = {
      expectedCandidateSnapshotSha256: concurrentPreview.preview.candidateSnapshotSha256,
      expectedSpecificationRevision: 1,
      previewId: concurrentPreview.preview.previewId,
    };
    const settled = await Promise.allSettled([
      concurrentRuntime.service.confirm({
        actor,
        correlation,
        idempotencyKey: randomUUID(),
        projectId,
        request,
        specificationId: concurrentRuntime.specification.specificationId,
      }),
      concurrentRuntime.service.confirm({
        actor,
        correlation,
        idempotencyKey: randomUUID(),
        projectId,
        request,
        specificationId: concurrentRuntime.specification.specificationId,
      }),
    ]);
    expect(settled.map(({ status }) => status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(
      await concurrentRuntime.service.revisions(
        actor.tenantId,
        projectId,
        concurrentRuntime.specification.specificationId,
      ),
    ).toHaveLength(2);
  });
});
