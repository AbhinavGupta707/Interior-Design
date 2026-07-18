import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { safeSpecificationLogFields } from "../../../services/platform-api/src/modules/specifications/telemetry.js";
import { mapSpecificationDatabaseError } from "../../../services/platform-api/src/modules/specifications/postgres.js";

const postgresSource = readFileSync(
  resolve(process.cwd(), "services/platform-api/src/modules/specifications/postgres.ts"),
  "utf8",
);
const routeSource = readFileSync(
  resolve(process.cwd(), "services/platform-api/src/modules/specifications/routes.ts"),
  "utf8",
);

describe("C13 specification security boundaries", () => {
  it("redacts catalog/source material and free-form decisions from telemetry", () => {
    expect(
      safeSpecificationLogFields({
        artifact: "private-object-key",
        artifactPath: "private-nested-object-key",
        licenceText: "private-licence",
        manifest: "private-hash",
        note: "private-review-note",
        noteText: "private-prefixed-review-note",
        operation: "private-model-operation",
        outcome: "conflict",
        payload: "private-payload",
        projectId: "synthetic-project",
        signedUrl: "https://invalid.example/private",
        signedUrlExpiresAt: "private-expiry",
        stage: "confirm",
      }),
    ).toEqual({ outcome: "conflict", projectId: "synthetic-project", stage: "confirm" });
  });

  it("collapses foreign-key failures without disclosing PostgreSQL detail", () => {
    const secret = "foreign tenant c1300000-0000-4000-8000-000000000999";
    expect(() => mapSpecificationDatabaseError({ code: "23503", detail: secret })).toThrowError(
      expect.objectContaining({
        code: "NOT_FOUND",
        statusCode: 404,
      }),
    );
    try {
      mapSpecificationDatabaseError({ code: "23503", detail: secret });
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain(secret);
    }
  });

  it("sets transaction-local tenant context before repository reads and locks in fixed order", () => {
    expect(postgresSource).toContain("set_config('app.tenant_id'");
    expect(postgresSource).not.toContain("SET app.tenant_id");
    const confirmation = postgresSource.slice(
      postgresSource.indexOf("confirmSubstitution(command"),
    );
    const projectLock = confirmation.indexOf("lockProject(");
    const specificationLock = confirmation.indexOf("FROM specifications");
    const substitutionLock = confirmation.indexOf("FROM specification_substitution_heads");
    const branchLock = confirmation.indexOf("FROM model_branches");
    expect(projectLock).toBeGreaterThan(-1);
    expect(specificationLock).toBeGreaterThan(projectLock);
    expect(substitutionLock).toBeGreaterThan(specificationLock);
    expect(branchLock).toBeGreaterThan(substitutionLock);
  });

  it("accepts only the frozen request schemas and does not accept caller-provided model pins", () => {
    expect(routeSource).toContain("createSpecificationRequestSchema.strict()");
    expect(routeSource).toContain("createSubstitutionPreviewRequestSchema.strict()");
    expect(routeSource).toContain("confirmSubstitutionRequestSchema.strict()");
    expect(routeSource).not.toMatch(/body\.(model|branch|snapshot|bundle|optionSet)/u);
    expect(routeSource).not.toMatch(/request\.url.*(model|branch|snapshot)/u);
  });
});
