DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform_schema_migrations WHERE id = '0002_assets_evidence') THEN
    RAISE EXCEPTION 'C6 requires migration 0002_assets_evidence';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform_schema_migrations WHERE id = '0005_model_operations') THEN
    RAISE EXCEPTION 'C6 requires migration 0005_model_operations';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS plan_processing_jobs (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  root_job_id uuid NOT NULL,
  retry_of_job_id uuid,
  asset_id uuid NOT NULL,
  page_index integer NOT NULL CHECK (page_index BETWEEN 0 AND 19),
  parser_preference text NOT NULL CHECK (parser_preference IN ('auto', 'vector', 'raster', 'fixture')),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 3),
  state text NOT NULL CHECK (state IN (
    'queued', 'processing', 'proposed', 'abstained', 'cancel-requested', 'cancelled', 'failed'
  )),
  result_id uuid,
  retryable boolean NOT NULL DEFAULT false,
  safe_code text CHECK (
    safe_code IS NULL OR safe_code ~ '^([a-z][a-z0-9-]{2,79}|[A-Z][A-Z0-9_]{2,79})$'
  ),
  lease_owner text CHECK (lease_owner IS NULL OR lease_owner ~ '^[A-Za-z0-9_.:-]{3,100}$'),
  lease_token uuid,
  lease_expires_at timestamptz,
  normalized_input_sha256 text CHECK (
    normalized_input_sha256 IS NULL OR normalized_input_sha256 ~ '^[0-9a-f]{64}$'
  ),
  created_by uuid NOT NULL REFERENCES identity_users(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  PRIMARY KEY (tenant_id, project_id, id),
  UNIQUE (tenant_id, project_id, root_job_id, attempt),
  FOREIGN KEY (tenant_id, project_id, asset_id)
    REFERENCES assets(tenant_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, retry_of_job_id)
    REFERENCES plan_processing_jobs(tenant_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, root_job_id)
    REFERENCES plan_processing_jobs(tenant_id, project_id, id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT plan_processing_jobs_result_state CHECK (
    (state IN ('proposed', 'abstained') AND result_id IS NOT NULL)
    OR (state NOT IN ('proposed', 'abstained') AND result_id IS NULL)
  ),
  CONSTRAINT plan_processing_jobs_safe_state CHECK (
    (state IN ('abstained', 'failed') AND safe_code IS NOT NULL)
    OR (state NOT IN ('abstained', 'failed') AND safe_code IS NULL)
  ),
  CONSTRAINT plan_processing_jobs_retryable_state CHECK (
    NOT retryable OR state IN ('abstained', 'failed')
  ),
  CONSTRAINT plan_processing_jobs_lease_state CHECK (
    ((state IN ('processing', 'cancel-requested')) =
      (lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL))
  )
);

CREATE INDEX IF NOT EXISTS plan_processing_jobs_list_idx
  ON plan_processing_jobs (tenant_id, project_id, created_at, id);
CREATE INDEX IF NOT EXISTS plan_processing_jobs_queue_idx
  ON plan_processing_jobs (state, created_at, id)
  WHERE state IN ('queued', 'processing', 'cancel-requested');

CREATE TABLE IF NOT EXISTS plan_processing_results (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid NOT NULL,
  id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('proposal', 'abstained')),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  normalized_input_sha256 text CHECK (
    normalized_input_sha256 IS NULL OR normalized_input_sha256 ~ '^[0-9a-f]{64}$'
  ),
  parser_manifest_sha256 text NOT NULL CHECK (parser_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  result_sha256 text NOT NULL CHECK (result_sha256 ~ '^[0-9a-f]{64}$'),
  result_payload jsonb NOT NULL CHECK (
    jsonb_typeof(result_payload) = 'object'
    AND result_payload ->> 'schemaVersion' = 'c6-plan-proposal-v1'
    AND result_payload ->> 'proposalId' = id::text
    AND result_payload ->> 'jobId' = job_id::text
    AND result_payload ->> 'projectId' = project_id::text
    AND result_payload ->> 'status' = status
  ),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, id),
  UNIQUE (tenant_id, project_id, job_id),
  UNIQUE (tenant_id, project_id, job_id, id),
  FOREIGN KEY (tenant_id, project_id, job_id)
    REFERENCES plan_processing_jobs(tenant_id, project_id, id) ON DELETE RESTRICT
);

ALTER TABLE plan_processing_jobs
  DROP CONSTRAINT IF EXISTS plan_processing_jobs_result_fk;
ALTER TABLE plan_processing_jobs
  ADD CONSTRAINT plan_processing_jobs_result_fk
  FOREIGN KEY (tenant_id, project_id, id, result_id)
  REFERENCES plan_processing_results(tenant_id, project_id, job_id, id)
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS plan_calibrations (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES identity_users(id),
  residual_millimetres integer NOT NULL CHECK (residual_millimetres BETWEEN 0 AND 1000000),
  calibration_payload jsonb NOT NULL CHECK (
    jsonb_typeof(calibration_payload) = 'object'
    AND calibration_payload ->> 'id' = id::text
    AND calibration_payload ->> 'jobId' = job_id::text
    AND calibration_payload ->> 'proposalId' = proposal_id::text
    AND calibration_payload ->> 'projectId' = project_id::text
  ),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, id),
  UNIQUE (tenant_id, project_id, job_id, proposal_id, id),
  FOREIGN KEY (tenant_id, project_id, job_id, proposal_id)
    REFERENCES plan_processing_results(tenant_id, project_id, job_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, job_id)
    REFERENCES plan_processing_jobs(tenant_id, project_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS plan_calibrations_job_idx
  ON plan_calibrations (tenant_id, project_id, job_id, created_at, id);

CREATE TABLE IF NOT EXISTS plan_operation_drafts (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  calibration_id uuid NOT NULL,
  id uuid NOT NULL,
  branch_id uuid NOT NULL,
  profile text NOT NULL CHECK (profile IN ('existing', 'proposed', 'as-built')),
  expected_revision integer NOT NULL CHECK (expected_revision >= 0),
  expected_head_snapshot_sha256 text NOT NULL CHECK (expected_head_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  operation_count integer NOT NULL CHECK (operation_count BETWEEN 1 AND 50),
  draft_payload jsonb NOT NULL CHECK (
    jsonb_typeof(draft_payload) = 'object'
    AND draft_payload ->> 'schemaVersion' = 'c6-plan-operation-draft-v1'
    AND draft_payload ->> 'id' = id::text
    AND draft_payload ->> 'jobId' = job_id::text
    AND draft_payload ->> 'proposalId' = proposal_id::text
    AND draft_payload ->> 'calibrationId' = calibration_id::text
    AND draft_payload ->> 'projectId' = project_id::text
    AND jsonb_array_length(draft_payload -> 'operations') = operation_count
  ),
  created_by uuid NOT NULL REFERENCES identity_users(id),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id, job_id, proposal_id)
    REFERENCES plan_processing_results(tenant_id, project_id, job_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, job_id, proposal_id, calibration_id)
    REFERENCES plan_calibrations(tenant_id, project_id, job_id, proposal_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, profile, branch_id)
    REFERENCES model_branches(tenant_id, project_id, profile, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS plan_operation_drafts_job_idx
  ON plan_operation_drafts (tenant_id, project_id, job_id, created_at, id);

CREATE TABLE IF NOT EXISTS plan_processing_audit_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN (
    'plan.job.create', 'plan.job.lease', 'plan.job.cancel', 'plan.job.retry',
    'plan.job.publish', 'plan.job.fail', 'plan.proposal.calibrate', 'plan.proposal.draft'
  )),
  actor_user_id uuid REFERENCES identity_users(id),
  worker_id text CHECK (
    worker_id IS NULL OR (char_length(worker_id) BETWEEN 3 AND 100 AND worker_id ~ '^[A-Za-z0-9_.:-]+$')
  ),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  trace_id text NOT NULL CHECK (trace_id ~ '^[0-9a-f]{32}$'),
  metadata jsonb NOT NULL CHECK (
    jsonb_typeof(metadata) = 'object'
    AND NOT metadata ?| ARRAY[
      'operations', 'sourceObjectKey', 'objectKey', 'signedUrl', 'rawSource',
      'parserStderr', 'parserStdout', 'token', 'credential'
    ]
  ),
  occurred_at timestamptz NOT NULL,
  CHECK ((actor_user_id IS NOT NULL)::integer + (worker_id IS NOT NULL)::integer = 1),
  FOREIGN KEY (tenant_id, project_id, job_id)
    REFERENCES plan_processing_jobs(tenant_id, project_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS plan_processing_audit_job_idx
  ON plan_processing_audit_events (tenant_id, project_id, job_id, occurred_at, id);

CREATE TABLE IF NOT EXISTS plan_processing_outbox (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type ~ '^plan[.][a-z0-9.-]{2,79}$'),
  schema_version text NOT NULL CHECK (schema_version = 'c6-plan-job-v1'),
  payload jsonb NOT NULL CHECK (
    jsonb_typeof(payload) = 'object'
    AND NOT payload ?| ARRAY[
      'operations', 'sourceObjectKey', 'objectKey', 'signedUrl', 'rawSource',
      'parserStderr', 'parserStdout', 'token', 'credential'
    ]
  ),
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, project_id, job_id)
    REFERENCES plan_processing_jobs(tenant_id, project_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS plan_processing_outbox_poll_idx
  ON plan_processing_outbox (occurred_at, id);

CREATE OR REPLACE FUNCTION c6_reject_append_only_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE OR REPLACE FUNCTION c6_validate_job_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'plan jobs cannot be deleted'; END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.id IS DISTINCT FROM NEW.id
    OR OLD.root_job_id IS DISTINCT FROM NEW.root_job_id
    OR OLD.retry_of_job_id IS DISTINCT FROM NEW.retry_of_job_id
    OR OLD.asset_id IS DISTINCT FROM NEW.asset_id
    OR OLD.page_index IS DISTINCT FROM NEW.page_index
    OR OLD.parser_preference IS DISTINCT FROM NEW.parser_preference
    OR OLD.source_sha256 IS DISTINCT FROM NEW.source_sha256
    OR OLD.attempt IS DISTINCT FROM NEW.attempt
    OR OLD.created_by IS DISTINCT FROM NEW.created_by
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR NEW.version <> OLD.version + 1
    OR NEW.updated_at <= OLD.updated_at
  THEN RAISE EXCEPTION 'plan job identity is immutable'; END IF;
  IF OLD.state IN ('proposed', 'abstained', 'cancelled', 'failed') THEN
    RAISE EXCEPTION 'terminal plan jobs are immutable';
  END IF;
  IF NOT (
    (OLD.state = 'queued' AND NEW.state IN ('processing', 'cancelled', 'failed'))
    OR (OLD.state = 'processing' AND NEW.state IN ('processing', 'proposed', 'abstained', 'cancel-requested', 'failed'))
    OR (OLD.state = 'cancel-requested' AND NEW.state = 'cancelled')
  ) THEN RAISE EXCEPTION 'illegal plan job transition from % to %', OLD.state, NEW.state; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS plan_processing_jobs_validate_mutation ON plan_processing_jobs;
CREATE TRIGGER plan_processing_jobs_validate_mutation
BEFORE UPDATE OR DELETE ON plan_processing_jobs
FOR EACH ROW EXECUTE FUNCTION c6_validate_job_mutation();

DROP TRIGGER IF EXISTS plan_processing_results_append_only ON plan_processing_results;
CREATE TRIGGER plan_processing_results_append_only BEFORE UPDATE OR DELETE ON plan_processing_results
FOR EACH ROW EXECUTE FUNCTION c6_reject_append_only_mutation();
DROP TRIGGER IF EXISTS plan_calibrations_append_only ON plan_calibrations;
CREATE TRIGGER plan_calibrations_append_only BEFORE UPDATE OR DELETE ON plan_calibrations
FOR EACH ROW EXECUTE FUNCTION c6_reject_append_only_mutation();
DROP TRIGGER IF EXISTS plan_operation_drafts_append_only ON plan_operation_drafts;
CREATE TRIGGER plan_operation_drafts_append_only BEFORE UPDATE OR DELETE ON plan_operation_drafts
FOR EACH ROW EXECUTE FUNCTION c6_reject_append_only_mutation();
DROP TRIGGER IF EXISTS plan_processing_audit_events_append_only ON plan_processing_audit_events;
CREATE TRIGGER plan_processing_audit_events_append_only BEFORE UPDATE OR DELETE ON plan_processing_audit_events
FOR EACH ROW EXECUTE FUNCTION c6_reject_append_only_mutation();
DROP TRIGGER IF EXISTS plan_processing_outbox_append_only ON plan_processing_outbox;
CREATE TRIGGER plan_processing_outbox_append_only BEFORE UPDATE OR DELETE ON plan_processing_outbox
FOR EACH ROW EXECUTE FUNCTION c6_reject_append_only_mutation();

INSERT INTO platform_schema_migrations (id)
VALUES ('0006_plan_processing')
ON CONFLICT (id) DO NOTHING;
