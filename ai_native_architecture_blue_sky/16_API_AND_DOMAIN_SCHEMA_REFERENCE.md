---
title: API and Domain Schema Reference
document_type: technical_contract
status: proposed_not_final
as_of: 2026-07-16
api_version: v1
---

# 16 — API and Domain Schema Reference

## 1. Scope

This document proposes application-facing contracts and domain schemas for the first platform stages. It is not a complete OpenAPI specification. Implementation should convert these concepts into versioned machine-readable schemas and architecture decision records.

## 2. API conventions

### Base

```text
https://api.example.com/v1
```

### Authentication

- OAuth 2.1/OIDC bearer token;
- short-lived access token;
- service-to-service identity for workers;
- project-scoped authorisation checked server-side.

### Headers

```http
Authorization: Bearer <token>
Content-Type: application/json
Idempotency-Key: <uuid>            # required for retryable creates/mutations
If-Match: "<version-etag>"        # required for concurrent model mutation
X-Correlation-Id: <uuid>           # accepted or generated
```

### Time

- ISO 8601 UTC timestamps;
- local timezone stored separately for project/site scheduling.

### Units

- canonical length: millimetres as integer where practical;
- canonical area: square millimetres or derived square metres with explicit unit;
- angles: degrees or radians explicitly named;
- coordinates: explicit CRS;
- money: integer minor units plus ISO 4217 currency.

### IDs

Opaque, stable identifiers with prefixes:

- `usr_`
- `org_`
- `prj_`
- `prop_`
- `asset_`
- `evid_`
- `mdl_`
- `mv_`
- `elem_`
- `op_`
- `review_`
- `job_`
- `estimate_`

Do not encode business meaning that may change into IDs.

### Errors

Use `application/problem+json`:

```json
{
  "type": "https://api.example.com/problems/model-version-conflict",
  "title": "Model version conflict",
  "status": 409,
  "code": "MODEL_VERSION_CONFLICT",
  "detail": "The model changed after the version you edited.",
  "correlation_id": "9ff5...",
  "conflict": {
    "expected_version_id": "mv_101",
    "current_version_id": "mv_103"
  }
}
```

## 3. Core identity entities

### User

```json
{
  "id": "usr_01J...",
  "display_name": "Alex Example",
  "email": "alex@example.com",
  "status": "active",
  "created_at": "2026-07-16T10:00:00Z"
}
```

### Organisation

```json
{
  "id": "org_arch_01J...",
  "name": "Example Architecture Practice Ltd",
  "type": "architecture_practice",
  "jurisdictions": ["england", "wales"],
  "professional_attributes": {
    "arb_business_name_status": "not_recorded",
    "pii_status": "verification_required"
  }
}
```

### Membership and project role

```json
{
  "user_id": "usr_01J...",
  "organisation_id": "org_arch_01J...",
  "project_id": "prj_01J...",
  "roles": ["architect_reviewer"],
  "permissions": [
    "model.read",
    "review.create",
    "review.complete"
  ]
}
```

## 4. Project and property

### Project

```json
{
  "id": "prj_01J...",
  "name": "Example Road Renovation",
  "status": "existing_model_in_progress",
  "jurisdiction": "england",
  "property_id": "prop_01J...",
  "owner_organisation_id": "org_home_01J...",
  "current_stage": "capture",
  "created_at": "2026-07-16T10:00:00Z"
}
```

### Property

```json
{
  "id": "prop_01J...",
  "jurisdiction": "england",
  "identifiers": [
    {
      "scheme": "UPRN",
      "value": "100000000000",
      "source": "os_places",
      "match_confidence": 0.98
    }
  ],
  "addresses": [
    {
      "display": "10 Example Road, London, AB1 2CD",
      "status": "current",
      "source": "os_places",
      "retrieved_at": "2026-07-16T10:01:00Z"
    }
  ],
  "location": {
    "crs": "EPSG:27700",
    "coordinates": [530000.0, 180000.0]
  },
  "interior_knowledge_status": "unknown"
}
```

## 5. Source and licence entity

```json
{
  "id": "source_os_ngd_buildings_2026_07",
  "provider": "Ordnance Survey",
  "dataset": "OS NGD Buildings",
  "dataset_version": "recorded-by-adapter",
  "licence_id": "licence_internal_reference",
  "retrieved_at": "2026-07-16T10:02:00Z",
  "quality_flags": ["provider_known_limitations_apply"],
  "permitted_uses": ["service_processing", "customer_visualisation"],
  "training_allowed": false
}
```

## 6. Asset and rights schema

### Asset

```json
{
  "id": "asset_01J...",
  "project_id": "prj_01J...",
  "kind": "floor_plan_pdf",
  "filename": "ground-floor-plan.pdf",
  "media_type": "application/pdf",
  "size_bytes": 1240000,
  "sha256": "...",
  "storage_status": "available",
  "source_type": "user_upload",
  "created_by": "usr_01J...",
  "created_at": "2026-07-16T10:03:00Z",
  "rights_id": "rights_01J...",
  "derives_from_asset_ids": []
}
```

### Rights declaration

```json
{
  "id": "rights_01J...",
  "asset_id": "asset_01J...",
  "declarant_user_id": "usr_01J...",
  "claimed_basis": "owner_or_authorised_user",
  "service_processing_allowed": true,
  "project_participant_sharing_allowed": true,
  "model_training_allowed": false,
  "commercial_derivatives_allowed": false,
  "retention_policy": "project_plus_legal_retention",
  "declared_at": "2026-07-16T10:03:00Z"
}
```

The service-processing and model-training permissions must remain separate.

## 7. Evidence schema

Evidence connects an asset or observation to one or more attributes.

```json
{
  "id": "evid_01J...",
  "project_id": "prj_01J...",
  "type": "dimension_measurement",
  "source_asset_id": null,
  "method": "user_laser_measure",
  "observed_at": "2026-07-16T10:10:00Z",
  "created_by": "usr_01J...",
  "value": {
    "quantity": 3620,
    "unit": "mm",
    "declared_tolerance": 10
  },
  "location_reference": {
    "model_element_id": "elem_wall_01J...",
    "attribute_path": "geometry.length_mm"
  },
  "provenance_state": "OBSERVED",
  "verification_status": "not_reviewed"
}
```

## 8. Canonical model envelope

```json
{
  "id": "mdl_01J...",
  "project_id": "prj_01J...",
  "property_id": "prop_01J...",
  "purpose": "residential_existing_and_design",
  "current_version_id": "mv_01J...",
  "coordinate_system": {
    "type": "local_cartesian",
    "length_unit": "mm",
    "origin_reference": "property_local_origin",
    "global_transform": {
      "crs": "EPSG:27700",
      "matrix": [1, 0, 0, 0, 1, 0, 530000, 180000, 0]
    }
  }
}
```

## 9. Model version

```json
{
  "id": "mv_01J...",
  "model_id": "mdl_01J...",
  "parent_version_ids": ["mv_parent_01J..."],
  "branch": "existing-model",
  "version_type": "existing_capture",
  "sequence": 7,
  "status": "committed",
  "purpose_status": {
    "concept_design": "suitable_with_limitations",
    "planning": "not_reviewed",
    "technical_design": "not_suitable",
    "construction": "not_suitable"
  },
  "operation_ids": ["op_01", "op_02"],
  "snapshot_asset_id": "asset_snapshot_01J...",
  "created_by": "usr_01J...",
  "created_at": "2026-07-16T10:30:00Z"
}
```

## 10. Element common schema

```json
{
  "id": "elem_wall_01J...",
  "model_version_id": "mv_01J...",
  "element_type": "wall",
  "lifecycle_state": "existing",
  "name": "Rear kitchen wall",
  "level_id": "elem_level_ground",
  "geometry": {},
  "attributes": {},
  "evidence_links": [],
  "review_status": "not_reviewed",
  "created_by_operation_id": "op_01J..."
}
```

## 11. Attribute with provenance

Use a reusable value wrapper:

```json
{
  "value": 3000,
  "unit": "mm",
  "state": "USER_PROVIDED",
  "confidence": 0.85,
  "evidence_ids": ["evid_01J..."],
  "declared_tolerance": 10,
  "conflict_status": "none",
  "verification": {
    "status": "not_reviewed",
    "purpose": null,
    "review_id": null
  }
}
```

Do not require confidence for every authoritative fact if it would be meaningless; provenance and source-quality information may be more appropriate.

## 12. Level

```json
{
  "id": "elem_level_ground",
  "element_type": "level",
  "lifecycle_state": "existing",
  "name": "Ground floor",
  "elevation_mm": {
    "value": 0,
    "unit": "mm",
    "state": "PROPOSED",
    "confidence": 1.0
  }
}
```

The local origin/elevation may be a modelling convention rather than a physical survey datum. Label accordingly.

## 13. Wall

```json
{
  "id": "elem_wall_01J...",
  "element_type": "wall",
  "lifecycle_state": "existing",
  "level_id": "elem_level_ground",
  "geometry": {
    "representation": "path_extrusion",
    "path": [
      {"x_mm": 0, "y_mm": 0},
      {"x_mm": 4200, "y_mm": 0}
    ],
    "base_offset_mm": 0,
    "height_mm": 2600,
    "thickness_mm": null,
    "alignment": "centre"
  },
  "attributes": {
    "externality": {
      "value": "internal",
      "state": "INFERRED",
      "confidence": 0.76
    },
    "structural_role": {
      "value": "unknown",
      "state": "UNKNOWN",
      "confidence": null
    }
  }
}
```

The renderer may use a visual fallback thickness, but that value must stay in render configuration and must not become a building fact.

## 14. Space

```json
{
  "id": "elem_space_kitchen",
  "element_type": "space",
  "lifecycle_state": "existing",
  "level_id": "elem_level_ground",
  "name": "Kitchen",
  "boundary": {
    "representation": "polygon",
    "points": [
      {"x_mm": 0, "y_mm": 0},
      {"x_mm": 4200, "y_mm": 0},
      {"x_mm": 4200, "y_mm": 3600},
      {"x_mm": 0, "y_mm": 3600}
    ]
  },
  "bounded_by_element_ids": [
    "elem_wall_01",
    "elem_wall_02",
    "elem_wall_03",
    "elem_wall_04"
  ],
  "classification": {
    "value": "kitchen",
    "state": "USER_PROVIDED",
    "confidence": 1.0
  }
}
```

## 15. Opening, door, and window

```json
{
  "id": "elem_door_01J...",
  "element_type": "door",
  "lifecycle_state": "existing",
  "host_element_id": "elem_wall_01J...",
  "placement": {
    "offset_along_host_mm": 1200,
    "sill_height_mm": 0,
    "width_mm": 838,
    "height_mm": 1981
  },
  "operation": {
    "swing": "left",
    "swing_angle_deg": 90
  },
  "attributes": {
    "fire_rating": {
      "value": "unknown",
      "state": "UNKNOWN"
    }
  }
}
```

## 16. Model operation

### Proposed operation

```json
{
  "id": "op_01J...",
  "model_id": "mdl_01J...",
  "base_version_id": "mv_01J...",
  "operation_type": "MoveWallPath",
  "status": "proposed",
  "parameters": {
    "wall_id": "elem_wall_01J...",
    "translation": {"x_mm": 0, "y_mm": 400}
  },
  "origin": {
    "type": "ai_agent",
    "request_text": "Move the kitchen wall 400 mm toward the hall.",
    "provider": "internal_model_gateway",
    "model_version": "recorded-provider-model"
  },
  "validation": {
    "status": "warning",
    "issues": [
      {
        "code": "DOOR_CLEARANCE_REDUCED",
        "severity": "warning",
        "affected_element_ids": ["elem_door_01J..."]
      }
    ]
  }
}
```

### Commit request

```json
{
  "operation_id": "op_01J...",
  "confirmation": {
    "confirmed_by": "usr_01J...",
    "confirmed_at": "2026-07-16T10:45:00Z"
  },
  "commit_message": "Move kitchen wall after clearance review"
}
```

## 17. Review schema

```json
{
  "id": "review_01J...",
  "project_id": "prj_01J...",
  "model_version_id": "mv_01J...",
  "review_type": "architect_concept_review",
  "purpose": "concept_design",
  "status": "completed_with_issues",
  "reviewer": {
    "user_id": "usr_arch_01J...",
    "organisation_id": "org_arch_01J...",
    "professional_capacity": "registered_architect",
    "registration_reference": "stored-securely"
  },
  "evidence_scope": ["existing_model", "brief", "option_a"],
  "limitations": [
    "No structural opening feasibility has been confirmed.",
    "Existing model is suitable for concept design only."
  ],
  "issues": [],
  "completed_at": "2026-07-16T11:00:00Z",
  "attestation_asset_id": "asset_review_record_01J..."
}
```

## 18. Job schema

```json
{
  "id": "job_01J...",
  "type": "plan_processing",
  "project_id": "prj_01J...",
  "status": "running",
  "progress": {
    "stage": "detecting_openings",
    "fraction": 0.62
  },
  "input_asset_ids": ["asset_01J..."],
  "output_asset_ids": [],
  "model_provider": {
    "name": "internal-plan-parser",
    "version": "0.1.0"
  },
  "created_at": "2026-07-16T10:05:00Z",
  "updated_at": "2026-07-16T10:06:00Z"
}
```

## 19. API resource map

### Projects

```text
POST   /projects
GET    /projects/{project_id}
PATCH  /projects/{project_id}
GET    /projects/{project_id}/timeline
GET    /projects/{project_id}/audit-events
```

### Property resolution

```text
POST   /properties:resolve-address
GET    /properties/{property_id}
POST   /properties/{property_id}:refresh-dossier
GET    /properties/{property_id}/source-records
```

Resolution request:

```json
{
  "query": "10 Example Road, London, AB1 2CD",
  "country_hint": "GB"
}
```

Return alternatives rather than silently resolving ambiguity.

### Assets

```text
POST   /projects/{project_id}/assets:prepare-upload
POST   /assets/{asset_id}:complete-upload
GET    /assets/{asset_id}
POST   /assets/{asset_id}/rights-declarations
POST   /assets/{asset_id}:request-deletion
GET    /assets/{asset_id}/derivations
```

### Processing jobs

```text
POST   /projects/{project_id}/plan-processing-jobs
POST   /projects/{project_id}/scan-processing-jobs
GET    /jobs/{job_id}
POST   /jobs/{job_id}:cancel
GET    /jobs/{job_id}/diagnostics
```

### Models and versions

```text
POST   /projects/{project_id}/models
GET    /models/{model_id}
GET    /models/{model_id}/versions
POST   /models/{model_id}/versions
GET    /model-versions/{version_id}
GET    /model-versions/{version_id}/elements
GET    /model-versions/{version_id}/provenance
POST   /model-versions/{version_id}:validate
POST   /model-versions/{version_id}:branch
POST   /model-versions/{version_id}:compare
```

### Operations

```text
POST   /models/{model_id}/operations:propose
POST   /models/{model_id}/operations:commit
POST   /models/{model_id}/operations:revert
GET    /models/{model_id}/operations/{operation_id}
```

### Reviews

```text
POST   /projects/{project_id}/reviews
GET    /reviews/{review_id}
POST   /reviews/{review_id}/issues
POST   /reviews/{review_id}:complete
POST   /reviews/{review_id}:withdraw
```

### Scenes and renders

```text
POST   /model-versions/{version_id}/scene-jobs
POST   /model-versions/{version_id}/render-jobs
POST   /model-versions/{version_id}/walkthrough-jobs
GET    /scenes/{scene_id}
GET    /renders/{render_id}/manifest
```

## 20. Scene manifest

```json
{
  "scene_id": "scene_01J...",
  "model_version_id": "mv_01J...",
  "compiler": {
    "name": "model-compiler",
    "version": "0.3.0",
    "config_hash": "..."
  },
  "assets": [
    {
      "role": "glb",
      "asset_id": "asset_glb_01J...",
      "sha256": "..."
    }
  ],
  "visual_defaults": {
    "unknown_wall_thickness_mm": 100,
    "unknown_values_are_visual_only": true
  },
  "generated_at": "2026-07-16T11:15:00Z"
}
```

The visual fallback is explicitly not a model fact.

## 21. Validation issue

```json
{
  "id": "issue_01J...",
  "code": "SPACE_BOUNDARY_OPEN",
  "severity": "error",
  "message": "Kitchen boundary is not closed.",
  "affected_element_ids": ["elem_space_kitchen", "elem_wall_03"],
  "rule": {
    "id": "geometry.space-boundary-closed",
    "version": "1.0.0"
  },
  "blocking_for": ["model_commit", "scene_compile"],
  "resolution_status": "open"
}
```

## 22. Event envelope

```json
{
  "event_id": "evt_01J...",
  "event_type": "ModelVersionCommitted",
  "event_version": 1,
  "occurred_at": "2026-07-16T11:20:00Z",
  "tenant_id": "org_home_01J...",
  "project_id": "prj_01J...",
  "actor": {
    "type": "user",
    "id": "usr_01J..."
  },
  "correlation_id": "corr_01J...",
  "data": {
    "model_id": "mdl_01J...",
    "version_id": "mv_01J...",
    "parent_version_ids": ["mv_parent_01J..."]
  }
}
```

## 23. Core events

### Property/data

- `PropertyCreated`
- `AddressResolutionCompleted`
- `PropertyDossierRefreshed`
- `SourceCoverageWarningRaised`

### Evidence/model

- `AssetUploaded`
- `RightsDeclarationRecorded`
- `PlanProcessingCompleted`
- `EvidenceAttached`
- `ModelOperationProposed`
- `ModelOperationCommitted`
- `ModelVersionCommitted`
- `ModelValidationFailed`

### Review/issue

- `ReviewRequested`
- `ReviewIssueRaised`
- `ReviewCompleted`
- `IssuedArtefactCreated`

### Visual

- `SceneCompiled`
- `RenderCompleted`
- `WalkthroughCompleted`

### Later commercial/delivery

- `EstimateCalculated`
- `BidReceived`
- `ContractorSelected`
- `VariationProposed`
- `MilestoneCompleted`
- `PaymentReleaseRequested`
- `DefectRaised`
- `AsBuiltIssued`

## 24. Permissions matrix example

| Action | Homeowner | Architect | Contractor bidder | AI agent | Support |
|---|---:|---:|---:|---:|---:|
| View current concept | Yes | Yes | Limited | Scoped | Break-glass |
| Upload plan | Yes | Yes | No | No | No |
| Propose model operation | Yes | Yes | No | Yes, scoped | No |
| Commit concept operation | Yes | Yes | No | No without user | No |
| Verify model for purpose | No | If competent/appointed | No | No | No |
| Issue professional artefact | No | If authorised | No | No | No |
| View private household photos | Yes | Scoped | No | Scoped service only | Break-glass |
| View tender information | Yes | Yes | Own bid context | No by default | Scoped |
| Release payment | Authorised customer/entity | No by default | No | Never | No |

## 25. Professional issue artefact

An issued package should have:

```json
{
  "issue_id": "issuepkg_01J...",
  "project_id": "prj_01J...",
  "model_version_id": "mv_01J...",
  "purpose": "planning_submission",
  "status": "issued",
  "artefacts": [
    {"asset_id": "asset_plan_pdf", "sha256": "..."},
    {"asset_id": "asset_model_ifc", "sha256": "..."}
  ],
  "review_ids": ["review_01J..."],
  "limitations": [],
  "issued_by": "usr_arch_01J...",
  "issued_at": "2026-07-16T12:00:00Z",
  "signature": "detached-signature-reference"
}
```

Any later change creates a new package; it does not mutate the issued package.

## 26. Address adapter interface

```typescript
interface AddressResolver {
  search(input: {
    query: string;
    jurisdictionHint?: UkJurisdiction;
    limit?: number;
  }): Promise<AddressCandidate[]>;

  resolve(input: {
    candidateId: string;
  }): Promise<ResolvedPropertyIdentity>;
}
```

Provider-specific fields stay behind the adapter. Preserve raw response in a governed source asset when allowed.

## 27. Property-data adapter interface

```typescript
interface PropertyDataAdapter<T> {
  readonly provider: string;
  readonly dataset: string;
  supports(jurisdiction: UkJurisdiction): boolean;
  fetch(input: PropertyDataRequest): Promise<SourceResult<T>>;
}

type SourceResult<T> = {
  data: T;
  source: SourceDescriptor;
  qualityFlags: string[];
  rights: RightsDescriptor;
  retrievedAt: string;
};
```

## 28. Model-provider gateway

```typescript
interface ModelGateway {
  generateStructured<T>(request: StructuredGenerationRequest<T>): Promise<ModelResult<T>>;
  embed(request: EmbeddingRequest): Promise<EmbeddingResult>;
  analyseImage(request: ImageAnalysisRequest): Promise<ModelResult<ImageAnalysis>>;
}
```

`ModelResult` records:

- provider;
- model/version;
- region;
- request configuration hash;
- latency;
- cost;
- safety flags;
- retention policy;
- raw response asset if permitted;
- schema validation.

## 29. Webhook rules

For external partners:

- signed payloads;
- replay protection;
- event version;
- retry with backoff;
- idempotent receiver;
- secret rotation;
- delivery log;
- no sensitive asset URLs in webhook payload;
- partner-specific scope.

## 30. Data export

A customer/project export should include, subject to rights and legal retention:

- property and project metadata;
- source list and limitations;
- model versions in native JSON plus selected open formats;
- evidence assets the customer may receive;
- issue packages;
- reviews and decisions;
- product/warranty data;
- audit excerpt;
- machine-readable manifest.

The export should remain useful without an active subscription.

## 31. API versioning

- backwards-compatible additions within `/v1`;
- explicit schema versions inside events and model snapshots;
- deprecation period and telemetry;
- migration tools for stored models;
- immutable issued artefacts preserve original schema/reader information;
- adapters version independently.

## 32. Open questions

- operation-log persistence format and replay engine;
- CRDT versus server-authoritative collaborative editing;
- exact geometry-kernel boundary;
- native model snapshot encoding;
- IFC model-view definitions by project stage;
- professional digital-signature method;
- data-residency requirements by customer/partner;
- product catalogue schema;
- rules engine representation;
- cost/quantity work-breakdown standard.

These should be resolved through ADRs and prototypes, not hidden inside early implementation choices.
