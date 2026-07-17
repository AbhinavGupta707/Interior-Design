import {
  homeIntakeSchema,
  projectPropertySchema,
  propertyCandidateSchema,
  propertyDossierSchema,
  propertyResolutionResponseSchema,
  propertySourceRecordSchema,
  propertySourceSchema,
  type HomeIntake,
  type ProjectProperty,
  type PropertyAddress,
  type PropertyDossier,
  type PropertyResolutionResponse,
  type PropertySource,
  type PropertySourceRecord,
} from "@interior-design/contracts";
import type { PropertyAdapter } from "@interior-design/provider-adapters/property";
import { randomUUID } from "node:crypto";
import type { JSONValue, Sql, TransactionSql } from "postgres";

import type { RequestCorrelation } from "../../correlation.js";
import { ApiError } from "../../errors.js";
import { notFound } from "../identity/http.js";
import {
  buildPropertyDossier,
  parsePropertyAdapterDossierItems,
  type IntakeSnapshot,
} from "./dossier.js";
import { normalizedPropertyQuery, normalizedSha256 } from "./hash.js";
import {
  claimPropertyIdempotency,
  completePropertyIdempotency,
  type PropertyIdempotencyClaim,
} from "./idempotency.js";
import type {
  PropertyBackend,
  RefreshPropertyDossierCommand,
  ResolvePropertyCommand,
  SelectPropertyCommand,
} from "./types.js";

export type PropertyClock = () => Date;
export type PropertyUuidFactory = () => string;

interface CurrentPropertyRow {
  readonly address: unknown;
  readonly display_address: string;
  readonly dossier_seed: unknown;
  readonly identifiers: unknown;
  readonly jurisdiction: string;
  readonly location: unknown;
  readonly mode: string;
  readonly project_id: string;
  readonly property_id: string;
  readonly selected_at: Date | string;
  readonly source: unknown;
  readonly updated_at: Date | string;
  readonly version: number;
}

interface CandidateRow {
  readonly address: unknown;
  readonly display_address: string;
  readonly dossier_seed: unknown;
  readonly identifiers: unknown;
  readonly jurisdiction: string;
  readonly location: unknown;
  readonly normalized_payload_sha256: string;
  readonly source: unknown;
}

interface DossierVersionRow {
  readonly coverage_warnings: unknown;
  readonly generated_at: Date | string;
  readonly items: unknown;
  readonly version: number;
}

interface IntakeRow {
  readonly intake: unknown;
  readonly updated_at: Date | string;
  readonly version: number;
}

interface ProjectPropertyVersionRow {
  readonly updated_at: Date | string;
  readonly version: number;
}

interface SourceRecordRow {
  readonly fields: string[];
  readonly id: string;
  readonly normalized_payload_sha256: string;
  readonly project_id: string;
  readonly property_id: string;
  readonly source: unknown;
}

function isoTimestamp(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function json(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

function mapProjectProperty(row: CurrentPropertyRow): ProjectProperty {
  return projectPropertySchema.parse({
    address: row.address,
    displayAddress: row.display_address,
    identifiers: row.identifiers,
    interiorKnowledgeStatus: "unknown-without-evidence",
    jurisdiction: row.jurisdiction,
    location: row.location ?? undefined,
    mode: row.mode,
    projectId: row.project_id,
    propertyId: row.property_id,
    selectedAt: isoTimestamp(row.selected_at),
    source: row.source,
    updatedAt: isoTimestamp(row.updated_at),
    version: row.version,
  });
}

function mapSourceRecord(row: SourceRecordRow): PropertySourceRecord {
  return propertySourceRecordSchema.parse({
    fields: row.fields,
    id: row.id,
    normalizedPayloadSha256: row.normalized_payload_sha256,
    projectId: row.project_id,
    propertyId: row.property_id,
    source: row.source,
  });
}

function revisionConflict(resource: "dossier" | "property"): ApiError {
  return new ApiError({
    code: "REVISION_CONFLICT",
    detail: `The ${resource} changed; reload it and retry with the current version.`,
    statusCode: 409,
    title: "Revision Conflict",
  });
}

function displayAddress(address: PropertyAddress): string {
  return [address.line1, address.line2, address.locality, address.postcode]
    .filter((part): part is string => part !== undefined)
    .join(", ");
}

function manualSource(retrievedAt: string): PropertySource {
  return propertySourceSchema.parse({
    coverage: "unknown",
    dataset: "User-provided property identity",
    datasetVersion: "c3-manual-v1",
    licence: { id: "user-provided", title: "User-provided project data" },
    modelTrainingAllowed: false,
    participantSharingAllowed: true,
    providerId: "manual-entry",
    retrievedAt,
    serviceProcessingAllowed: true,
  });
}

function workflowSource(retrievedAt: string): PropertySource {
  return propertySourceSchema.parse({
    coverage: "partial",
    dataset: "Property selection workflow",
    datasetVersion: "c3-workflow-v1",
    licence: { id: "repository-workflow", title: "Repository workflow record" },
    modelTrainingAllowed: false,
    participantSharingAllowed: true,
    providerId: "property-workflow",
    retrievedAt,
    serviceProcessingAllowed: true,
  });
}

function intakeSource(row: IntakeRow): PropertySource {
  return propertySourceSchema.parse({
    coverage: "partial",
    dataset: "Project home intake",
    datasetVersion: `c1-intake-v${String(row.version)}`,
    licence: { id: "user-provided", title: "User-provided project data" },
    modelTrainingAllowed: false,
    participantSharingAllowed: true,
    providerId: "project-intake",
    retrievedAt: isoTimestamp(row.updated_at),
    serviceProcessingAllowed: true,
  });
}

async function lockProject(
  transaction: TransactionSql,
  tenantId: string,
  projectId: string,
): Promise<void> {
  const rows = await transaction<{ readonly id: string }[]>`
    SELECT id
    FROM projects
    WHERE tenant_id = ${tenantId}::uuid
      AND id = ${projectId}::uuid
    FOR UPDATE
  `;
  if (rows.length !== 1) {
    throw notFound();
  }
}

async function appendAudit(
  transaction: TransactionSql,
  uuid: PropertyUuidFactory,
  input: {
    readonly action: string;
    readonly actorUserId: string;
    readonly correlation: RequestCorrelation;
    readonly projectId: string;
    readonly propertyId?: string;
    readonly resourceId: string;
    readonly resourceType: "project-property" | "property-dossier" | "property-resolution";
    readonly tenantId: string;
  },
): Promise<void> {
  await transaction`
    INSERT INTO property_audit_events (
      id,
      tenant_id,
      project_id,
      property_id,
      actor_user_id,
      action,
      resource_type,
      resource_id,
      request_id,
      trace_id
    )
    VALUES (
      ${uuid()}::uuid,
      ${input.tenantId}::uuid,
      ${input.projectId}::uuid,
      ${input.propertyId ?? null}::uuid,
      ${input.actorUserId}::uuid,
      ${input.action},
      ${input.resourceType},
      ${input.resourceId}::uuid,
      ${input.correlation.requestId},
      ${input.correlation.traceId}
    )
  `;
}

async function ensureSourceRecord(
  transaction: TransactionSql,
  uuid: PropertyUuidFactory,
  input: {
    readonly fields: readonly string[];
    readonly normalizedPayloadSha256: string;
    readonly projectId: string;
    readonly propertyId: string;
    readonly source: PropertySource;
    readonly tenantId: string;
  },
): Promise<PropertySourceRecord> {
  const fields = [...new Set(input.fields)].sort();
  const sourceFingerprint = normalizedSha256({
    fields,
    normalizedPayloadSha256: input.normalizedPayloadSha256,
    source: input.source,
  });
  const sourceRecordId = uuid();
  const inserted = await transaction<SourceRecordRow[]>`
    INSERT INTO property_source_records (
      id,
      tenant_id,
      project_id,
      property_id,
      source,
      fields,
      normalized_payload_sha256,
      source_fingerprint
    )
    VALUES (
      ${sourceRecordId}::uuid,
      ${input.tenantId}::uuid,
      ${input.projectId}::uuid,
      ${input.propertyId}::uuid,
      ${transaction.json(json(input.source))},
      ${fields}::text[],
      ${input.normalizedPayloadSha256},
      ${sourceFingerprint}
    )
    ON CONFLICT (tenant_id, project_id, property_id, source_fingerprint) DO NOTHING
    RETURNING id, project_id, property_id, source, fields, normalized_payload_sha256
  `;
  const existing =
    inserted[0] ??
    (
      await transaction<SourceRecordRow[]>`
        SELECT id, project_id, property_id, source, fields, normalized_payload_sha256
        FROM property_source_records
        WHERE tenant_id = ${input.tenantId}::uuid
          AND project_id = ${input.projectId}::uuid
          AND property_id = ${input.propertyId}::uuid
          AND source_fingerprint = ${sourceFingerprint}
        LIMIT 1
      `
    )[0];
  if (existing === undefined) {
    throw new Error("Property source record insert returned no row.");
  }
  return mapSourceRecord(existing);
}

async function loadIntakeSnapshot(
  transaction: TransactionSql,
  uuid: PropertyUuidFactory,
  input: {
    readonly projectId: string;
    readonly propertyId: string;
    readonly tenantId: string;
  },
): Promise<IntakeSnapshot | undefined> {
  const rows = await transaction<IntakeRow[]>`
    SELECT intake, version, updated_at
    FROM project_intakes
    WHERE tenant_id = ${input.tenantId}::uuid
      AND project_id = ${input.projectId}::uuid
    LIMIT 1
  `;
  const row = rows[0];
  if (row === undefined) {
    return undefined;
  }
  const intake: HomeIntake = homeIntakeSchema.parse(row.intake);
  const fields = [
    "project-intake",
    "intake-dwelling-type",
    ...(intake.bedrooms === undefined ? [] : ["intake-bedrooms"]),
    ...(intake.bathrooms === undefined ? [] : ["intake-bathrooms"]),
    ...(intake.levels === undefined ? [] : ["intake-levels"]),
  ];
  const sourceRecord = await ensureSourceRecord(transaction, uuid, {
    fields,
    normalizedPayloadSha256: normalizedSha256(intake),
    projectId: input.projectId,
    propertyId: input.propertyId,
    source: intakeSource(row),
    tenantId: input.tenantId,
  });
  return { intake, sourceRecord };
}

async function persistDossier(
  transaction: TransactionSql,
  actorUserId: string,
  tenantId: string,
  dossier: PropertyDossier,
): Promise<void> {
  await transaction`
    INSERT INTO property_dossier_versions (
      tenant_id,
      project_id,
      property_id,
      version,
      generated_at,
      planning_status,
      interior_knowledge_status,
      coverage_warnings,
      items,
      generated_by
    )
    VALUES (
      ${tenantId}::uuid,
      ${dossier.property.projectId}::uuid,
      ${dossier.property.propertyId}::uuid,
      ${dossier.version},
      ${dossier.generatedAt}::timestamptz,
      ${dossier.planningStatus},
      ${dossier.interiorKnowledgeStatus},
      ${transaction.json(json(dossier.coverageWarnings))},
      ${transaction.json(json(dossier.items))},
      ${actorUserId}::uuid
    )
  `;
  for (const source of dossier.sources) {
    await transaction`
      INSERT INTO property_dossier_version_sources (
        tenant_id,
        project_id,
        property_id,
        dossier_version,
        source_record_id
      )
      VALUES (
        ${tenantId}::uuid,
        ${dossier.property.projectId}::uuid,
        ${dossier.property.propertyId}::uuid,
        ${dossier.version},
        ${source.id}::uuid
      )
    `;
  }
}

export class PostgresPropertyBackend implements PropertyBackend {
  readonly #adapter: PropertyAdapter;
  readonly #clock: PropertyClock;
  readonly #sql: Sql;
  readonly #uuid: PropertyUuidFactory;

  constructor(
    sql: Sql,
    adapter: PropertyAdapter,
    options: { readonly clock?: PropertyClock; readonly uuid?: PropertyUuidFactory } = {},
  ) {
    this.#adapter = adapter;
    this.#clock = options.clock ?? (() => new Date());
    this.#sql = sql;
    this.#uuid = options.uuid ?? randomUUID;
  }

  async resolve(command: ResolvePropertyCommand): Promise<PropertyResolutionResponse> {
    const adapterResolution = await this.#adapter.resolve(command.request);
    const createdAt = this.#clock();
    const resolutionId = this.#uuid();
    const candidates = adapterResolution.candidates.map((candidate) => {
      const candidateId = this.#uuid();
      const dossierItems = parsePropertyAdapterDossierItems(candidate.dossierItems);
      return {
        dossierItems,
        normalizedPayloadSha256: normalizedSha256({ ...candidate, dossierItems }),
        publicCandidate: propertyCandidateSchema.parse({
          address: candidate.address,
          candidateId,
          displayAddress: candidate.displayAddress,
          identifiers: candidate.identifiers,
          jurisdiction: candidate.jurisdiction,
          location: candidate.location,
          source: candidate.source,
        }),
      };
    });
    const response = propertyResolutionResponseSchema.parse({
      candidates: candidates.map((candidate) => candidate.publicCandidate),
      expiresAt: new Date(createdAt.getTime() + 15 * 60 * 1000).toISOString(),
      manualEntryAllowed: true,
      providerState: adapterResolution.providerState,
      resolutionId,
      status: adapterResolution.status,
    });

    return this.#sql.begin(async (transaction) => {
      await lockProject(transaction, command.actor.tenantId, command.projectId);
      const claim: PropertyIdempotencyClaim = {
        actorUserId: command.actor.userId,
        idempotencyKey: command.idempotencyKey,
        operation: `property.resolve:${command.projectId}`,
        projectId: command.projectId,
        requestBody: command.request,
        tenantId: command.actor.tenantId,
      };
      const idempotency = await claimPropertyIdempotency(transaction, claim);
      if (idempotency.kind === "replay") {
        return propertyResolutionResponseSchema.parse(idempotency.body);
      }

      await transaction`
        INSERT INTO property_resolution_snapshots (
          id,
          tenant_id,
          project_id,
          actor_user_id,
          query_sha256,
          status,
          provider_state,
          candidate_count,
          created_at,
          expires_at
        )
        VALUES (
          ${resolutionId}::uuid,
          ${command.actor.tenantId}::uuid,
          ${command.projectId}::uuid,
          ${command.actor.userId}::uuid,
          ${normalizedSha256(normalizedPropertyQuery(command.request.query))},
          ${response.status},
          ${response.providerState},
          ${response.candidates.length},
          ${createdAt.toISOString()}::timestamptz,
          ${response.expiresAt}::timestamptz
        )
      `;
      for (const candidate of candidates) {
        await transaction`
          INSERT INTO property_resolution_candidates (
            tenant_id,
            project_id,
            resolution_id,
            candidate_id,
            address,
            display_address,
            identifiers,
            jurisdiction,
            location,
            source,
            dossier_seed,
            normalized_payload_sha256
          )
          VALUES (
            ${command.actor.tenantId}::uuid,
            ${command.projectId}::uuid,
            ${resolutionId}::uuid,
            ${candidate.publicCandidate.candidateId}::uuid,
            ${transaction.json(json(candidate.publicCandidate.address))},
            ${candidate.publicCandidate.displayAddress},
            ${transaction.json(json(candidate.publicCandidate.identifiers))},
            ${candidate.publicCandidate.jurisdiction},
            ${
              candidate.publicCandidate.location === undefined
                ? null
                : transaction.json(json(candidate.publicCandidate.location))
            },
            ${transaction.json(json(candidate.publicCandidate.source))},
            ${transaction.json(json(candidate.dossierItems))},
            ${candidate.normalizedPayloadSha256}
          )
        `;
      }
      await appendAudit(transaction, this.#uuid, {
        action: "property.resolve",
        actorUserId: command.actor.userId,
        correlation: command.correlation,
        projectId: command.projectId,
        resourceId: resolutionId,
        resourceType: "property-resolution",
        tenantId: command.actor.tenantId,
      });
      await completePropertyIdempotency(transaction, claim, 201, response);
      return response;
    });
  }

  async select(command: SelectPropertyCommand): Promise<ProjectProperty> {
    return this.#sql.begin(async (transaction) => {
      await lockProject(transaction, command.actor.tenantId, command.projectId);
      const claim: PropertyIdempotencyClaim = {
        actorUserId: command.actor.userId,
        idempotencyKey: command.idempotencyKey,
        operation: `property.select:${command.projectId}`,
        projectId: command.projectId,
        requestBody: command.request,
        tenantId: command.actor.tenantId,
      };
      const idempotency = await claimPropertyIdempotency(transaction, claim);
      if (idempotency.kind === "replay") {
        return projectPropertySchema.parse(idempotency.body);
      }

      const currentRows = await transaction<ProjectPropertyVersionRow[]>`
        SELECT version, updated_at
        FROM project_properties
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid
        FOR UPDATE
      `;
      const current = currentRows[0];
      if ((current?.version ?? 0) !== command.request.expectedVersion) {
        throw revisionConflict("property");
      }
      const selectedAt = this.#clock().toISOString();

      let candidate: CandidateRow;
      let mode: "candidate" | "manual";
      if (command.request.mode === "candidate") {
        const candidateRows = await transaction<CandidateRow[]>`
          SELECT
            c.address,
            c.display_address,
            c.identifiers,
            c.jurisdiction,
            c.location,
            c.source,
            c.dossier_seed,
            c.normalized_payload_sha256
          FROM property_resolution_snapshots r
          JOIN property_resolution_candidates c
            ON c.tenant_id = r.tenant_id
           AND c.project_id = r.project_id
           AND c.resolution_id = r.id
          WHERE r.tenant_id = ${command.actor.tenantId}::uuid
            AND r.project_id = ${command.projectId}::uuid
            AND r.id = ${command.request.resolutionId}::uuid
            AND c.candidate_id = ${command.request.candidateId}::uuid
            AND r.expires_at > ${selectedAt}::timestamptz
            AND NOT EXISTS (
              SELECT 1
              FROM property_resolution_consumptions used
              WHERE used.tenant_id = r.tenant_id
                AND used.project_id = r.project_id
                AND used.resolution_id = r.id
            )
          FOR UPDATE OF r, c
        `;
        const storedCandidate = candidateRows[0];
        if (storedCandidate === undefined) {
          throw notFound();
        }
        candidate = storedCandidate;
        mode = "candidate";
      } else {
        const source = manualSource(selectedAt);
        candidate = {
          address: command.request.address,
          display_address: displayAddress(command.request.address),
          dossier_seed: [],
          identifiers: [],
          jurisdiction: command.request.jurisdiction,
          location: null,
          normalized_payload_sha256: normalizedSha256({
            address: command.request.address,
            identifiers: [],
            jurisdiction: command.request.jurisdiction,
            location: null,
          }),
          source,
        };
        mode = "manual";
      }

      const source = propertySourceSchema.parse(candidate.source);
      const dossierSeed = parsePropertyAdapterDossierItems(candidate.dossier_seed);
      const propertyId = this.#uuid();
      await transaction`
        INSERT INTO property_identities (
          id,
          tenant_id,
          project_id,
          mode,
          address,
          display_address,
          identifiers,
          jurisdiction,
          location,
          source,
          dossier_seed,
          selected_at,
          selected_by
        )
        VALUES (
          ${propertyId}::uuid,
          ${command.actor.tenantId}::uuid,
          ${command.projectId}::uuid,
          ${mode},
          ${transaction.json(json(candidate.address))},
          ${candidate.display_address},
          ${transaction.json(json(candidate.identifiers))},
          ${candidate.jurisdiction},
          ${candidate.location === null ? null : transaction.json(json(candidate.location))},
          ${transaction.json(json(source))},
          ${transaction.json(json(dossierSeed))},
          ${selectedAt}::timestamptz,
          ${command.actor.userId}::uuid
        )
      `;

      if (command.request.mode === "candidate") {
        await transaction`
          INSERT INTO property_resolution_consumptions (
            tenant_id,
            project_id,
            resolution_id,
            candidate_id,
            property_id,
            consumed_at,
            consumed_by
          )
          VALUES (
            ${command.actor.tenantId}::uuid,
            ${command.projectId}::uuid,
            ${command.request.resolutionId}::uuid,
            ${command.request.candidateId}::uuid,
            ${propertyId}::uuid,
            ${selectedAt}::timestamptz,
            ${command.actor.userId}::uuid
          )
        `;
      }

      let selectionRows: readonly ProjectPropertyVersionRow[];
      if (current === undefined) {
        selectionRows = await transaction<ProjectPropertyVersionRow[]>`
          INSERT INTO project_properties (
            tenant_id,
            project_id,
            property_id,
            version,
            selected_at,
            updated_at,
            updated_by
          )
          VALUES (
            ${command.actor.tenantId}::uuid,
            ${command.projectId}::uuid,
            ${propertyId}::uuid,
            1,
            ${selectedAt}::timestamptz,
            ${selectedAt}::timestamptz,
            ${command.actor.userId}::uuid
          )
          RETURNING version, updated_at
        `;
      } else {
        selectionRows = await transaction<ProjectPropertyVersionRow[]>`
          UPDATE project_properties
          SET property_id = ${propertyId}::uuid,
              version = version + 1,
              selected_at = ${selectedAt}::timestamptz,
              updated_at = ${selectedAt}::timestamptz,
              updated_by = ${command.actor.userId}::uuid
          WHERE tenant_id = ${command.actor.tenantId}::uuid
            AND project_id = ${command.projectId}::uuid
            AND version = ${command.request.expectedVersion}
          RETURNING version, updated_at
        `;
      }
      const selection = selectionRows[0];
      if (selection === undefined) {
        throw revisionConflict("property");
      }
      const property = projectPropertySchema.parse({
        address: candidate.address,
        displayAddress: candidate.display_address,
        identifiers: candidate.identifiers,
        interiorKnowledgeStatus: "unknown-without-evidence",
        jurisdiction: candidate.jurisdiction,
        location: candidate.location ?? undefined,
        mode,
        projectId: command.projectId,
        propertyId,
        selectedAt,
        source,
        updatedAt: isoTimestamp(selection.updated_at),
        version: selection.version,
      });

      const identitySource = await ensureSourceRecord(transaction, this.#uuid, {
        fields: [
          "property-identity",
          ...(property.identifiers.length === 0 ? [] : ["uprn"]),
          ...(property.location === undefined ? [] : ["location"]),
          ...dossierSeed.map((item) => item.key),
        ],
        normalizedPayloadSha256: candidate.normalized_payload_sha256,
        projectId: command.projectId,
        propertyId,
        source,
        tenantId: command.actor.tenantId,
      });
      const workflow = workflowSource(selectedAt);
      const workflowRecord = await ensureSourceRecord(transaction, this.#uuid, {
        fields: [
          "selection-mode",
          "selected-for-project",
          "context-coverage-estimate",
          "interior-evidence-required",
        ],
        normalizedPayloadSha256: normalizedSha256({ mode, selectedForProject: true }),
        projectId: command.projectId,
        propertyId,
        source: workflow,
        tenantId: command.actor.tenantId,
      });
      const intake = await loadIntakeSnapshot(transaction, this.#uuid, {
        projectId: command.projectId,
        propertyId,
        tenantId: command.actor.tenantId,
      });
      const dossier = buildPropertyDossier({
        adapterItems: dossierSeed,
        generatedAt: selectedAt,
        identitySource,
        ...(intake === undefined ? {} : { intake }),
        property,
        version: 1,
        workflowSource: workflowRecord,
      });
      await persistDossier(transaction, command.actor.userId, command.actor.tenantId, dossier);
      await appendAudit(transaction, this.#uuid, {
        action: "property.select",
        actorUserId: command.actor.userId,
        correlation: command.correlation,
        projectId: command.projectId,
        propertyId,
        resourceId: propertyId,
        resourceType: "project-property",
        tenantId: command.actor.tenantId,
      });
      await completePropertyIdempotency(transaction, claim, 200, property);
      return property;
    });
  }

  async getDossier(tenantId: string, projectId: string): Promise<PropertyDossier | undefined> {
    const propertyRows = await this.#sql<CurrentPropertyRow[]>`
      SELECT
        p.project_id,
        p.property_id,
        p.version,
        p.selected_at,
        p.updated_at,
        i.mode,
        i.address,
        i.display_address,
        i.identifiers,
        i.jurisdiction,
        i.location,
        i.source,
        i.dossier_seed
      FROM project_properties p
      JOIN property_identities i
        ON i.tenant_id = p.tenant_id
       AND i.project_id = p.project_id
       AND i.id = p.property_id
      WHERE p.tenant_id = ${tenantId}::uuid
        AND p.project_id = ${projectId}::uuid
      LIMIT 1
    `;
    const propertyRow = propertyRows[0];
    if (propertyRow === undefined) {
      return undefined;
    }
    const property = mapProjectProperty(propertyRow);
    const dossierRows = await this.#sql<DossierVersionRow[]>`
      SELECT version, generated_at, coverage_warnings, items
      FROM property_dossier_versions
      WHERE tenant_id = ${tenantId}::uuid
        AND project_id = ${projectId}::uuid
        AND property_id = ${property.propertyId}::uuid
      ORDER BY version DESC
      LIMIT 1
    `;
    const dossier = dossierRows[0];
    if (dossier === undefined) {
      return undefined;
    }
    const sourceRows = await this.#sql<SourceRecordRow[]>`
      SELECT s.id, s.project_id, s.property_id, s.source, s.fields,
             s.normalized_payload_sha256
      FROM property_dossier_version_sources linked
      JOIN property_source_records s
        ON s.tenant_id = linked.tenant_id
       AND s.project_id = linked.project_id
       AND s.property_id = linked.property_id
       AND s.id = linked.source_record_id
      WHERE linked.tenant_id = ${tenantId}::uuid
        AND linked.project_id = ${projectId}::uuid
        AND linked.property_id = ${property.propertyId}::uuid
        AND linked.dossier_version = ${dossier.version}
      ORDER BY s.id ASC
    `;
    return propertyDossierSchema.parse({
      coverageWarnings: dossier.coverage_warnings,
      generatedAt: isoTimestamp(dossier.generated_at),
      interiorKnowledgeStatus: "unknown-without-evidence",
      items: dossier.items,
      planningStatus: "not-reviewed",
      property,
      sources: sourceRows.map((row) => mapSourceRecord(row)),
      version: dossier.version,
    });
  }

  async listSourceRecords(
    tenantId: string,
    projectId: string,
  ): Promise<readonly PropertySourceRecord[] | undefined> {
    const propertyRows = await this.#sql<{ readonly property_id: string }[]>`
      SELECT property_id
      FROM project_properties
      WHERE tenant_id = ${tenantId}::uuid
        AND project_id = ${projectId}::uuid
      LIMIT 1
    `;
    const propertyId = propertyRows[0]?.property_id;
    if (propertyId === undefined) {
      return undefined;
    }
    const rows = await this.#sql<SourceRecordRow[]>`
      SELECT id, project_id, property_id, source, fields, normalized_payload_sha256
      FROM (
        SELECT id, project_id, property_id, source, fields, normalized_payload_sha256,
               created_at
        FROM property_source_records
        WHERE tenant_id = ${tenantId}::uuid
          AND project_id = ${projectId}::uuid
          AND property_id = ${propertyId}::uuid
        ORDER BY created_at DESC, id DESC
        LIMIT 50
      ) recent
      ORDER BY created_at ASC, id ASC
    `;
    return rows.map((row) => mapSourceRecord(row));
  }

  async refreshDossier(command: RefreshPropertyDossierCommand): Promise<PropertyDossier> {
    return this.#sql.begin(async (transaction) => {
      await lockProject(transaction, command.actor.tenantId, command.projectId);
      const claim: PropertyIdempotencyClaim = {
        actorUserId: command.actor.userId,
        idempotencyKey: command.idempotencyKey,
        operation: `property.dossier.refresh:${command.projectId}`,
        projectId: command.projectId,
        requestBody: command.request,
        tenantId: command.actor.tenantId,
      };
      const idempotency = await claimPropertyIdempotency(transaction, claim);
      if (idempotency.kind === "replay") {
        return propertyDossierSchema.parse(idempotency.body);
      }

      const propertyRows = await transaction<CurrentPropertyRow[]>`
        SELECT
          p.project_id,
          p.property_id,
          p.version,
          p.selected_at,
          p.updated_at,
          i.mode,
          i.address,
          i.display_address,
          i.identifiers,
          i.jurisdiction,
          i.location,
          i.source,
          i.dossier_seed
        FROM project_properties p
        JOIN property_identities i
          ON i.tenant_id = p.tenant_id
         AND i.project_id = p.project_id
         AND i.id = p.property_id
        WHERE p.tenant_id = ${command.actor.tenantId}::uuid
          AND p.project_id = ${command.projectId}::uuid
        FOR UPDATE OF p
      `;
      const propertyRow = propertyRows[0];
      if (propertyRow === undefined) {
        throw notFound();
      }
      const property = mapProjectProperty(propertyRow);
      const dossierRows = await transaction<{ readonly version: number }[]>`
        SELECT version
        FROM property_dossier_versions
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid
          AND property_id = ${property.propertyId}::uuid
        ORDER BY version DESC
        LIMIT 1
      `;
      const currentVersion = dossierRows[0]?.version ?? 0;
      if (currentVersion !== command.request.expectedVersion) {
        throw revisionConflict("dossier");
      }
      const generatedAt = this.#clock().toISOString();

      const sourceRows = await transaction<SourceRecordRow[]>`
        SELECT id, project_id, property_id, source, fields, normalized_payload_sha256
        FROM property_source_records
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid
          AND property_id = ${property.propertyId}::uuid
        ORDER BY created_at ASC, id ASC
      `;
      const sources = sourceRows.map((row) => mapSourceRecord(row));
      const identitySource = sources.find((source) => source.fields.includes("property-identity"));
      const workflow = sources.find((source) => source.fields.includes("selection-mode"));
      if (identitySource === undefined || workflow === undefined) {
        throw new Error("The selected property is missing required immutable source records.");
      }
      const intake = await loadIntakeSnapshot(transaction, this.#uuid, {
        projectId: command.projectId,
        propertyId: property.propertyId,
        tenantId: command.actor.tenantId,
      });
      const dossier = buildPropertyDossier({
        adapterItems: parsePropertyAdapterDossierItems(propertyRow.dossier_seed),
        generatedAt,
        identitySource,
        ...(intake === undefined ? {} : { intake }),
        property,
        version: currentVersion + 1,
        workflowSource: workflow,
      });
      await persistDossier(transaction, command.actor.userId, command.actor.tenantId, dossier);
      await appendAudit(transaction, this.#uuid, {
        action: "property.dossier.refresh",
        actorUserId: command.actor.userId,
        correlation: command.correlation,
        projectId: command.projectId,
        propertyId: property.propertyId,
        resourceId: property.propertyId,
        resourceType: "property-dossier",
        tenantId: command.actor.tenantId,
      });
      await completePropertyIdempotency(transaction, claim, 200, dossier);
      return dossier;
    });
  }
}
