DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform_schema_migrations WHERE id = '0002_assets_evidence') THEN
    RAISE EXCEPTION 'C8 requires migration 0002_assets_evidence';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform_schema_migrations WHERE id = '0007_native_capture') THEN
    RAISE EXCEPTION 'C8 requires migration 0007_native_capture';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS reconstruction_jobs (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  request_payload jsonb NOT NULL CHECK (
    jsonb_typeof(request_payload) = 'object'
    AND jsonb_typeof(request_payload -> 'rights') = 'object'
    AND request_payload -> 'rights' ->> 'trainingUseConsent' = 'denied'
    AND request_payload -> 'rights' ->> 'serviceProcessingConsent' = 'true'
  ),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  source_manifest_sha256 text NOT NULL CHECK (source_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 3),
  state text NOT NULL CHECK (state IN (
    'created', 'preparing', 'ready-for-reconstruction', 'reconstructing-geometry',
    'reconstructing-appearance', 'completed', 'abstained', 'cancel-requested',
    'cancelled', 'failed'
  )),
  result_id uuid,
  retryable boolean NOT NULL DEFAULT false,
  safe_code text CHECK (safe_code IS NULL OR safe_code ~ '^[A-Z][A-Z0-9_]{2,79}$'),
  created_by uuid NOT NULL REFERENCES identity_users(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  PRIMARY KEY (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT reconstruction_jobs_result_state CHECK (
    (state IN ('completed', 'abstained') AND result_id IS NOT NULL)
    OR (state NOT IN ('completed', 'abstained') AND result_id IS NULL)
  ),
  CONSTRAINT reconstruction_jobs_safe_state CHECK (
    (state IN ('abstained', 'failed') AND safe_code IS NOT NULL)
    OR (state NOT IN ('abstained', 'failed') AND safe_code IS NULL)
  ),
  CONSTRAINT reconstruction_jobs_retryable_state CHECK (
    NOT retryable OR state IN ('cancelled', 'failed')
  )
);

CREATE INDEX IF NOT EXISTS reconstruction_jobs_list_idx
  ON reconstruction_jobs (tenant_id, project_id, created_at DESC, id);
CREATE INDEX IF NOT EXISTS reconstruction_jobs_queue_idx
  ON reconstruction_jobs (created_at, id)
  WHERE state IN (
    'created', 'preparing', 'ready-for-reconstruction', 'reconstructing-geometry',
    'reconstructing-appearance', 'cancel-requested'
  );

CREATE TABLE IF NOT EXISTS reconstruction_job_sources (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN (
    'rgb-image', 'rgb-video', 'depth-sequence', 'camera-calibration', 'camera-poses'
  )),
  detected_mime_type text NOT NULL CHECK (char_length(detected_mime_type) BETWEEN 3 AND 100),
  byte_size bigint NOT NULL CHECK (byte_size BETWEEN 1 AND 21474836480),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  rights_basis text NOT NULL CHECK (rights_basis IN (
    'owned-by-user', 'permission-granted', 'public-domain', 'licensed'
  )),
  service_processing_consent boolean NOT NULL CHECK (service_processing_consent),
  training_use_consent text NOT NULL CHECK (training_use_consent = 'denied'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, job_id, asset_id),
  FOREIGN KEY (tenant_id, project_id, job_id)
    REFERENCES reconstruction_jobs(tenant_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, asset_id)
    REFERENCES assets(tenant_id, project_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS reconstruction_rights_withdrawals (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  reason_code text NOT NULL CHECK (reason_code = 'RIGHTS_WITHDRAWN'),
  withdrawn_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, asset_id),
  FOREIGN KEY (tenant_id, project_id, asset_id)
    REFERENCES assets(tenant_id, project_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS reconstruction_attempts (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid NOT NULL,
  attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 3),
  state text NOT NULL CHECK (state IN (
    'queued', 'leased', 'cancel-requested', 'cancelled', 'succeeded', 'failed'
  )),
  stage text NOT NULL CHECK (stage IN (
    'preparing', 'ready-for-reconstruction', 'reconstructing-geometry',
    'reconstructing-appearance'
  )),
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
    REFERENCES reconstruction_jobs(tenant_id, project_id, id) ON DELETE RESTRICT,
  CONSTRAINT reconstruction_attempts_lease_state CHECK (
    ((state IN ('leased', 'cancel-requested')) =
      (lease_owner IS NOT NULL AND lease_token IS NOT NULL
        AND lease_expires_at IS NOT NULL AND lease_seconds IS NOT NULL))
  )
);

CREATE INDEX IF NOT EXISTS reconstruction_attempts_lease_idx
  ON reconstruction_attempts (state, lease_expires_at, created_at, job_id)
  WHERE state IN ('queued', 'leased', 'cancel-requested');

CREATE TABLE IF NOT EXISTS reconstruction_results (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid NOT NULL,
  id uuid NOT NULL,
  attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 3),
  status text NOT NULL CHECK (status IN ('completed', 'abstained')),
  source_manifest_sha256 text NOT NULL CHECK (source_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  result_payload jsonb NOT NULL CHECK (
    jsonb_typeof(result_payload) = 'object'
    AND result_payload ->> 'schemaVersion' = 'c8-reconstruction-result-v1'
    AND result_payload ->> 'resultId' = id::text
    AND result_payload ->> 'jobId' = job_id::text
    AND result_payload ->> 'projectId' = project_id::text
    AND result_payload ->> 'status' = status
    AND result_payload ->> 'sourceManifestSha256' = source_manifest_sha256
  ),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, id),
  UNIQUE (tenant_id, project_id, job_id),
  UNIQUE (tenant_id, project_id, job_id, id),
  FOREIGN KEY (tenant_id, project_id, job_id, attempt)
    REFERENCES reconstruction_attempts(tenant_id, project_id, job_id, attempt) ON DELETE RESTRICT
);

ALTER TABLE reconstruction_jobs DROP CONSTRAINT IF EXISTS reconstruction_jobs_result_fk;
ALTER TABLE reconstruction_jobs ADD CONSTRAINT reconstruction_jobs_result_fk
  FOREIGN KEY (tenant_id, project_id, id, result_id)
  REFERENCES reconstruction_results(tenant_id, project_id, job_id, id)
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS reconstruction_audit_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN (
    'reconstruction.job.create', 'reconstruction.job.lease', 'reconstruction.job.advance',
    'reconstruction.job.cancel', 'reconstruction.job.cancelled', 'reconstruction.job.retry',
    'reconstruction.job.publish', 'reconstruction.job.fail',
    'reconstruction.source.rights-withdrawn'
  )),
  actor_user_id uuid REFERENCES identity_users(id),
  worker_id text CHECK (
    worker_id IS NULL OR (
      char_length(worker_id) BETWEEN 3 AND 100
      AND worker_id ~ '^[A-Za-z0-9_.:-]+$'
    )
  ),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  trace_id text NOT NULL CHECK (trace_id ~ '^[0-9a-f]{32}$'),
  metadata jsonb NOT NULL CHECK (
    jsonb_typeof(metadata) = 'object'
    AND NOT metadata ?| ARRAY[
      'sourceObjectKey', 'objectKey', 'signedUrl', 'url', 'path', 'rawMedia',
      'frames', 'result', 'request', 'token', 'credential', 'stdout', 'stderr'
    ]
  ),
  occurred_at timestamptz NOT NULL,
  CHECK ((actor_user_id IS NOT NULL)::integer + (worker_id IS NOT NULL)::integer = 1),
  FOREIGN KEY (tenant_id, project_id, job_id)
    REFERENCES reconstruction_jobs(tenant_id, project_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS reconstruction_audit_job_idx
  ON reconstruction_audit_events (tenant_id, project_id, job_id, occurred_at, id);

CREATE TABLE IF NOT EXISTS reconstruction_outbox (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type ~ '^reconstruction[.][a-z0-9.-]{2,100}$'),
  schema_version text NOT NULL CHECK (schema_version = 'c8-reconstruction-job-v1'),
  payload jsonb NOT NULL CHECK (
    jsonb_typeof(payload) = 'object'
    AND NOT payload ?| ARRAY[
      'sourceObjectKey', 'objectKey', 'signedUrl', 'url', 'path', 'rawMedia',
      'frames', 'result', 'request', 'token', 'credential', 'stdout', 'stderr'
    ]
  ),
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, project_id, job_id)
    REFERENCES reconstruction_jobs(tenant_id, project_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS reconstruction_outbox_poll_idx
  ON reconstruction_outbox (occurred_at, id);

CREATE OR REPLACE FUNCTION c8_reject_append_only_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE OR REPLACE FUNCTION c8_validate_job_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'reconstruction jobs cannot be deleted'; END IF;
  IF OLD.state IN ('completed', 'abstained') THEN
    RAISE EXCEPTION 'published reconstruction jobs are immutable';
  END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.id IS DISTINCT FROM NEW.id
    OR OLD.request_payload IS DISTINCT FROM NEW.request_payload
    OR OLD.request_sha256 IS DISTINCT FROM NEW.request_sha256
    OR OLD.source_manifest_sha256 IS DISTINCT FROM NEW.source_manifest_sha256
    OR OLD.created_by IS DISTINCT FROM NEW.created_by
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR NEW.version <> OLD.version + 1
    OR NEW.updated_at <= OLD.updated_at
  THEN RAISE EXCEPTION 'reconstruction job identity is immutable'; END IF;
  IF NOT (
    (OLD.state = 'created' AND NEW.state IN ('preparing', 'cancelled', 'failed'))
    OR (OLD.state = 'preparing' AND NEW.state IN (
      'preparing', 'ready-for-reconstruction', 'cancel-requested', 'abstained', 'failed'
    ))
    OR (OLD.state = 'ready-for-reconstruction' AND NEW.state IN (
      'ready-for-reconstruction', 'reconstructing-geometry', 'cancel-requested', 'abstained', 'failed'
    ))
    OR (OLD.state = 'reconstructing-geometry' AND NEW.state IN (
      'reconstructing-geometry', 'reconstructing-appearance', 'completed',
      'cancel-requested', 'abstained', 'failed'
    ))
    OR (OLD.state = 'reconstructing-appearance' AND NEW.state IN (
      'reconstructing-appearance', 'completed', 'cancel-requested', 'abstained', 'failed'
    ))
    OR (OLD.state = 'cancel-requested' AND NEW.state IN ('cancelled', 'failed'))
    OR (OLD.state IN ('cancelled', 'failed')
      AND NEW.state = 'created' AND NEW.attempt = OLD.attempt + 1)
  ) THEN
    RAISE EXCEPTION 'illegal reconstruction job transition from % to %', OLD.state, NEW.state;
  END IF;
  IF NEW.attempt <> OLD.attempt
    AND NOT (OLD.state IN ('cancelled', 'failed') AND NEW.state = 'created'
      AND NEW.attempt = OLD.attempt + 1)
  THEN RAISE EXCEPTION 'reconstruction attempt changed outside retry'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION c8_validate_attempt_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'reconstruction attempts cannot be deleted'; END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.job_id IS DISTINCT FROM NEW.job_id
    OR OLD.attempt IS DISTINCT FROM NEW.attempt
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR NEW.fence_version <> OLD.fence_version + 1
    OR NEW.updated_at <= OLD.updated_at
  THEN RAISE EXCEPTION 'reconstruction attempt identity is immutable'; END IF;
  IF OLD.state IN ('cancelled', 'succeeded', 'failed') THEN
    RAISE EXCEPTION 'terminal reconstruction attempts are immutable';
  END IF;
  IF NOT (
    (OLD.state = 'queued' AND NEW.state IN ('leased', 'cancelled', 'failed'))
    OR (OLD.state = 'leased' AND NEW.state IN ('leased', 'cancel-requested', 'succeeded', 'failed'))
    OR (OLD.state = 'cancel-requested' AND NEW.state IN ('cancelled', 'failed'))
  ) THEN
    RAISE EXCEPTION 'illegal reconstruction attempt transition from % to %', OLD.state, NEW.state;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reconstruction_jobs_validate_mutation ON reconstruction_jobs;
CREATE TRIGGER reconstruction_jobs_validate_mutation
BEFORE UPDATE OR DELETE ON reconstruction_jobs
FOR EACH ROW EXECUTE FUNCTION c8_validate_job_mutation();

DROP TRIGGER IF EXISTS reconstruction_attempts_validate_mutation ON reconstruction_attempts;
CREATE TRIGGER reconstruction_attempts_validate_mutation
BEFORE UPDATE OR DELETE ON reconstruction_attempts
FOR EACH ROW EXECUTE FUNCTION c8_validate_attempt_mutation();

DROP TRIGGER IF EXISTS reconstruction_job_sources_append_only ON reconstruction_job_sources;
CREATE TRIGGER reconstruction_job_sources_append_only
BEFORE UPDATE OR DELETE ON reconstruction_job_sources
FOR EACH ROW EXECUTE FUNCTION c8_reject_append_only_mutation();
DROP TRIGGER IF EXISTS reconstruction_rights_withdrawals_append_only ON reconstruction_rights_withdrawals;
CREATE TRIGGER reconstruction_rights_withdrawals_append_only
BEFORE UPDATE OR DELETE ON reconstruction_rights_withdrawals
FOR EACH ROW EXECUTE FUNCTION c8_reject_append_only_mutation();
DROP TRIGGER IF EXISTS reconstruction_results_append_only ON reconstruction_results;
CREATE TRIGGER reconstruction_results_append_only
BEFORE UPDATE OR DELETE ON reconstruction_results
FOR EACH ROW EXECUTE FUNCTION c8_reject_append_only_mutation();
DROP TRIGGER IF EXISTS reconstruction_audit_events_append_only ON reconstruction_audit_events;
CREATE TRIGGER reconstruction_audit_events_append_only
BEFORE UPDATE OR DELETE ON reconstruction_audit_events
FOR EACH ROW EXECUTE FUNCTION c8_reject_append_only_mutation();
DROP TRIGGER IF EXISTS reconstruction_outbox_append_only ON reconstruction_outbox;
CREATE TRIGGER reconstruction_outbox_append_only
BEFORE UPDATE OR DELETE ON reconstruction_outbox
FOR EACH ROW EXECUTE FUNCTION c8_reject_append_only_mutation();

INSERT INTO platform_schema_migrations (id)
VALUES ('0008_reconstruction')
ON CONFLICT (id) DO NOTHING;
