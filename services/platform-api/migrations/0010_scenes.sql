DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform_schema_migrations WHERE id = '0009_model_fusion') THEN
    RAISE EXCEPTION 'C10 requires migration 0009_model_fusion';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION c10_snapshot_is_committed(
  requested_tenant uuid,
  requested_project uuid,
  requested_model uuid,
  requested_profile text,
  requested_snapshot uuid,
  requested_sha256 text
) RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM canonical_model_snapshots s
    WHERE s.tenant_id = requested_tenant
      AND s.project_id = requested_project
      AND s.model_id = requested_model
      AND s.profile = requested_profile
      AND s.id = requested_snapshot
      AND s.snapshot_sha256 = requested_sha256
      AND (
        EXISTS (
          SELECT 1 FROM canonical_model_profiles p
          WHERE p.tenant_id = s.tenant_id AND p.project_id = s.project_id
            AND p.model_id = s.model_id AND p.profile = s.profile
            AND p.current_snapshot_id = s.id AND p.current_snapshot_sha256 = s.snapshot_sha256
        )
        OR EXISTS (
          SELECT 1 FROM canonical_model_idempotency i
          WHERE i.tenant_id = s.tenant_id AND i.project_id = s.project_id
            AND i.profile = s.profile AND i.response_snapshot_id = s.id
            AND i.completed_at IS NOT NULL
        )
        OR EXISTS (
          SELECT 1 FROM model_branches b
          WHERE b.tenant_id = s.tenant_id AND b.project_id = s.project_id
            AND b.model_id = s.model_id AND b.profile = s.profile
            AND (
              (b.source_snapshot_id = s.id AND b.source_snapshot_sha256 = s.snapshot_sha256)
              OR (b.head_snapshot_id = s.id AND b.head_snapshot_sha256 = s.snapshot_sha256)
            )
        )
        OR EXISTS (
          SELECT 1 FROM model_operation_commits c
          WHERE c.tenant_id = s.tenant_id AND c.project_id = s.project_id
            AND c.model_id = s.model_id AND c.profile = s.profile
            AND c.snapshot_id = s.id AND c.snapshot_sha256 = s.snapshot_sha256
        )
      )
  );
$$;

CREATE TABLE IF NOT EXISTS scene_jobs (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  request_payload jsonb NOT NULL CHECK (
    jsonb_typeof(request_payload) = 'object'
    AND request_payload -> 'sourceSnapshot' ->> 'schemaVersion' = 'c4-canonical-home-v1'
    AND request_payload -> 'configuration' ->> 'geometryMode' = 'parametric-v1'
    AND request_payload -> 'configuration' ->> 'coordinateMapping' = 'c4-z-up-to-gltf-y-up-v1'
    AND request_payload -> 'configuration' ->> 'materialMode' = 'status-aware-neutral-v1'
    AND request_payload -> 'configuration' ->> 'purpose' = 'interactive-browser'
    AND request_payload -> 'configuration' ->> 'unknownGeometryPolicy' = 'omit-and-report'
  ),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  cache_key_sha256 text NOT NULL CHECK (cache_key_sha256 ~ '^[0-9a-f]{64}$'),
  configuration_sha256 text NOT NULL CHECK (configuration_sha256 ~ '^[0-9a-f]{64}$'),
  compiler_name text NOT NULL CHECK (compiler_name = 'interior-design-scene-compiler'),
  compiler_version text NOT NULL CHECK (
    char_length(compiler_version) BETWEEN 1 AND 100
    AND compiler_version ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,99}$'
  ),
  source_model_id uuid NOT NULL,
  source_profile text NOT NULL CHECK (source_profile IN ('existing', 'proposed', 'as-built')),
  source_snapshot_id uuid NOT NULL,
  source_snapshot_sha256 text NOT NULL CHECK (source_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  source_snapshot_version integer NOT NULL CHECK (source_snapshot_version >= 1),
  source_schema_version text NOT NULL CHECK (source_schema_version = 'c4-canonical-home-v1'),
  attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 3),
  state text NOT NULL CHECK (state IN (
    'queued', 'leased', 'compiling', 'publishing', 'succeeded',
    'cancel-requested', 'cancelled', 'failed'
  )),
  scene_id uuid,
  retryable boolean NOT NULL DEFAULT false,
  safe_code text CHECK (safe_code IS NULL OR safe_code ~ '^[A-Z][A-Z0-9_]{2,79}$'),
  created_by uuid NOT NULL REFERENCES identity_users(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  PRIMARY KEY (tenant_id, project_id, id),
  UNIQUE (tenant_id, project_id, cache_key_sha256),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (
    tenant_id, project_id, source_model_id, source_profile,
    source_snapshot_id, source_snapshot_sha256, source_snapshot_version
  ) REFERENCES canonical_model_snapshots (
    tenant_id, project_id, model_id, profile, id, snapshot_sha256, version
  ) ON DELETE RESTRICT,
  CONSTRAINT scene_jobs_request_scope CHECK (
    request_payload -> 'sourceSnapshot' ->> 'projectId' = project_id::text
    AND request_payload -> 'sourceSnapshot' ->> 'modelId' = source_model_id::text
    AND request_payload -> 'sourceSnapshot' ->> 'profile' = source_profile
    AND request_payload -> 'sourceSnapshot' ->> 'snapshotId' = source_snapshot_id::text
    AND request_payload -> 'sourceSnapshot' ->> 'snapshotSha256' = source_snapshot_sha256
    AND request_payload -> 'sourceSnapshot' ->> 'schemaVersion' = source_schema_version
  ),
  CONSTRAINT scene_jobs_scene_state CHECK ((state = 'succeeded') = (scene_id IS NOT NULL)),
  CONSTRAINT scene_jobs_safe_state CHECK ((state = 'failed') = (safe_code IS NOT NULL)),
  CONSTRAINT scene_jobs_retryable_state CHECK (NOT retryable OR state IN ('cancelled', 'failed'))
);

CREATE INDEX IF NOT EXISTS scene_jobs_list_idx
  ON scene_jobs (tenant_id, project_id, created_at DESC, id);
CREATE INDEX IF NOT EXISTS scene_jobs_queue_idx
  ON scene_jobs (compiler_name, compiler_version, created_at, id)
  WHERE state IN ('queued', 'leased', 'compiling', 'publishing', 'cancel-requested');
CREATE INDEX IF NOT EXISTS scene_jobs_source_idx
  ON scene_jobs (tenant_id, project_id, source_model_id, source_profile, source_snapshot_id);

CREATE TABLE IF NOT EXISTS scene_attempts (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid NOT NULL,
  attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 3),
  state text NOT NULL CHECK (state IN (
    'queued', 'leased', 'cancel-requested', 'cancelled', 'succeeded', 'failed'
  )),
  stage text NOT NULL CHECK (stage IN ('leased', 'compiling', 'publishing')),
  lease_owner text CHECK (
    lease_owner IS NULL OR (
      char_length(lease_owner) BETWEEN 3 AND 100
      AND lease_owner ~ '^[A-Za-z0-9_.:-]+$'
    )
  ),
  lease_token uuid,
  lease_expires_at timestamptz,
  lease_seconds integer CHECK (lease_seconds IS NULL OR lease_seconds BETWEEN 30 AND 3600),
  fence_version integer NOT NULL DEFAULT 0 CHECK (fence_version >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, job_id, attempt),
  FOREIGN KEY (tenant_id, project_id, job_id)
    REFERENCES scene_jobs(tenant_id, project_id, id) ON DELETE RESTRICT,
  CONSTRAINT scene_attempts_lease_state CHECK (
    ((state IN ('leased', 'cancel-requested')) =
      (lease_owner IS NOT NULL AND lease_token IS NOT NULL
        AND lease_expires_at IS NOT NULL AND lease_seconds IS NOT NULL))
  )
);

CREATE INDEX IF NOT EXISTS scene_attempts_lease_idx
  ON scene_attempts (state, lease_expires_at, created_at, job_id)
  WHERE state IN ('queued', 'leased', 'cancel-requested');

CREATE TABLE IF NOT EXISTS scene_artifacts (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  schema_version text NOT NULL CHECK (schema_version = 'c10-scene-artifact-v1'),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 52428800),
  glb_sha256 text NOT NULL CHECK (glb_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  mime_type text NOT NULL CHECK (mime_type = 'model/gltf-binary'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, id),
  UNIQUE (tenant_id, project_id, glb_sha256, manifest_sha256),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS scenes (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  publishing_job_id uuid NOT NULL,
  publishing_attempt integer NOT NULL CHECK (publishing_attempt BETWEEN 1 AND 3),
  artifact_id uuid NOT NULL,
  cache_key_sha256 text NOT NULL CHECK (cache_key_sha256 ~ '^[0-9a-f]{64}$'),
  source_model_id uuid NOT NULL,
  source_profile text NOT NULL CHECK (source_profile IN ('existing', 'proposed', 'as-built')),
  source_snapshot_id uuid NOT NULL,
  source_snapshot_sha256 text NOT NULL CHECK (source_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  source_snapshot_version integer NOT NULL CHECK (source_snapshot_version >= 1),
  manifest_payload jsonb NOT NULL CHECK (
    jsonb_typeof(manifest_payload) = 'object'
    AND manifest_payload ->> 'schemaVersion' = 'c10-scene-manifest-v1'
    AND manifest_payload ->> 'authority' = 'derived-visualisation-only'
    AND manifest_payload -> 'sourceSnapshot' ->> 'projectId' = project_id::text
    AND manifest_payload -> 'sourceSnapshot' ->> 'modelId' = source_model_id::text
    AND manifest_payload -> 'sourceSnapshot' ->> 'profile' = source_profile
    AND manifest_payload -> 'sourceSnapshot' ->> 'snapshotId' = source_snapshot_id::text
    AND manifest_payload -> 'sourceSnapshot' ->> 'snapshotSha256' = source_snapshot_sha256
  ),
  created_by uuid NOT NULL REFERENCES identity_users(id),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, id),
  UNIQUE (tenant_id, project_id, artifact_id),
  UNIQUE (tenant_id, project_id, publishing_job_id),
  UNIQUE (tenant_id, project_id, cache_key_sha256),
  FOREIGN KEY (tenant_id, project_id, publishing_job_id, publishing_attempt)
    REFERENCES scene_attempts(tenant_id, project_id, job_id, attempt) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, artifact_id)
    REFERENCES scene_artifacts(tenant_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (
    tenant_id, project_id, source_model_id, source_profile,
    source_snapshot_id, source_snapshot_sha256, source_snapshot_version
  ) REFERENCES canonical_model_snapshots (
    tenant_id, project_id, model_id, profile, id, snapshot_sha256, version
  ) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS scene_cache_entries (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  cache_key_sha256 text NOT NULL CHECK (cache_key_sha256 ~ '^[0-9a-f]{64}$'),
  scene_id uuid NOT NULL,
  source_snapshot_sha256 text NOT NULL CHECK (source_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  configuration_sha256 text NOT NULL CHECK (configuration_sha256 ~ '^[0-9a-f]{64}$'),
  compiler_name text NOT NULL CHECK (compiler_name = 'interior-design-scene-compiler'),
  compiler_version text NOT NULL CHECK (char_length(compiler_version) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, cache_key_sha256),
  UNIQUE (tenant_id, project_id, scene_id),
  FOREIGN KEY (tenant_id, project_id, scene_id)
    REFERENCES scenes(tenant_id, project_id, id) ON DELETE RESTRICT
);

ALTER TABLE scene_jobs DROP CONSTRAINT IF EXISTS scene_jobs_scene_fk;
ALTER TABLE scene_jobs ADD CONSTRAINT scene_jobs_scene_fk
  FOREIGN KEY (tenant_id, project_id, scene_id)
  REFERENCES scenes(tenant_id, project_id, id)
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS scene_audit_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid NOT NULL,
  scene_id uuid,
  action text NOT NULL CHECK (action ~ '^scene[.][a-z0-9.-]{2,100}$'),
  actor_user_id uuid REFERENCES identity_users(id),
  worker_id text CHECK (
    worker_id IS NULL OR (
      char_length(worker_id) BETWEEN 3 AND 100 AND worker_id ~ '^[A-Za-z0-9_.:-]+$'
    )
  ),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  trace_id text NOT NULL CHECK (trace_id ~ '^[0-9a-f]{32}$'),
  metadata jsonb NOT NULL CHECK (
    jsonb_typeof(metadata) = 'object'
    AND NOT metadata ?| ARRAY[
      'request', 'snapshot', 'canonicalSnapshot', 'manifest', 'glb', 'bytes',
      'objectKey', 'providerId', 'path', 'url', 'signedUrl', 'leaseToken',
      'token', 'credential', 'stdout', 'stderr'
    ]
  ),
  occurred_at timestamptz NOT NULL,
  CHECK ((actor_user_id IS NOT NULL)::integer + (worker_id IS NOT NULL)::integer = 1),
  FOREIGN KEY (tenant_id, project_id, job_id)
    REFERENCES scene_jobs(tenant_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, scene_id)
    REFERENCES scenes(tenant_id, project_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS scene_audit_job_idx
  ON scene_audit_events (tenant_id, project_id, job_id, occurred_at, id);
CREATE INDEX IF NOT EXISTS scene_audit_scene_idx
  ON scene_audit_events (tenant_id, project_id, scene_id, occurred_at, id)
  WHERE scene_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS scene_outbox (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type ~ '^scene[.][a-z0-9.-]{2,100}$'),
  schema_version text NOT NULL CHECK (schema_version = 'c10-scene-job-v1'),
  payload jsonb NOT NULL CHECK (
    jsonb_typeof(payload) = 'object'
    AND NOT payload ?| ARRAY[
      'request', 'snapshot', 'canonicalSnapshot', 'manifest', 'glb', 'bytes',
      'objectKey', 'providerId', 'path', 'url', 'signedUrl', 'leaseToken',
      'token', 'credential', 'stdout', 'stderr'
    ]
  ),
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, project_id, job_id)
    REFERENCES scene_jobs(tenant_id, project_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS scene_outbox_poll_idx ON scene_outbox (occurred_at, id);

CREATE OR REPLACE FUNCTION c10_reject_append_only_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE OR REPLACE FUNCTION c10_validate_job_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'scene jobs cannot be deleted'; END IF;
  IF OLD.state = 'succeeded' THEN RAISE EXCEPTION 'published scene jobs are immutable'; END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.id IS DISTINCT FROM NEW.id
    OR OLD.request_payload IS DISTINCT FROM NEW.request_payload
    OR OLD.request_sha256 IS DISTINCT FROM NEW.request_sha256
    OR OLD.cache_key_sha256 IS DISTINCT FROM NEW.cache_key_sha256
    OR OLD.configuration_sha256 IS DISTINCT FROM NEW.configuration_sha256
    OR OLD.compiler_name IS DISTINCT FROM NEW.compiler_name
    OR OLD.compiler_version IS DISTINCT FROM NEW.compiler_version
    OR OLD.source_model_id IS DISTINCT FROM NEW.source_model_id
    OR OLD.source_profile IS DISTINCT FROM NEW.source_profile
    OR OLD.source_snapshot_id IS DISTINCT FROM NEW.source_snapshot_id
    OR OLD.source_snapshot_sha256 IS DISTINCT FROM NEW.source_snapshot_sha256
    OR OLD.source_snapshot_version IS DISTINCT FROM NEW.source_snapshot_version
    OR OLD.source_schema_version IS DISTINCT FROM NEW.source_schema_version
    OR OLD.created_by IS DISTINCT FROM NEW.created_by
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR NEW.version <> OLD.version + 1
    OR NEW.updated_at <= OLD.updated_at
  THEN RAISE EXCEPTION 'scene job identity is immutable'; END IF;
  IF NOT (
    (OLD.state = 'queued' AND NEW.state IN ('leased', 'cancelled', 'failed'))
    OR (OLD.state = 'leased' AND NEW.state IN ('leased', 'compiling', 'cancel-requested', 'failed'))
    OR (OLD.state = 'compiling' AND NEW.state IN ('compiling', 'publishing', 'cancel-requested', 'failed'))
    OR (OLD.state = 'publishing' AND NEW.state IN ('publishing', 'succeeded', 'cancel-requested', 'failed'))
    OR (OLD.state = 'cancel-requested' AND NEW.state IN ('cancelled', 'failed'))
    OR (OLD.state IN ('cancelled', 'failed')
      AND NEW.state = 'queued' AND NEW.attempt = OLD.attempt + 1)
  ) THEN RAISE EXCEPTION 'illegal scene job transition from % to %', OLD.state, NEW.state; END IF;
  IF NEW.attempt <> OLD.attempt AND NOT (
    OLD.state IN ('cancelled', 'failed')
    AND NEW.state = 'queued' AND NEW.attempt = OLD.attempt + 1
  ) THEN RAISE EXCEPTION 'scene attempt changed outside retry'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION c10_validate_attempt_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'scene attempts cannot be deleted'; END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.job_id IS DISTINCT FROM NEW.job_id
    OR OLD.attempt IS DISTINCT FROM NEW.attempt
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR NEW.fence_version <> OLD.fence_version + 1
    OR NEW.updated_at <= OLD.updated_at
  THEN RAISE EXCEPTION 'scene attempt identity is immutable'; END IF;
  IF OLD.state IN ('cancelled', 'succeeded', 'failed') THEN
    RAISE EXCEPTION 'terminal scene attempts are immutable';
  END IF;
  IF NEW.stage IS DISTINCT FROM OLD.stage AND NOT (
    (OLD.stage = 'leased' AND NEW.stage = 'compiling')
    OR (OLD.stage = 'compiling' AND NEW.stage = 'publishing')
  ) THEN RAISE EXCEPTION 'illegal scene attempt stage transition from % to %', OLD.stage, NEW.stage;
  END IF;
  IF NOT (
    (OLD.state = 'queued' AND NEW.state IN ('leased', 'cancelled', 'failed'))
    OR (OLD.state = 'leased' AND NEW.state IN ('leased', 'cancel-requested', 'succeeded', 'failed'))
    OR (OLD.state = 'cancel-requested' AND NEW.state IN ('cancelled', 'failed'))
  ) THEN RAISE EXCEPTION 'illegal scene attempt transition from % to %', OLD.state, NEW.state; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS scene_jobs_validate_mutation ON scene_jobs;
CREATE TRIGGER scene_jobs_validate_mutation BEFORE UPDATE OR DELETE ON scene_jobs
FOR EACH ROW EXECUTE FUNCTION c10_validate_job_mutation();
DROP TRIGGER IF EXISTS scene_attempts_validate_mutation ON scene_attempts;
CREATE TRIGGER scene_attempts_validate_mutation BEFORE UPDATE OR DELETE ON scene_attempts
FOR EACH ROW EXECUTE FUNCTION c10_validate_attempt_mutation();

DROP TRIGGER IF EXISTS scene_artifacts_append_only ON scene_artifacts;
CREATE TRIGGER scene_artifacts_append_only BEFORE UPDATE OR DELETE ON scene_artifacts
FOR EACH ROW EXECUTE FUNCTION c10_reject_append_only_mutation();
DROP TRIGGER IF EXISTS scenes_append_only ON scenes;
CREATE TRIGGER scenes_append_only BEFORE UPDATE OR DELETE ON scenes
FOR EACH ROW EXECUTE FUNCTION c10_reject_append_only_mutation();
DROP TRIGGER IF EXISTS scene_cache_entries_append_only ON scene_cache_entries;
CREATE TRIGGER scene_cache_entries_append_only BEFORE UPDATE OR DELETE ON scene_cache_entries
FOR EACH ROW EXECUTE FUNCTION c10_reject_append_only_mutation();
DROP TRIGGER IF EXISTS scene_audit_append_only ON scene_audit_events;
CREATE TRIGGER scene_audit_append_only BEFORE UPDATE OR DELETE ON scene_audit_events
FOR EACH ROW EXECUTE FUNCTION c10_reject_append_only_mutation();
DROP TRIGGER IF EXISTS scene_outbox_append_only ON scene_outbox;
CREATE TRIGGER scene_outbox_append_only BEFORE UPDATE OR DELETE ON scene_outbox
FOR EACH ROW EXECUTE FUNCTION c10_reject_append_only_mutation();

INSERT INTO platform_schema_migrations (id)
VALUES ('0010_scenes')
ON CONFLICT (id) DO NOTHING;
