import { describe, expect, it } from "vitest";

import {
  designOptionLaunchContextSchema,
  designOptionsWorkspaceSchema,
  evidenceClassificationFromEnvironment,
} from "../../src/features/design-options/contracts";
import {
  designOptionLaunchContextFromSearchParams,
  designOptionLaunchHref,
} from "../../src/features/design-options/launch-context";
import { job, launchContext, ownerSession, project } from "./fixtures";

describe("C12 workspace contracts", () => {
  it("composes tenant-matched workspace dependencies and explicit evidence labels", () => {
    const parsed = designOptionsWorkspaceSchema.parse({
      evidenceClassification: "synthetic-fixture",
      jobs: { jobs: [job], projectId: project.id },
      project,
      session: ownerSession,
    });
    expect(parsed.jobs.jobs).toHaveLength(1);
    expect(evidenceClassificationFromEnvironment("synthetic-fixture")).toBe("synthetic-fixture");
    expect(evidenceClassificationFromEnvironment(undefined)).toBe("production-composed");
  });

  it("rejects a cross-project job aggregate", () => {
    const parsed = designOptionsWorkspaceSchema.safeParse({
      evidenceClassification: "production-composed",
      jobs: { jobs: [job], projectId: "c1200000-0000-4000-8000-000000000099" },
      project,
      session: ownerSession,
    });
    expect(parsed.success).toBe(false);
  });

  it("parses only complete exact launch pins and ignores forged browser authority", () => {
    const parsed = designOptionLaunchContextFromSearchParams({
      briefId: launchContext.baseBrief.briefId,
      briefRevision: String(launchContext.baseBrief.revision),
      briefSha256: launchContext.baseBrief.contentSha256,
      constraintsPassed: "true",
      directions: launchContext.requestedDirections.join(","),
      modelId: launchContext.sourceModel.modelId,
      modelProfile: launchContext.sourceModel.profile,
      optionCount: String(launchContext.requestedOptionCount),
      snapshotId: launchContext.sourceModel.snapshotId,
      snapshotSha256: launchContext.sourceModel.snapshotSha256,
      snapshotVersion: String(launchContext.sourceModel.snapshotVersion),
    });
    expect(parsed).toEqual(designOptionLaunchContextSchema.parse(launchContext));
    expect(
      designOptionLaunchContextFromSearchParams({
        briefId: launchContext.baseBrief.briefId,
        briefSha256: "not-a-hash",
      }),
    ).toBeUndefined();
  });

  it("round-trips an accepted brief and exact model into the launch URL", () => {
    const href = designOptionLaunchHref(
      project.id,
      designOptionLaunchContextSchema.parse(launchContext),
    );
    const parsedUrl = new URL(href, "https://interior-design.invalid");
    expect(parsedUrl.pathname).toBe(`/design-options/${project.id}`);
    expect(
      designOptionLaunchContextFromSearchParams(
        Object.fromEntries(parsedUrl.searchParams.entries()),
      ),
    ).toEqual(launchContext);
  });
});
