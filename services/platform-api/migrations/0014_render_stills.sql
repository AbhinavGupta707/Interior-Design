DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform_schema_migrations WHERE id = '0013_specifications') THEN
    RAISE EXCEPTION 'C14 render stills require migration 0013_specifications';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION c14_current_tenant_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE TABLE render_jobs (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  request_payload jsonb NOT NULL CHECK (
    jsonb_typeof(request_payload) = 'object'
    AND pg_column_size(request_payload) <= 16384
    AND request_payload ?& ARRAY[
      'cameraId', 'enhancement', 'label', 'lightingPresetId', 'profileId', 'sourceSceneJobId'
    ]
    AND request_payload ->> 'sourceSceneJobId' = source_scene_job_id::text
    AND request_payload ->> 'cameraId' ~ '^[0-9a-f-]{36}$'
    AND request_payload ->> 'enhancement' IN ('disabled', 'optional-provider')
    AND char_length(request_payload ->> 'label') BETWEEN 1 AND 160
    AND request_payload ->> 'lightingPresetId' = 'canonical-lights-neutral-world-v1'
    AND request_payload ->> 'profileId' IN (
      'eevee-local-preview-v1', 'cycles-cpu-geometry-safe-v1',
      'cycles-metal-geometry-safe-v1', 'cycles-cuda-high-resolution-v1',
      'cycles-optix-high-resolution-v1'
    )
    AND (
      (specification_id IS NULL AND NOT request_payload ? 'specification')
      OR
      (specification_id IS NOT NULL
        AND jsonb_typeof(request_payload -> 'specification') = 'object'
        AND request_payload #>> '{specification,specificationId}' = specification_id::text
        AND request_payload #>> '{specification,specificationRevision}' = specification_revision::text)
    )
  ),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  cache_identity_sha256 text NOT NULL CHECK (cache_identity_sha256 ~ '^[0-9a-f]{64}$'),
  source_payload jsonb NOT NULL CHECK (
    jsonb_typeof(source_payload) = 'object'
    AND pg_column_size(source_payload) <= 16384
    AND source_payload ?& ARRAY[
      'projectId', 'sceneJobId', 'sceneId', 'sceneArtifactId', 'sceneGlbSha256',
      'sceneManifestSha256', 'sourceSnapshotSha256'
    ]
    AND source_payload ->> 'projectId' = project_id::text
    AND source_payload ->> 'sceneJobId' = source_scene_job_id::text
    AND source_payload ->> 'sceneId' = source_scene_id::text
    AND source_payload ->> 'sceneArtifactId' = source_scene_artifact_id::text
    AND source_payload ->> 'sceneGlbSha256' = source_scene_glb_sha256
    AND source_payload ->> 'sceneManifestSha256' = source_scene_manifest_sha256
    AND source_payload ->> 'sourceSnapshotSha256' = source_snapshot_sha256
    AND (
      (specification_id IS NULL AND NOT source_payload ? 'specification')
      OR
      (specification_id IS NOT NULL
        AND jsonb_typeof(source_payload -> 'specification') = 'object'
        AND source_payload #>> '{specification,specificationId}' = specification_id::text
        AND source_payload #>> '{specification,specificationRevision}' = specification_revision::text
        AND source_payload #>> '{specification,specificationRevisionSha256}' = specification_revision_sha256
        AND source_payload #>> '{specification,catalogReleaseId}' = catalog_release_id::text
        AND source_payload #>> '{specification,catalogReleaseSha256}' = catalog_release_sha256)
    )
  ),
  source_scene_job_id uuid NOT NULL,
  source_scene_id uuid NOT NULL,
  source_scene_artifact_id uuid NOT NULL,
  source_scene_glb_sha256 text NOT NULL CHECK (source_scene_glb_sha256 ~ '^[0-9a-f]{64}$'),
  source_scene_manifest_sha256 text NOT NULL CHECK (source_scene_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  source_snapshot_sha256 text NOT NULL CHECK (source_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  specification_id uuid,
  specification_revision integer CHECK (specification_revision IS NULL OR specification_revision >= 1),
  specification_revision_sha256 text CHECK (
    specification_revision_sha256 IS NULL OR specification_revision_sha256 ~ '^[0-9a-f]{64}$'
  ),
  catalog_release_id uuid,
  catalog_release_sha256 text CHECK (
    catalog_release_sha256 IS NULL OR catalog_release_sha256 ~ '^[0-9a-f]{64}$'
  ),
  required_capability text NOT NULL CHECK (
    char_length(required_capability) BETWEEN 3 AND 120
    AND required_capability ~ '^[A-Za-z0-9_.:+-]+$'
  ),
  estimated_job_bytes bigint NOT NULL CHECK (estimated_job_bytes BETWEEN 1 AND 2147483648),
  enhancement_provider_enabled boolean NOT NULL DEFAULT false,
  publication_result_id uuid NOT NULL,
  attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 3),
  state text NOT NULL CHECK (state IN (
    'queued', 'preparing', 'rendering-safe', 'validating-safe', 'publishing-safe',
    'succeeded', 'cancel-requested', 'cancelled', 'failed'
  )),
  result_id uuid,
  retryable boolean NOT NULL DEFAULT false,
  safe_code text CHECK (safe_code IS NULL OR safe_code ~ '^[A-Z][A-Z0-9_]{2,79}$'),
  created_by uuid NOT NULL REFERENCES identity_users(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  PRIMARY KEY (tenant_id, project_id, id),
  UNIQUE (tenant_id, project_id, publication_result_id),
  UNIQUE (tenant_id, project_id, cache_identity_sha256),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, source_scene_job_id)
    REFERENCES scene_jobs(tenant_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, source_scene_id)
    REFERENCES scenes(tenant_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, source_scene_artifact_id)
    REFERENCES scene_artifacts(tenant_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (
    tenant_id, project_id, specification_id, specification_revision,
    specification_revision_sha256
  ) REFERENCES specification_revisions (
    tenant_id, project_id, specification_id, revision, revision_sha256
  ) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, catalog_release_id, catalog_release_sha256)
    REFERENCES catalog_releases(tenant_id, project_id, id, manifest_sha256) ON DELETE RESTRICT,
  CHECK (
    (specification_id IS NULL AND specification_revision IS NULL
      AND specification_revision_sha256 IS NULL AND catalog_release_id IS NULL
      AND catalog_release_sha256 IS NULL)
    OR
    (specification_id IS NOT NULL AND specification_revision IS NOT NULL
      AND specification_revision_sha256 IS NOT NULL AND catalog_release_id IS NOT NULL
      AND catalog_release_sha256 IS NOT NULL)
  ),
  CHECK ((state = 'succeeded') = (result_id IS NOT NULL)),
  CHECK ((state = 'failed') = (safe_code IS NOT NULL)),
  CHECK (NOT retryable OR state IN ('cancelled', 'failed')),
  CHECK (updated_at >= created_at)
);

CREATE INDEX render_jobs_list_idx ON render_jobs (tenant_id, project_id, created_at DESC, id);
CREATE INDEX render_jobs_queue_idx ON render_jobs (required_capability, created_at, id)
  WHERE state IN (
    'queued', 'preparing', 'rendering-safe', 'validating-safe',
    'publishing-safe', 'cancel-requested'
  );
CREATE INDEX render_jobs_source_idx ON render_jobs (
  tenant_id, project_id, source_scene_job_id, specification_id, specification_revision
);

-- Immutable declaration of each attempt. Lease/heartbeat state lives in the separately fenced head.
CREATE TABLE render_attempts (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid NOT NULL,
  attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 3),
  estimated_job_bytes bigint NOT NULL CHECK (estimated_job_bytes BETWEEN 1 AND 2147483648),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, job_id, attempt),
  FOREIGN KEY (tenant_id, project_id, job_id)
    REFERENCES render_jobs(tenant_id, project_id, id) ON DELETE RESTRICT
);

CREATE TABLE render_attempt_heads (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid NOT NULL,
  attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 3),
  state text NOT NULL CHECK (state IN (
    'queued', 'leased', 'cancel-requested', 'cancelled', 'succeeded', 'failed'
  )),
  stage text NOT NULL CHECK (stage IN (
    'preparing', 'rendering-safe', 'validating-safe', 'publishing-safe'
  )),
  lease_owner text CHECK (
    lease_owner IS NULL OR (
      char_length(lease_owner) BETWEEN 3 AND 100 AND lease_owner ~ '^[A-Za-z0-9_.:-]+$'
    )
  ),
  lease_token uuid,
  lease_expires_at timestamptz,
  lease_seconds integer CHECK (lease_seconds IS NULL OR lease_seconds BETWEEN 30 AND 3600),
  fence_version integer NOT NULL DEFAULT 0 CHECK (fence_version >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, job_id, attempt),
  FOREIGN KEY (tenant_id, project_id, job_id, attempt)
    REFERENCES render_attempts(tenant_id, project_id, job_id, attempt) ON DELETE RESTRICT,
  CHECK (
    (state IN ('leased', 'cancel-requested')) =
    (lease_owner IS NOT NULL AND lease_token IS NOT NULL
      AND lease_expires_at IS NOT NULL AND lease_seconds IS NOT NULL)
  )
);

CREATE INDEX render_attempt_heads_claim_idx
  ON render_attempt_heads (state, lease_expires_at, created_at, job_id)
  WHERE state IN ('queued', 'leased', 'cancel-requested');

CREATE TABLE render_attempt_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid NOT NULL,
  attempt integer NOT NULL,
  fence_version integer NOT NULL CHECK (fence_version >= 0),
  state text NOT NULL CHECK (state IN (
    'queued', 'leased', 'cancel-requested', 'cancelled', 'succeeded', 'failed'
  )),
  stage text NOT NULL CHECK (stage IN (
    'preparing', 'rendering-safe', 'validating-safe', 'publishing-safe'
  )),
  safe_code text CHECK (safe_code IS NULL OR safe_code ~ '^[A-Z][A-Z0-9_]{2,79}$'),
  worker_id text CHECK (
    worker_id IS NULL OR (
      char_length(worker_id) BETWEEN 3 AND 100 AND worker_id ~ '^[A-Za-z0-9_.:-]+$'
    )
  ),
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, project_id, job_id, attempt)
    REFERENCES render_attempts(tenant_id, project_id, job_id, attempt) ON DELETE RESTRICT
);

CREATE INDEX render_attempt_events_job_idx
  ON render_attempt_events (tenant_id, project_id, job_id, attempt, occurred_at, id);

-- Reservations and releases are immutable facts. An active reservation has no matching release.
CREATE TABLE render_disk_reservations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid NOT NULL,
  attempt integer NOT NULL,
  volume_id text NOT NULL CHECK (
    char_length(volume_id) BETWEEN 3 AND 120 AND volume_id ~ '^[A-Za-z0-9_.:-]+$'
  ),
  estimated_job_bytes bigint NOT NULL CHECK (estimated_job_bytes BETWEEN 1 AND 2147483648),
  observed_free_bytes bigint NOT NULL CHECK (observed_free_bytes >= 0),
  required_unreserved_bytes bigint NOT NULL CHECK (required_unreserved_bytes >= 16106127360),
  reserved_at timestamptz NOT NULL,
  UNIQUE (tenant_id, project_id, job_id, attempt),
  FOREIGN KEY (tenant_id, project_id, job_id, attempt)
    REFERENCES render_attempts(tenant_id, project_id, job_id, attempt) ON DELETE RESTRICT
);

CREATE INDEX render_disk_reservations_volume_idx
  ON render_disk_reservations (volume_id, reserved_at, id);

CREATE TABLE render_disk_reservation_releases (
  reservation_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid NOT NULL,
  attempt integer NOT NULL,
  terminal_state text NOT NULL CHECK (terminal_state IN ('cancelled', 'failed', 'succeeded')),
  released_at timestamptz NOT NULL,
  FOREIGN KEY (reservation_id) REFERENCES render_disk_reservations(id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, job_id, attempt)
    REFERENCES render_attempts(tenant_id, project_id, job_id, attempt) ON DELETE RESTRICT
);

CREATE TABLE render_results (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  job_id uuid NOT NULL,
  publishing_attempt integer NOT NULL CHECK (publishing_attempt BETWEEN 1 AND 3),
  schema_version text NOT NULL CHECK (schema_version = 'c14-render-output-manifest-v1'),
  manifest_payload jsonb NOT NULL CHECK (
    jsonb_typeof(manifest_payload) = 'object'
    AND pg_column_size(manifest_payload) <= 1048576
    AND manifest_payload ->> 'schemaVersion' = schema_version
    AND manifest_payload ->> 'resultId' = id::text
    AND manifest_payload ->> 'authority' = 'derived-visualisation-only'
    AND manifest_payload ->> 'renderSceneManifestSha256' ~ '^[0-9a-f]{64}$'
    AND NOT manifest_payload ? 'manifestSha256'
  ),
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid NOT NULL REFERENCES identity_users(id),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, id),
  UNIQUE (tenant_id, project_id, job_id),
  UNIQUE (tenant_id, project_id, id, manifest_sha256),
  FOREIGN KEY (tenant_id, project_id, job_id, publishing_attempt)
    REFERENCES render_attempts(tenant_id, project_id, job_id, attempt) ON DELETE RESTRICT
);

CREATE TABLE render_artifacts (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  result_id uuid NOT NULL,
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  schema_version text NOT NULL CHECK (schema_version = 'c14-render-artifact-v1'),
  role text NOT NULL CHECK (role IN (
    'geometry-safe-png', 'multilayer-exr', 'depth-exr', 'normal-exr', 'segmentation-png'
  )),
  media_type text NOT NULL CHECK (media_type IN ('image/png', 'image/x-exr')),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  byte_length bigint NOT NULL CHECK (byte_length BETWEEN 1 AND 2147483648),
  width_px integer NOT NULL CHECK (width_px BETWEEN 1 AND 4096),
  height_px integer NOT NULL CHECK (height_px BETWEEN 1 AND 4096),
  object_key text NOT NULL CHECK (
    object_key ~ '^render-stills/sha256/[0-9a-f]{2}/[0-9a-f]{64}[.](png|exr|json)$'
  ),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, id),
  UNIQUE (tenant_id, project_id, result_id, role),
  FOREIGN KEY (tenant_id, project_id, result_id, manifest_sha256)
    REFERENCES render_results(tenant_id, project_id, id, manifest_sha256) ON DELETE RESTRICT,
  CHECK ((role LIKE '%-png' AND media_type = 'image/png') OR (role LIKE '%-exr' AND media_type = 'image/x-exr'))
);

CREATE INDEX render_artifacts_result_idx ON render_artifacts (tenant_id, project_id, result_id, role);

ALTER TABLE render_jobs ADD CONSTRAINT render_jobs_result_fk
  FOREIGN KEY (tenant_id, project_id, result_id)
  REFERENCES render_results(tenant_id, project_id, id)
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE render_cache_entries (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  cache_identity_sha256 text NOT NULL CHECK (cache_identity_sha256 ~ '^[0-9a-f]{64}$'),
  result_id uuid NOT NULL,
  source_scene_glb_sha256 text NOT NULL CHECK (source_scene_glb_sha256 ~ '^[0-9a-f]{64}$'),
  source_scene_manifest_sha256 text NOT NULL CHECK (source_scene_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  specification_revision_sha256 text,
  profile_id text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, cache_identity_sha256),
  UNIQUE (tenant_id, project_id, result_id),
  FOREIGN KEY (tenant_id, project_id, result_id)
    REFERENCES render_results(tenant_id, project_id, id) ON DELETE RESTRICT
);

CREATE TABLE render_enhancement_jobs (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  render_job_id uuid NOT NULL,
  base_result_id uuid NOT NULL,
  base_artifact_sha256 text NOT NULL CHECK (base_artifact_sha256 ~ '^[0-9a-f]{64}$'),
  attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 3),
  state text NOT NULL CHECK (state IN (
    'queued', 'running', 'succeeded', 'disabled', 'rejected', 'failed', 'cancelled'
  )),
  safe_code text CHECK (safe_code IS NULL OR safe_code ~ '^[A-Z][A-Z0-9_]{2,79}$'),
  created_by uuid NOT NULL REFERENCES identity_users(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  PRIMARY KEY (tenant_id, project_id, id),
  UNIQUE (tenant_id, project_id, render_job_id),
  FOREIGN KEY (tenant_id, project_id, render_job_id)
    REFERENCES render_jobs(tenant_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, base_result_id)
    REFERENCES render_results(tenant_id, project_id, id) ON DELETE RESTRICT,
  CHECK ((state IN ('disabled', 'rejected', 'failed')) = (safe_code IS NOT NULL)),
  CHECK (updated_at >= created_at)
);

CREATE TABLE render_enhancement_results (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  enhancement_job_id uuid NOT NULL,
  result_payload jsonb NOT NULL CHECK (
    jsonb_typeof(result_payload) = 'object'
    AND pg_column_size(result_payload) <= 262144
    AND result_payload ->> 'schemaVersion' = 'c14-enhancement-result-v1'
    AND result_payload ->> 'state' IN ('succeeded', 'rejected', 'failed')
  ),
  result_sha256 text NOT NULL CHECK (result_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, enhancement_job_id),
  FOREIGN KEY (tenant_id, project_id, enhancement_job_id)
    REFERENCES render_enhancement_jobs(tenant_id, project_id, id) ON DELETE RESTRICT
);

CREATE TABLE render_enhancement_artifacts (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  enhancement_job_id uuid NOT NULL,
  role text NOT NULL CHECK (role = 'illustrative-enhancement-png'),
  media_type text NOT NULL CHECK (media_type = 'image/png'),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  byte_length bigint NOT NULL CHECK (byte_length BETWEEN 1 AND 2147483648),
  width_px integer NOT NULL CHECK (width_px BETWEEN 1 AND 4096),
  height_px integer NOT NULL CHECK (height_px BETWEEN 1 AND 4096),
  object_key text NOT NULL CHECK (
    object_key ~ '^render-stills/sha256/[0-9a-f]{2}/[0-9a-f]{64}[.]png$'
  ),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, id),
  UNIQUE (tenant_id, project_id, enhancement_job_id),
  FOREIGN KEY (tenant_id, project_id, enhancement_job_id)
    REFERENCES render_enhancement_results(tenant_id, project_id, enhancement_job_id) ON DELETE RESTRICT
);

CREATE TABLE render_idempotency_effects (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  actor_user_id uuid NOT NULL REFERENCES identity_users(id),
  operation text NOT NULL CHECK (operation IN (
    'render.job.create', 'render.job.cancel', 'render.job.retry', 'render.enhancement.request'
  )),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  response_payload jsonb,
  response_status integer CHECK (response_status IN (200, 201)),
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  PRIMARY KEY (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  CHECK (
    (response_payload IS NULL AND response_status IS NULL AND completed_at IS NULL)
    OR
    (jsonb_typeof(response_payload) = 'object' AND pg_column_size(response_payload) <= 65536
      AND response_status IS NOT NULL AND completed_at IS NOT NULL)
  )
);

CREATE INDEX render_idempotency_project_idx
  ON render_idempotency_effects (tenant_id, project_id, created_at, idempotency_key);

CREATE TABLE render_audit_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid NOT NULL,
  result_id uuid,
  action text NOT NULL CHECK (action ~ '^render[.][a-z0-9.-]{2,100}$'),
  actor_user_id uuid REFERENCES identity_users(id),
  worker_id text CHECK (
    worker_id IS NULL OR (
      char_length(worker_id) BETWEEN 3 AND 100 AND worker_id ~ '^[A-Za-z0-9_.:-]+$'
    )
  ),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  trace_id text NOT NULL CHECK (trace_id ~ '^[0-9a-f]{32}$'),
  metadata jsonb NOT NULL CHECK (
    jsonb_typeof(metadata) = 'object' AND pg_column_size(metadata) <= 8192
    AND NOT metadata ?| ARRAY[
      'address', 'notes', 'schedule', 'rights', 'licence', 'request', 'source', 'manifest',
      'artifacts', 'bytes', 'path', 'objectKey', 'url', 'signedUrl', 'stdout', 'stderr',
      'leaseToken', 'token', 'credential', 'provider'
    ]
  ),
  occurred_at timestamptz NOT NULL,
  CHECK ((actor_user_id IS NOT NULL)::integer + (worker_id IS NOT NULL)::integer = 1),
  FOREIGN KEY (tenant_id, project_id, job_id)
    REFERENCES render_jobs(tenant_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, result_id)
    REFERENCES render_results(tenant_id, project_id, id) ON DELETE RESTRICT
);

CREATE INDEX render_audit_job_idx
  ON render_audit_events (tenant_id, project_id, job_id, occurred_at, id);

CREATE TABLE render_outbox (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type ~ '^render[.][a-z0-9.-]{2,100}$'),
  schema_version text NOT NULL CHECK (schema_version = 'c14-render-job-v1'),
  payload jsonb NOT NULL CHECK (
    jsonb_typeof(payload) = 'object' AND pg_column_size(payload) <= 8192
    AND NOT payload ?| ARRAY[
      'address', 'notes', 'schedule', 'rights', 'licence', 'request', 'source', 'manifest',
      'artifacts', 'bytes', 'path', 'objectKey', 'url', 'signedUrl', 'stdout', 'stderr',
      'leaseToken', 'token', 'credential', 'provider'
    ]
  ),
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, project_id, job_id)
    REFERENCES render_jobs(tenant_id, project_id, id) ON DELETE RESTRICT
);

CREATE INDEX render_outbox_poll_idx ON render_outbox (occurred_at, id);

CREATE OR REPLACE FUNCTION c14_reject_append_only_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE OR REPLACE FUNCTION c14_validate_job_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'render jobs cannot be deleted'; END IF;
  IF OLD.state = 'succeeded' THEN RAISE EXCEPTION 'published render jobs are immutable'; END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.id IS DISTINCT FROM NEW.id OR OLD.request_payload IS DISTINCT FROM NEW.request_payload
    OR OLD.request_sha256 IS DISTINCT FROM NEW.request_sha256
    OR OLD.cache_identity_sha256 IS DISTINCT FROM NEW.cache_identity_sha256
    OR OLD.source_payload IS DISTINCT FROM NEW.source_payload
    OR OLD.source_scene_job_id IS DISTINCT FROM NEW.source_scene_job_id
    OR OLD.source_scene_id IS DISTINCT FROM NEW.source_scene_id
    OR OLD.source_scene_artifact_id IS DISTINCT FROM NEW.source_scene_artifact_id
    OR OLD.source_scene_glb_sha256 IS DISTINCT FROM NEW.source_scene_glb_sha256
    OR OLD.source_scene_manifest_sha256 IS DISTINCT FROM NEW.source_scene_manifest_sha256
    OR OLD.source_snapshot_sha256 IS DISTINCT FROM NEW.source_snapshot_sha256
    OR OLD.specification_id IS DISTINCT FROM NEW.specification_id
    OR OLD.specification_revision IS DISTINCT FROM NEW.specification_revision
    OR OLD.specification_revision_sha256 IS DISTINCT FROM NEW.specification_revision_sha256
    OR OLD.catalog_release_id IS DISTINCT FROM NEW.catalog_release_id
    OR OLD.catalog_release_sha256 IS DISTINCT FROM NEW.catalog_release_sha256
    OR OLD.required_capability IS DISTINCT FROM NEW.required_capability
    OR OLD.estimated_job_bytes IS DISTINCT FROM NEW.estimated_job_bytes
    OR OLD.enhancement_provider_enabled IS DISTINCT FROM NEW.enhancement_provider_enabled
    OR OLD.publication_result_id IS DISTINCT FROM NEW.publication_result_id
    OR OLD.created_by IS DISTINCT FROM NEW.created_by OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR NEW.version <> OLD.version + 1 OR NEW.updated_at <= OLD.updated_at
  THEN RAISE EXCEPTION 'render job identity is immutable'; END IF;
  IF NOT (
    (OLD.state = 'queued' AND NEW.state IN ('preparing', 'cancelled', 'failed'))
    OR (OLD.state = 'preparing' AND NEW.state IN ('preparing', 'rendering-safe', 'cancel-requested', 'failed'))
    OR (OLD.state = 'rendering-safe' AND NEW.state IN ('rendering-safe', 'validating-safe', 'cancel-requested', 'failed'))
    OR (OLD.state = 'validating-safe' AND NEW.state IN ('validating-safe', 'publishing-safe', 'cancel-requested', 'failed'))
    OR (OLD.state = 'publishing-safe' AND NEW.state IN ('publishing-safe', 'succeeded', 'cancel-requested', 'failed'))
    OR (OLD.state = 'cancel-requested' AND NEW.state IN ('cancelled', 'failed'))
    OR (OLD.state IN ('cancelled', 'failed') AND NEW.state = 'queued' AND NEW.attempt = OLD.attempt + 1)
  ) THEN RAISE EXCEPTION 'illegal render job transition from % to %', OLD.state, NEW.state; END IF;
  IF NEW.attempt <> OLD.attempt AND NOT (
    OLD.state IN ('cancelled', 'failed') AND NEW.state = 'queued' AND NEW.attempt = OLD.attempt + 1
  ) THEN RAISE EXCEPTION 'render attempt changed outside retry'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION c14_validate_attempt_head()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'render attempt heads cannot be deleted'; END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.job_id IS DISTINCT FROM NEW.job_id OR OLD.attempt IS DISTINCT FROM NEW.attempt
    OR OLD.created_at IS DISTINCT FROM NEW.created_at OR NEW.fence_version <> OLD.fence_version + 1
    OR NEW.updated_at <= OLD.updated_at
  THEN RAISE EXCEPTION 'render attempt head identity is immutable'; END IF;
  IF OLD.state IN ('cancelled', 'succeeded', 'failed') THEN
    RAISE EXCEPTION 'terminal render attempt heads are immutable';
  END IF;
  IF NEW.stage IS DISTINCT FROM OLD.stage AND NOT (
    (OLD.stage = 'preparing' AND NEW.stage = 'rendering-safe')
    OR (OLD.stage = 'rendering-safe' AND NEW.stage = 'validating-safe')
    OR (OLD.stage = 'validating-safe' AND NEW.stage = 'publishing-safe')
  ) THEN RAISE EXCEPTION 'illegal render stage transition from % to %', OLD.stage, NEW.stage; END IF;
  IF NOT (
    (OLD.state = 'queued' AND NEW.state IN ('leased', 'cancelled', 'failed'))
    OR (OLD.state = 'leased' AND NEW.state IN ('leased', 'cancel-requested', 'succeeded', 'failed'))
    OR (OLD.state = 'cancel-requested' AND NEW.state IN ('cancelled', 'failed'))
  ) THEN RAISE EXCEPTION 'illegal render lease transition from % to %', OLD.state, NEW.state; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION c14_validate_idempotency_completion()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'render idempotency effects cannot be deleted'; END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key
    OR OLD.actor_user_id IS DISTINCT FROM NEW.actor_user_id OR OLD.operation IS DISTINCT FROM NEW.operation
    OR OLD.request_sha256 IS DISTINCT FROM NEW.request_sha256 OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR OLD.completed_at IS NOT NULL OR NEW.completed_at IS NULL
  THEN RAISE EXCEPTION 'invalid render idempotency completion'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION c14_validate_enhancement_job()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'render enhancement jobs cannot be deleted'; END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.id IS DISTINCT FROM NEW.id OR OLD.render_job_id IS DISTINCT FROM NEW.render_job_id
    OR OLD.base_result_id IS DISTINCT FROM NEW.base_result_id
    OR OLD.base_artifact_sha256 IS DISTINCT FROM NEW.base_artifact_sha256
    OR OLD.created_by IS DISTINCT FROM NEW.created_by OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR NEW.version <> OLD.version + 1 OR NEW.updated_at <= OLD.updated_at
  THEN RAISE EXCEPTION 'render enhancement job identity is immutable'; END IF;
  IF NOT (
    (OLD.state = 'disabled' AND NEW.state = 'queued' AND NEW.attempt = OLD.attempt)
    OR (OLD.state = 'queued' AND NEW.state IN ('running', 'failed', 'cancelled')
      AND NEW.attempt = OLD.attempt)
    OR (OLD.state = 'running' AND NEW.state IN ('succeeded', 'rejected', 'failed', 'cancelled')
      AND NEW.attempt = OLD.attempt)
    OR (OLD.state = 'failed' AND NEW.state = 'queued' AND NEW.attempt = OLD.attempt + 1)
  ) THEN RAISE EXCEPTION 'illegal render enhancement transition from % to %', OLD.state, NEW.state; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER render_jobs_validate BEFORE UPDATE OR DELETE ON render_jobs
FOR EACH ROW EXECUTE FUNCTION c14_validate_job_mutation();
CREATE TRIGGER render_attempt_heads_validate BEFORE UPDATE OR DELETE ON render_attempt_heads
FOR EACH ROW EXECUTE FUNCTION c14_validate_attempt_head();
CREATE TRIGGER render_idempotency_validate BEFORE UPDATE OR DELETE ON render_idempotency_effects
FOR EACH ROW EXECUTE FUNCTION c14_validate_idempotency_completion();
CREATE TRIGGER render_enhancement_jobs_validate BEFORE UPDATE OR DELETE ON render_enhancement_jobs
FOR EACH ROW EXECUTE FUNCTION c14_validate_enhancement_job();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'render_attempts', 'render_attempt_events', 'render_disk_reservations',
    'render_disk_reservation_releases', 'render_results', 'render_artifacts',
    'render_cache_entries', 'render_enhancement_results', 'render_enhancement_artifacts',
    'render_audit_events', 'render_outbox'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION c14_reject_append_only_mutation()',
      table_name, table_name
    );
  END LOOP;
END
$$;

-- Cross-tenant queue discovery is exposed only through this capability/disk-constrained claim hook.
-- PUBLIC receives no execution grant; integration must grant it to the named non-login worker role.
CREATE OR REPLACE FUNCTION c14_claim_render_job(
  requested_worker_id text,
  requested_capabilities text[],
  requested_volume_id text,
  observed_free_bytes bigint,
  requested_lease_seconds integer
) RETURNS TABLE (
  tenant_id uuid, project_id uuid, job_id uuid, attempt integer, request_payload jsonb,
  source_payload jsonb, cache_identity_sha256 text, estimated_job_bytes bigint,
  required_capability text, publication_result_id uuid, lease_token uuid,
  lease_expires_at timestamptz, stage text, volume_id text
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  candidate record;
  active_reserved bigint;
  required_unreserved bigint;
  issued_token uuid;
  reservation_id uuid;
  reservation_volume_id text;
  timestamp_value timestamptz := clock_timestamp();
BEGIN
  IF requested_worker_id !~ '^[A-Za-z0-9_.:-]{3,100}$'
    OR requested_volume_id !~ '^[A-Za-z0-9_.:-]{3,120}$'
    OR requested_lease_seconds NOT BETWEEN 30 AND 3600
    OR observed_free_bytes < 0
    OR cardinality(requested_capabilities) NOT BETWEEN 1 AND 32
    OR EXISTS (
      SELECT 1 FROM unnest(requested_capabilities) capability
      WHERE capability !~ '^[A-Za-z0-9_.:+-]{3,120}$'
    )
  THEN RAISE EXCEPTION 'invalid constrained render claim'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('c14:' || requested_volume_id, 14));
  SELECT COALESCE(sum(r.estimated_job_bytes), 0) INTO active_reserved
  FROM render_disk_reservations r
  LEFT JOIN render_disk_reservation_releases x ON x.reservation_id = r.id
  WHERE r.volume_id = requested_volume_id AND x.reservation_id IS NULL;

  SELECT j.*, h.state AS attempt_state, h.stage AS attempt_stage,
    h.lease_expires_at AS attempt_lease_expires_at,
    h.fence_version AS attempt_fence_version
  INTO candidate
  FROM render_jobs j
  JOIN render_attempt_heads h ON h.tenant_id = j.tenant_id AND h.project_id = j.project_id
    AND h.job_id = j.id AND h.attempt = j.attempt
  WHERE j.required_capability = ANY(requested_capabilities)
    AND (
      (j.state = 'queued' AND h.state = 'queued')
      OR
      (j.state IN ('preparing', 'rendering-safe', 'validating-safe', 'publishing-safe')
        AND h.state = 'leased' AND h.lease_expires_at <= timestamp_value
        AND EXISTS (
          SELECT 1 FROM render_disk_reservations stale_reservation
          LEFT JOIN render_disk_reservation_releases stale_release
            ON stale_release.reservation_id = stale_reservation.id
          WHERE stale_reservation.tenant_id = j.tenant_id
            AND stale_reservation.project_id = j.project_id
            AND stale_reservation.job_id = j.id
            AND stale_reservation.attempt = j.attempt
            AND stale_reservation.volume_id = requested_volume_id
            AND stale_release.reservation_id IS NULL
        ))
      OR
      (j.state = 'cancel-requested' AND h.state = 'cancel-requested'
        AND h.lease_expires_at <= timestamp_value)
    )
  ORDER BY (j.state <> 'queued'), j.created_at, j.id
  LIMIT 1 FOR UPDATE OF j, h SKIP LOCKED;

  IF candidate.id IS NULL THEN RETURN; END IF;
  IF candidate.state = 'cancel-requested' THEN
    UPDATE render_attempt_heads SET state = 'cancelled', lease_owner = NULL, lease_token = NULL,
      lease_expires_at = NULL, lease_seconds = NULL, fence_version = fence_version + 1,
      updated_at = timestamp_value
    WHERE render_attempt_heads.tenant_id = candidate.tenant_id
      AND render_attempt_heads.project_id = candidate.project_id
      AND render_attempt_heads.job_id = candidate.id AND render_attempt_heads.attempt = candidate.attempt;
    UPDATE render_jobs SET state = 'cancelled', retryable = true, version = version + 1,
      updated_at = timestamp_value
    WHERE render_jobs.tenant_id = candidate.tenant_id AND render_jobs.project_id = candidate.project_id
      AND render_jobs.id = candidate.id;
    INSERT INTO render_disk_reservation_releases (
      reservation_id, tenant_id, project_id, job_id, attempt, terminal_state, released_at
    ) SELECT r.id, r.tenant_id, r.project_id, r.job_id, r.attempt, 'cancelled', timestamp_value
      FROM render_disk_reservations r
      LEFT JOIN render_disk_reservation_releases x ON x.reservation_id = r.id
      WHERE r.tenant_id = candidate.tenant_id AND r.project_id = candidate.project_id
        AND r.job_id = candidate.id AND r.attempt = candidate.attempt AND x.reservation_id IS NULL;
    RETURN;
  END IF;

  required_unreserved := GREATEST(16106127360 + candidate.estimated_job_bytes,
    3 * candidate.estimated_job_bytes);
  SELECT r.id, r.volume_id INTO reservation_id, reservation_volume_id
    FROM render_disk_reservations r
    LEFT JOIN render_disk_reservation_releases x ON x.reservation_id = r.id
    WHERE r.tenant_id = candidate.tenant_id AND r.project_id = candidate.project_id
      AND r.job_id = candidate.id AND r.attempt = candidate.attempt AND x.reservation_id IS NULL;
  IF reservation_id IS NULL THEN
    IF observed_free_bytes - active_reserved < required_unreserved THEN RETURN; END IF;
    reservation_id := gen_random_uuid();
    INSERT INTO render_disk_reservations (
      id, tenant_id, project_id, job_id, attempt, volume_id, estimated_job_bytes,
      observed_free_bytes, required_unreserved_bytes, reserved_at
    ) VALUES (
      reservation_id, candidate.tenant_id, candidate.project_id, candidate.id, candidate.attempt,
      requested_volume_id, candidate.estimated_job_bytes, observed_free_bytes,
      required_unreserved, timestamp_value
    );
  ELSE
    IF reservation_volume_id <> requested_volume_id
      OR observed_free_bytes - (active_reserved - candidate.estimated_job_bytes) < required_unreserved
    THEN RETURN; END IF;
  END IF;

  issued_token := gen_random_uuid();
  UPDATE render_attempt_heads SET state = 'leased', lease_owner = requested_worker_id,
    lease_token = issued_token, lease_expires_at = timestamp_value + requested_lease_seconds * interval '1 second',
    lease_seconds = requested_lease_seconds, fence_version = fence_version + 1,
    updated_at = timestamp_value
  WHERE render_attempt_heads.tenant_id = candidate.tenant_id
    AND render_attempt_heads.project_id = candidate.project_id
    AND render_attempt_heads.job_id = candidate.id AND render_attempt_heads.attempt = candidate.attempt;
  UPDATE render_jobs SET state = candidate.attempt_stage, version = version + 1,
    updated_at = timestamp_value
  WHERE render_jobs.tenant_id = candidate.tenant_id AND render_jobs.project_id = candidate.project_id
    AND render_jobs.id = candidate.id;
  INSERT INTO render_attempt_events (
    id, tenant_id, project_id, job_id, attempt, fence_version, state, stage, worker_id, occurred_at
  ) VALUES (
    gen_random_uuid(), candidate.tenant_id, candidate.project_id, candidate.id, candidate.attempt,
    candidate.attempt_fence_version + 1, 'leased', candidate.attempt_stage, requested_worker_id, timestamp_value
  );

  RETURN QUERY SELECT candidate.tenant_id, candidate.project_id, candidate.id, candidate.attempt,
    candidate.request_payload, candidate.source_payload, candidate.cache_identity_sha256,
    candidate.estimated_job_bytes, candidate.required_capability, candidate.publication_result_id,
    issued_token, timestamp_value + requested_lease_seconds * interval '1 second',
    candidate.attempt_stage, requested_volume_id;
END;
$$;

REVOKE ALL ON FUNCTION c14_claim_render_job(text, text[], text, bigint, integer) FROM PUBLIC;

CREATE OR REPLACE FUNCTION c14_recheck_disk_reservation(
  requested_tenant uuid,
  requested_project uuid,
  requested_job uuid,
  requested_attempt integer,
  requested_lease_token uuid,
  observed_free_bytes bigint
) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM render_attempt_heads h
    JOIN render_disk_reservations own
      ON own.tenant_id = h.tenant_id AND own.project_id = h.project_id
      AND own.job_id = h.job_id AND own.attempt = h.attempt
    LEFT JOIN render_disk_reservation_releases own_release ON own_release.reservation_id = own.id
    WHERE h.tenant_id = requested_tenant AND h.project_id = requested_project
      AND h.job_id = requested_job AND h.attempt = requested_attempt
      AND h.state = 'leased' AND h.lease_token = requested_lease_token
      AND h.lease_expires_at > clock_timestamp() AND own_release.reservation_id IS NULL
      AND observed_free_bytes - COALESCE((
        SELECT sum(other.estimated_job_bytes)
        FROM render_disk_reservations other
        LEFT JOIN render_disk_reservation_releases released ON released.reservation_id = other.id
        WHERE other.volume_id = own.volume_id AND released.reservation_id IS NULL
          AND other.id <> own.id
      ), 0) >= GREATEST(16106127360 + own.estimated_job_bytes, 3 * own.estimated_job_bytes)
  )
$$;

-- FORCE protects even accidental table-owner execution. User paths set app.tenant_id locally;
-- only the revoked, constrained claim function may discover work across tenants.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'render_jobs', 'render_attempts', 'render_attempt_heads', 'render_attempt_events',
    'render_disk_reservations', 'render_disk_reservation_releases', 'render_results',
    'render_artifacts', 'render_cache_entries', 'render_enhancement_jobs',
    'render_enhancement_results', 'render_enhancement_artifacts',
    'render_idempotency_effects', 'render_audit_events', 'render_outbox'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I_tenant_policy ON %I USING (tenant_id = c14_current_tenant_id()) WITH CHECK (tenant_id = c14_current_tenant_id())',
      table_name, table_name
    );
  END LOOP;
END
$$;

INSERT INTO platform_schema_migrations (id)
VALUES ('0014_render_stills')
ON CONFLICT (id) DO NOTHING;
