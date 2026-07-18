DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform_schema_migrations WHERE id = '0012_design_options') THEN
    RAISE EXCEPTION 'C13 specifications require migration 0012_design_options';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION c13_current_tenant_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

-- Catalog publication is project-scoped in M1. A future shared-library promotion must remain an
-- explicit, audited copy rather than bypassing tenant/project RLS.
CREATE TABLE IF NOT EXISTS catalog_releases (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  schema_version text NOT NULL CHECK (schema_version = 'c13-catalog-release-v1'),
  version text NOT NULL CHECK (version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'),
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('published', 'superseded', 'withdrawn')),
  release_payload jsonb NOT NULL CHECK (
    jsonb_typeof(release_payload) = 'object'
    AND release_payload ->> 'schemaVersion' = schema_version
    AND release_payload ->> 'releaseId' = id::text
    AND release_payload ->> 'manifestSha256' = manifest_sha256
    AND release_payload ->> 'status' = status
    AND jsonb_array_length(release_payload -> 'assetVersionIds') BETWEEN 1 AND 512
  ),
  published_by uuid NOT NULL REFERENCES identity_users(id),
  published_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, id),
  UNIQUE (tenant_id, project_id, id, manifest_sha256),
  UNIQUE (tenant_id, project_id, version),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS catalog_asset_versions (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  asset_id uuid NOT NULL,
  schema_version text NOT NULL CHECK (schema_version = 'c13-catalog-asset-version-v1'),
  kind text NOT NULL CHECK (kind IN ('furnishing', 'finish', 'light')),
  version text NOT NULL CHECK (version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'),
  version_sha256 text NOT NULL CHECK (version_sha256 ~ '^[0-9a-f]{64}$'),
  lifecycle text NOT NULL CHECK (lifecycle IN ('draft', 'quarantined', 'approved', 'withdrawn', 'deprecated')),
  rights_record_sha256 text NOT NULL CHECK (rights_record_sha256 ~ '^[0-9a-f]{64}$'),
  rights_review_state text NOT NULL CHECK (rights_review_state IN ('approved', 'withdrawn', 'expired')),
  placement_projection_sha256 text NOT NULL CHECK (placement_projection_sha256 ~ '^[0-9a-f]{64}$'),
  c12_asset_content_sha256 text NOT NULL CHECK (c12_asset_content_sha256 ~ '^[0-9a-f]{64}$'),
  c12_asset_metadata_sha256 text NOT NULL CHECK (c12_asset_metadata_sha256 ~ '^[0-9a-f]{64}$'),
  c12_placement_policy_sha256 text NOT NULL CHECK (c12_placement_policy_sha256 ~ '^[0-9a-f]{64}$'),
  asset_payload jsonb NOT NULL CHECK (
    jsonb_typeof(asset_payload) = 'object'
    AND asset_payload ->> 'schemaVersion' = schema_version
    AND asset_payload ->> 'versionId' = id::text
    AND asset_payload ->> 'assetId' = asset_id::text
    AND asset_payload ->> 'kind' = kind
    AND asset_payload ->> 'versionSha256' = version_sha256
    AND asset_payload ->> 'lifecycle' = lifecycle
    AND asset_payload #>> '{rights,recordSha256}' = rights_record_sha256
    AND asset_payload #>> '{rights,review,state}' = rights_review_state
    AND asset_payload #>> '{rights,policy,trainingAllowed}' = 'false'
    AND asset_payload #>> '{commercialData,price}' = 'not-provided'
    AND asset_payload #>> '{commercialData,liveAvailability}' = 'not-provided'
    AND asset_payload #>> '{commercialData,supplier}' = 'not-provided'
    AND asset_payload #>> '{commercialData,delivery}' = 'not-provided'
    AND asset_payload #>> '{placementProjection,projectionSha256}' = placement_projection_sha256
    AND asset_payload #>> '{placementProjection,c12Asset,contentSha256}' = c12_asset_content_sha256
    AND asset_payload #>> '{placementProjection,c12Asset,metadataSha256}' = c12_asset_metadata_sha256
    AND asset_payload #>> '{placementProjection,c12Asset,placementPolicy,policySha256}' = c12_placement_policy_sha256
  ),
  published_by uuid NOT NULL REFERENCES identity_users(id),
  published_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, id),
  UNIQUE (tenant_id, project_id, id, version_sha256),
  UNIQUE (tenant_id, project_id, asset_id, version),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS catalog_release_assets (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  release_id uuid NOT NULL,
  release_sha256 text NOT NULL CHECK (release_sha256 ~ '^[0-9a-f]{64}$'),
  asset_version_id uuid NOT NULL,
  asset_version_sha256 text NOT NULL CHECK (asset_version_sha256 ~ '^[0-9a-f]{64}$'),
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 511),
  PRIMARY KEY (tenant_id, project_id, release_id, asset_version_id),
  UNIQUE (tenant_id, project_id, release_id, ordinal),
  UNIQUE (
    tenant_id, project_id, release_id, release_sha256, asset_version_id, asset_version_sha256
  ),
  FOREIGN KEY (tenant_id, project_id, release_id, release_sha256)
    REFERENCES catalog_releases(tenant_id, project_id, id, manifest_sha256) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, asset_version_id, asset_version_sha256)
    REFERENCES catalog_asset_versions(tenant_id, project_id, id, version_sha256) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS specifications (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  schema_version text NOT NULL CHECK (schema_version = 'c13-specification-v1'),
  status text NOT NULL CHECK (status = 'working'),
  current_revision integer NOT NULL CHECK (current_revision >= 1),
  source_job_id uuid NOT NULL,
  source_option_id uuid NOT NULL,
  source_confirmation_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES identity_users(id),
  created_at timestamptz NOT NULL,
  updated_by uuid NOT NULL REFERENCES identity_users(id),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, id),
  UNIQUE (tenant_id, project_id, source_confirmation_id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, source_job_id, source_option_id)
    REFERENCES design_option_confirmations(tenant_id, project_id, job_id, option_id)
    ON DELETE RESTRICT,
  CHECK (updated_at >= created_at)
);

CREATE INDEX IF NOT EXISTS specifications_list_idx
  ON specifications (tenant_id, project_id, updated_at DESC, id);

CREATE TABLE IF NOT EXISTS specification_revisions (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  specification_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  schema_version text NOT NULL CHECK (schema_version = 'c13-specification-revision-v1'),
  revision_sha256 text NOT NULL CHECK (revision_sha256 ~ '^[0-9a-f]{64}$'),
  branch_id uuid NOT NULL,
  branch_revision integer NOT NULL CHECK (branch_revision >= 1),
  model_id uuid NOT NULL,
  model_profile text NOT NULL DEFAULT 'proposed' CHECK (model_profile = 'proposed'),
  model_snapshot_id uuid NOT NULL,
  model_snapshot_sha256 text NOT NULL CHECK (model_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  model_snapshot_version integer NOT NULL CHECK (model_snapshot_version >= 1),
  catalog_release_id uuid NOT NULL,
  catalog_release_sha256 text NOT NULL CHECK (catalog_release_sha256 ~ '^[0-9a-f]{64}$'),
  source_job_id uuid NOT NULL,
  source_option_id uuid NOT NULL,
  source_confirmation jsonb NOT NULL CHECK (
    jsonb_typeof(source_confirmation) = 'object'
    AND source_confirmation ->> 'jobId' = source_job_id::text
    AND source_confirmation ->> 'optionId' = source_option_id::text
    AND source_confirmation ->> 'profile' = 'proposed'
  ),
  created_by uuid NOT NULL REFERENCES identity_users(id),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, specification_id, revision),
  UNIQUE (tenant_id, project_id, specification_id, revision, revision_sha256),
  FOREIGN KEY (tenant_id, project_id, specification_id)
    REFERENCES specifications(tenant_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, catalog_release_id, catalog_release_sha256)
    REFERENCES catalog_releases(tenant_id, project_id, id, manifest_sha256) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, model_id, model_profile, branch_id)
    REFERENCES model_branches(tenant_id, project_id, model_id, profile, id) ON DELETE RESTRICT,
  FOREIGN KEY (
    tenant_id, project_id, model_id, model_profile,
    model_snapshot_id, model_snapshot_sha256, model_snapshot_version
  ) REFERENCES canonical_model_snapshots (
    tenant_id, project_id, model_id, profile, id, snapshot_sha256, version
  ) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, source_job_id, source_option_id)
    REFERENCES design_option_confirmations(tenant_id, project_id, job_id, option_id)
    ON DELETE RESTRICT
);

-- Every schedule is read directly from these rows. There are no room/product/finish schedule tables.
CREATE TABLE IF NOT EXISTS specification_lines (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  specification_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  line_id uuid NOT NULL,
  element_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('furnishing', 'finish', 'light')),
  level_id uuid NOT NULL,
  catalog_release_id uuid NOT NULL,
  catalog_release_sha256 text NOT NULL CHECK (catalog_release_sha256 ~ '^[0-9a-f]{64}$'),
  asset_version_id uuid NOT NULL,
  asset_version_sha256 text NOT NULL CHECK (asset_version_sha256 ~ '^[0-9a-f]{64}$'),
  asset_content_sha256 text NOT NULL CHECK (asset_content_sha256 ~ '^[0-9a-f]{64}$'),
  asset_metadata_sha256 text NOT NULL CHECK (asset_metadata_sha256 ~ '^[0-9a-f]{64}$'),
  placement_projection_sha256 text NOT NULL CHECK (placement_projection_sha256 ~ '^[0-9a-f]{64}$'),
  placement_policy_sha256 text NOT NULL CHECK (placement_policy_sha256 ~ '^[0-9a-f]{64}$'),
  rights_record_sha256 text NOT NULL CHECK (rights_record_sha256 ~ '^[0-9a-f]{64}$'),
  line_payload jsonb NOT NULL CHECK (
    jsonb_typeof(line_payload) = 'object'
    AND line_payload ->> 'schemaVersion' = 'c13-specification-line-v1'
    AND line_payload ->> 'lineId' = line_id::text
    AND line_payload ->> 'elementId' = element_id::text
    AND line_payload ->> 'kind' = kind
    AND line_payload ->> 'levelId' = level_id::text
    AND line_payload ->> 'catalogReleaseId' = catalog_release_id::text
    AND line_payload ->> 'catalogReleaseSha256' = catalog_release_sha256
    AND line_payload ->> 'assetVersionId' = asset_version_id::text
    AND line_payload ->> 'assetVersionSha256' = asset_version_sha256
    AND line_payload ->> 'assetContentSha256' = asset_content_sha256
    AND line_payload ->> 'assetMetadataSha256' = asset_metadata_sha256
    AND line_payload ->> 'placementProjectionSha256' = placement_projection_sha256
    AND line_payload ->> 'placementPolicySha256' = placement_policy_sha256
    AND line_payload ->> 'rightsRecordSha256' = rights_record_sha256
    AND char_length(line_payload ->> 'notes') <= 2000
    AND (
      (kind IN ('furnishing', 'light') AND line_payload #>> '{quantity,state}' = 'counted'
        AND line_payload #>> '{quantity,count}' = '1')
      OR (kind = 'finish' AND line_payload #>> '{quantity,state}' = 'unknown'
        AND line_payload #>> '{quantity,reason}' = 'not-derived-in-c13')
    )
  ),
  PRIMARY KEY (tenant_id, project_id, specification_id, revision, line_id),
  UNIQUE (tenant_id, project_id, specification_id, revision, element_id),
  FOREIGN KEY (tenant_id, project_id, specification_id, revision)
    REFERENCES specification_revisions(tenant_id, project_id, specification_id, revision)
    ON DELETE RESTRICT,
  FOREIGN KEY (
    tenant_id, project_id, catalog_release_id, catalog_release_sha256,
    asset_version_id, asset_version_sha256
  ) REFERENCES catalog_release_assets (
    tenant_id, project_id, release_id, release_sha256, asset_version_id, asset_version_sha256
  ) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS specification_lines_room_projection_idx
  ON specification_lines (
    tenant_id, project_id, specification_id, revision,
    ((line_payload #>> '{roomAssignment,spaceId}'))
  );
CREATE INDEX IF NOT EXISTS specification_lines_product_projection_idx
  ON specification_lines (tenant_id, project_id, specification_id, revision, kind, asset_version_id);

CREATE TABLE IF NOT EXISTS specification_substitution_previews (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  specification_id uuid NOT NULL,
  id uuid NOT NULL,
  schema_version text NOT NULL CHECK (schema_version = 'c13-substitution-preview-v1'),
  specification_revision integer NOT NULL CHECK (specification_revision >= 1),
  element_id uuid NOT NULL,
  replacement_asset_version_id uuid NOT NULL,
  replacement_asset_version_sha256 text NOT NULL CHECK (replacement_asset_version_sha256 ~ '^[0-9a-f]{64}$'),
  model_id uuid NOT NULL,
  model_profile text NOT NULL DEFAULT 'proposed' CHECK (model_profile = 'proposed'),
  branch_id uuid NOT NULL,
  branch_revision integer NOT NULL CHECK (branch_revision >= 1),
  model_preview_id uuid NOT NULL,
  base_snapshot_id uuid NOT NULL,
  base_snapshot_sha256 text NOT NULL CHECK (base_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  candidate_snapshot_sha256 text NOT NULL CHECK (candidate_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  operation_payload jsonb NOT NULL CHECK (
    jsonb_typeof(operation_payload) = 'object'
    AND operation_payload ->> 'schemaVersion' = 'c12-design-element-operation-v1'
    AND operation_payload ->> 'type' = 'design.element.replace.v1'
    AND operation_payload ->> 'expectedElementId' = element_id::text
    AND operation_payload #>> '{element,id}' = element_id::text
  ),
  operation_sha256 text NOT NULL CHECK (operation_sha256 ~ '^[0-9a-f]{64}$'),
  preview_payload jsonb NOT NULL CHECK (
    jsonb_typeof(preview_payload) = 'object'
    AND preview_payload ->> 'schemaVersion' = schema_version
    AND preview_payload ->> 'previewId' = id::text
    AND preview_payload ->> 'specificationId' = specification_id::text
    AND preview_payload ->> 'elementId' = element_id::text
    AND preview_payload ->> 'modelPreviewId' = model_preview_id::text
    AND preview_payload ->> 'candidateSnapshotSha256' = candidate_snapshot_sha256
    AND preview_payload ->> 'visualisationStatus' = 'bounded-catalog-preview-only'
  ),
  created_by uuid NOT NULL REFERENCES identity_users(id),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  PRIMARY KEY (tenant_id, project_id, specification_id, id),
  UNIQUE (tenant_id, project_id, specification_id, model_preview_id),
  FOREIGN KEY (tenant_id, project_id, specification_id, specification_revision)
    REFERENCES specification_revisions(tenant_id, project_id, specification_id, revision)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, replacement_asset_version_id, replacement_asset_version_sha256)
    REFERENCES catalog_asset_versions(tenant_id, project_id, id, version_sha256) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, model_profile, branch_id, model_preview_id)
    REFERENCES model_operation_previews(tenant_id, project_id, profile, branch_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS specification_substitution_heads (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  specification_id uuid NOT NULL,
  preview_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  state text NOT NULL CHECK (state IN ('pending', 'confirmed', 'expired')),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, specification_id, preview_id),
  FOREIGN KEY (tenant_id, project_id, specification_id, preview_id)
    REFERENCES specification_substitution_previews(tenant_id, project_id, specification_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS specification_substitution_confirmations (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  specification_id uuid NOT NULL,
  id uuid NOT NULL,
  schema_version text NOT NULL CHECK (schema_version = 'c13-substitution-confirmation-v1'),
  preview_id uuid NOT NULL,
  specification_revision integer NOT NULL CHECK (specification_revision >= 2),
  element_id uuid NOT NULL,
  model_id uuid NOT NULL,
  model_profile text NOT NULL DEFAULT 'proposed' CHECK (model_profile = 'proposed'),
  branch_id uuid NOT NULL,
  branch_revision integer NOT NULL CHECK (branch_revision >= 2),
  commit_id uuid NOT NULL,
  result_snapshot_id uuid NOT NULL,
  result_snapshot_sha256 text NOT NULL CHECK (result_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  scene_job_id uuid NOT NULL,
  confirmation_payload jsonb NOT NULL CHECK (
    jsonb_typeof(confirmation_payload) = 'object'
    AND confirmation_payload ->> 'schemaVersion' = schema_version
    AND confirmation_payload ->> 'confirmationId' = id::text
    AND confirmation_payload ->> 'specificationId' = specification_id::text
    AND confirmation_payload ->> 'elementId' = element_id::text
    AND confirmation_payload ->> 'commitId' = commit_id::text
    AND confirmation_payload ->> 'resultSnapshotId' = result_snapshot_id::text
    AND confirmation_payload ->> 'resultSnapshotSha256' = result_snapshot_sha256
    AND confirmation_payload ->> 'sceneJobId' = scene_job_id::text
  ),
  confirmed_by uuid NOT NULL REFERENCES identity_users(id),
  confirmed_at timestamptz NOT NULL,
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  trace_id text NOT NULL CHECK (trace_id ~ '^[0-9a-f]{32}$'),
  PRIMARY KEY (tenant_id, project_id, specification_id, id),
  UNIQUE (tenant_id, project_id, specification_id, preview_id),
  UNIQUE (tenant_id, project_id, scene_job_id),
  FOREIGN KEY (tenant_id, project_id, specification_id, preview_id)
    REFERENCES specification_substitution_heads(tenant_id, project_id, specification_id, preview_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, specification_id, specification_revision)
    REFERENCES specification_revisions(tenant_id, project_id, specification_id, revision)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, model_profile, branch_id, commit_id)
    REFERENCES model_operation_commits(tenant_id, project_id, profile, branch_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, model_profile, result_snapshot_id)
    REFERENCES canonical_model_snapshots(tenant_id, project_id, profile, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS specification_scene_links (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  specification_id uuid NOT NULL,
  specification_revision integer NOT NULL CHECK (specification_revision >= 2),
  confirmation_id uuid NOT NULL,
  scene_job_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  state text NOT NULL CHECK (state IN ('pending', 'requested', 'retry-required')),
  safe_code text CHECK (safe_code IS NULL OR safe_code = 'SCENE_REQUEST_FAILED'),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, scene_job_id),
  FOREIGN KEY (tenant_id, project_id, specification_id, confirmation_id)
    REFERENCES specification_substitution_confirmations(tenant_id, project_id, specification_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, specification_id, specification_revision)
    REFERENCES specification_revisions(tenant_id, project_id, specification_id, revision)
    ON DELETE RESTRICT,
  CHECK ((state = 'retry-required') = (safe_code IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS specification_scene_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  scene_job_id uuid NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  previous_state text CHECK (previous_state IN ('pending', 'requested', 'retry-required')),
  state text NOT NULL CHECK (state IN ('pending', 'requested', 'retry-required')),
  safe_code text CHECK (safe_code IS NULL OR safe_code = 'SCENE_REQUEST_FAILED'),
  occurred_at timestamptz NOT NULL,
  UNIQUE (tenant_id, project_id, scene_job_id, version),
  FOREIGN KEY (tenant_id, project_id, scene_job_id)
    REFERENCES specification_scene_links(tenant_id, project_id, scene_job_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS specification_idempotency_effects (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  actor_user_id uuid NOT NULL REFERENCES identity_users(id),
  operation text NOT NULL CHECK (operation IN (
    'specification.create', 'specification.update',
    'specification.substitution.preview', 'specification.substitution.confirm'
  )),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  response_kind text CHECK (response_kind IN ('specification', 'preview', 'confirmation')),
  response_id uuid,
  response_status integer CHECK (response_status IN (200, 201)),
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  PRIMARY KEY (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  CHECK ((response_kind IS NULL AND response_id IS NULL AND response_status IS NULL AND completed_at IS NULL)
    OR (response_kind IS NOT NULL AND response_id IS NOT NULL
      AND response_status IS NOT NULL AND completed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS specification_idempotency_project_idx
  ON specification_idempotency_effects (tenant_id, project_id, created_at, idempotency_key);

CREATE TABLE IF NOT EXISTS specification_audit_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  specification_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  action text NOT NULL CHECK (action IN (
    'specification.create', 'specification.update',
    'specification.substitution.preview', 'specification.substitution.confirm',
    'specification.scene.request'
  )),
  outcome text NOT NULL CHECK (outcome IN ('accepted', 'replayed', 'retry-required')),
  actor_user_id uuid REFERENCES identity_users(id),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  trace_id text NOT NULL CHECK (trace_id ~ '^[0-9a-f]{32}$'),
  metadata jsonb NOT NULL CHECK (
    jsonb_typeof(metadata) = 'object'
    AND NOT metadata ?| ARRAY[
      'notes', 'schedule', 'lines', 'operations', 'artifacts', 'paths', 'manifest',
      'licenceText', 'attributionContact', 'sourceReceipt', 'token', 'credential',
      'signedUrl', 'objectLocator'
    ]
  ),
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, project_id, specification_id, revision)
    REFERENCES specification_revisions(tenant_id, project_id, specification_id, revision)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS specification_outbox (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  specification_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  event_type text NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9.-]{2,79}$'),
  schema_version text NOT NULL CHECK (schema_version = 'c13-specification-revision-v1'),
  payload jsonb NOT NULL CHECK (
    jsonb_typeof(payload) = 'object'
    AND NOT payload ?| ARRAY[
      'notes', 'schedule', 'lines', 'operations', 'artifacts', 'paths', 'manifest',
      'licenceText', 'attributionContact', 'sourceReceipt', 'token', 'credential',
      'signedUrl', 'objectLocator'
    ]
  ),
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, project_id, specification_id, revision)
    REFERENCES specification_revisions(tenant_id, project_id, specification_id, revision)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS specification_outbox_poll_idx ON specification_outbox (occurred_at, id);

CREATE OR REPLACE FUNCTION c13_reject_append_only_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE OR REPLACE FUNCTION c13_validate_specification_head()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'specifications cannot be deleted'; END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.project_id IS DISTINCT FROM NEW.project_id OR OLD.id IS DISTINCT FROM NEW.id
    OR OLD.schema_version IS DISTINCT FROM NEW.schema_version OR OLD.status IS DISTINCT FROM NEW.status
    OR OLD.source_job_id IS DISTINCT FROM NEW.source_job_id
    OR OLD.source_option_id IS DISTINCT FROM NEW.source_option_id
    OR OLD.source_confirmation_id IS DISTINCT FROM NEW.source_confirmation_id
    OR OLD.created_by IS DISTINCT FROM NEW.created_by OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR NEW.current_revision <> OLD.current_revision + 1 OR NEW.updated_at <= OLD.updated_at
  THEN RAISE EXCEPTION 'invalid specification head advancement'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION c13_validate_substitution_head()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'substitution heads cannot be deleted'; END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.specification_id IS DISTINCT FROM NEW.specification_id
    OR OLD.preview_id IS DISTINCT FROM NEW.preview_id
    OR OLD.state <> 'pending' OR NEW.state NOT IN ('confirmed', 'expired')
    OR NEW.version <> OLD.version + 1 OR NEW.updated_at <= OLD.updated_at
  THEN RAISE EXCEPTION 'invalid substitution head advancement'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION c13_validate_scene_link()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'specification scene links cannot be deleted'; END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.specification_id IS DISTINCT FROM NEW.specification_id
    OR OLD.specification_revision IS DISTINCT FROM NEW.specification_revision
    OR OLD.confirmation_id IS DISTINCT FROM NEW.confirmation_id
    OR OLD.scene_job_id IS DISTINCT FROM NEW.scene_job_id
    OR NEW.version <> OLD.version + 1 OR NEW.updated_at <= OLD.updated_at
    OR NOT ((OLD.state = 'pending' AND NEW.state IN ('requested', 'retry-required'))
      OR (OLD.state = 'retry-required' AND NEW.state IN ('requested', 'retry-required'))
      OR (OLD.state = 'requested' AND NEW.state = 'requested'))
  THEN RAISE EXCEPTION 'invalid specification scene link advancement'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION c13_validate_idempotency_completion()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'specification idempotency effects cannot be deleted'; END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key
    OR OLD.actor_user_id IS DISTINCT FROM NEW.actor_user_id
    OR OLD.operation IS DISTINCT FROM NEW.operation
    OR OLD.request_sha256 IS DISTINCT FROM NEW.request_sha256
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR OLD.completed_at IS NOT NULL OR NEW.completed_at IS NULL
  THEN RAISE EXCEPTION 'invalid specification idempotency completion'; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS specifications_validate_head ON specifications;
CREATE TRIGGER specifications_validate_head BEFORE UPDATE OR DELETE ON specifications
FOR EACH ROW EXECUTE FUNCTION c13_validate_specification_head();
DROP TRIGGER IF EXISTS specification_substitution_heads_validate ON specification_substitution_heads;
CREATE TRIGGER specification_substitution_heads_validate BEFORE UPDATE OR DELETE ON specification_substitution_heads
FOR EACH ROW EXECUTE FUNCTION c13_validate_substitution_head();
DROP TRIGGER IF EXISTS specification_scene_links_validate ON specification_scene_links;
CREATE TRIGGER specification_scene_links_validate BEFORE UPDATE OR DELETE ON specification_scene_links
FOR EACH ROW EXECUTE FUNCTION c13_validate_scene_link();
DROP TRIGGER IF EXISTS specification_idempotency_validate ON specification_idempotency_effects;
CREATE TRIGGER specification_idempotency_validate BEFORE UPDATE OR DELETE ON specification_idempotency_effects
FOR EACH ROW EXECUTE FUNCTION c13_validate_idempotency_completion();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'catalog_releases', 'catalog_asset_versions', 'catalog_release_assets',
    'specification_revisions', 'specification_lines', 'specification_substitution_previews',
    'specification_substitution_confirmations', 'specification_scene_events',
    'specification_audit_events', 'specification_outbox'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_append_only ON %I', table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER %I_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION c13_reject_append_only_mutation()',
      table_name, table_name
    );
  END LOOP;
END
$$;

-- FORCE is mandatory because table-owner execution must not silently bypass C13 tenant isolation.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'catalog_releases', 'catalog_asset_versions', 'catalog_release_assets',
    'specifications', 'specification_revisions', 'specification_lines',
    'specification_substitution_previews', 'specification_substitution_heads',
    'specification_substitution_confirmations', 'specification_scene_links',
    'specification_scene_events', 'specification_idempotency_effects',
    'specification_audit_events', 'specification_outbox'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_policy ON %I', table_name, table_name);
    EXECUTE format(
      'CREATE POLICY %I_tenant_policy ON %I USING (tenant_id = c13_current_tenant_id()) WITH CHECK (tenant_id = c13_current_tenant_id())',
      table_name, table_name
    );
  END LOOP;
END
$$;

INSERT INTO platform_schema_migrations (id)
VALUES ('0013_specifications')
ON CONFLICT (id) DO NOTHING;
