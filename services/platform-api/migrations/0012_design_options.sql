DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform_schema_migrations WHERE id = '0011_design_briefs') THEN
    RAISE EXCEPTION 'C12 requires migration 0011_design_briefs';
  END IF;
END
$$;

-- C5's retained envelope invariant is widened only for the exact C12 schema/type pairs.
ALTER TABLE model_operation_envelopes
  DROP CONSTRAINT IF EXISTS model_operation_envelopes_schema_version_check;
ALTER TABLE model_operation_envelopes
  DROP CONSTRAINT IF EXISTS model_operation_envelopes_type_check;
ALTER TABLE model_operation_envelopes
  DROP CONSTRAINT IF EXISTS model_operation_envelopes_schema_type_pair_check;
ALTER TABLE model_operation_envelopes
  ADD CONSTRAINT model_operation_envelopes_schema_type_pair_check CHECK (
    (
      schema_version = 'c5-model-operation-v1'
      AND type IN (
        'snapshot.initialize.v1', 'snapshot.restore.v1', 'level.create.v1',
        'wall.create.v1', 'wall.translate.v1', 'opening.insert.v1',
        'space.create.v1', 'space.rename.v1', 'element.metadata.correct.v1',
        'element.provenance.correct.v1'
      )
    ) OR (
      schema_version = 'c12-design-element-operation-v1'
      AND type IN (
        'design.element.create.v1', 'design.element.replace.v1',
        'design.element.remove.v1'
      )
    )
  );

CREATE TABLE IF NOT EXISTS design_option_jobs (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  schema_version text NOT NULL CHECK (schema_version = 'c12-option-job-v1'),
  version integer NOT NULL CHECK (version >= 1),
  attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 100),
  state text NOT NULL CHECK (state IN (
    'queued', 'running', 'cancel-requested', 'succeeded', 'failed', 'cancelled', 'abstained'
  )),
  stage text NOT NULL CHECK (stage IN (
    'queued', 'deriving-constraints', 'generating', 'validating', 'publishing', 'complete'
  )),
  brief_id uuid NOT NULL,
  brief_revision integer NOT NULL CHECK (brief_revision >= 1),
  brief_content_sha256 text NOT NULL CHECK (brief_content_sha256 ~ '^[0-9a-f]{64}$'),
  source_model_id uuid NOT NULL,
  source_profile text NOT NULL CHECK (source_profile IN ('existing', 'proposed')),
  source_snapshot_id uuid NOT NULL,
  source_snapshot_version integer NOT NULL CHECK (source_snapshot_version >= 1),
  source_snapshot_sha256 text NOT NULL CHECK (source_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  working_model_id uuid NOT NULL,
  working_snapshot_id uuid NOT NULL,
  working_snapshot_version integer NOT NULL CHECK (working_snapshot_version >= 1),
  working_snapshot_sha256 text NOT NULL CHECK (working_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  working_snapshot_payload jsonb NOT NULL CHECK (
    jsonb_typeof(working_snapshot_payload) = 'object'
    AND working_snapshot_payload ->> 'profile' = 'proposed'
    AND working_snapshot_payload ->> 'projectId' = project_id::text
    AND working_snapshot_payload ->> 'modelId' = working_model_id::text
  ),
  constraints_payload jsonb NOT NULL CHECK (
    jsonb_typeof(constraints_payload) = 'array'
    AND jsonb_array_length(constraints_payload) BETWEEN 1 AND 200
  ),
  constraints_sha256 text NOT NULL CHECK (constraints_sha256 ~ '^[0-9a-f]{64}$'),
  asset_manifest_sha256 text NOT NULL CHECK (asset_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  requested_option_count integer NOT NULL CHECK (requested_option_count BETWEEN 2 AND 8),
  requested_directions jsonb NOT NULL CHECK (
    jsonb_typeof(requested_directions) = 'array'
    AND jsonb_array_length(requested_directions) BETWEEN 2 AND 5
  ),
  option_count integer NOT NULL DEFAULT 0 CHECK (option_count BETWEEN 0 AND 8),
  safe_code text CHECK (safe_code IN (
    'BRIEF_NOT_ACCEPTED', 'CONSTRAINTS_INFEASIBLE', 'MODEL_NOT_PROPOSED',
    'SOURCE_CHANGED', 'RESOURCE_LIMIT', 'INTERNAL_FAILURE', 'NO_FEASIBLE_DIVERSE_SET'
  )),
  retryable boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES identity_users(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  cancelled_at timestamptz,
  completed_at timestamptz,
  PRIMARY KEY (tenant_id, project_id, id),
  UNIQUE (tenant_id, project_id, id, version),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, brief_id, brief_revision)
    REFERENCES design_brief_revisions(tenant_id, project_id, brief_id, revision)
    ON DELETE RESTRICT,
  FOREIGN KEY (
    tenant_id, project_id, source_model_id, source_profile,
    source_snapshot_id, source_snapshot_sha256, source_snapshot_version
  ) REFERENCES canonical_model_snapshots (
    tenant_id, project_id, model_id, profile, id, snapshot_sha256, version
  ) ON DELETE RESTRICT,
  CHECK (updated_at >= created_at),
  CHECK ((state = 'queued') = (stage = 'queued')),
  CHECK ((state IN ('succeeded', 'failed', 'cancelled', 'abstained')) = (stage = 'complete')),
  CHECK ((state = 'cancelled') = (cancelled_at IS NOT NULL)),
  CHECK ((state IN ('succeeded', 'abstained')) = (completed_at IS NOT NULL)),
  CHECK ((state IN ('failed', 'abstained')) = (safe_code IS NOT NULL)),
  CHECK (state <> 'succeeded' OR option_count = requested_option_count),
  CHECK (state <> 'abstained' OR (option_count = 0 AND safe_code = 'NO_FEASIBLE_DIVERSE_SET')),
  CHECK (NOT retryable OR state IN ('failed', 'cancelled', 'abstained'))
);

CREATE INDEX IF NOT EXISTS design_option_jobs_list_idx
  ON design_option_jobs (tenant_id, project_id, created_at, id);
CREATE INDEX IF NOT EXISTS design_option_jobs_queue_idx
  ON design_option_jobs (state, created_at, tenant_id, project_id, id)
  WHERE state IN ('queued', 'running', 'cancel-requested');

CREATE TABLE IF NOT EXISTS design_option_attempts (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid NOT NULL,
  attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 100),
  job_version integer NOT NULL CHECK (job_version >= 1),
  state text NOT NULL CHECK (state IN (
    'queued', 'leased', 'cancel-requested', 'cancelled', 'succeeded', 'failed'
  )),
  stage text NOT NULL CHECK (stage IN (
    'queued', 'deriving-constraints', 'generating', 'validating', 'publishing', 'complete'
  )),
  lease_owner text CHECK (
    lease_owner IS NULL OR (
      char_length(lease_owner) BETWEEN 3 AND 100 AND lease_owner ~ '^[A-Za-z0-9_.:-]+$'
    )
  ),
  lease_token uuid,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  lease_seconds integer CHECK (lease_seconds IS NULL OR lease_seconds BETWEEN 30 AND 3600),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, job_id, attempt),
  FOREIGN KEY (tenant_id, project_id, job_id)
    REFERENCES design_option_jobs(tenant_id, project_id, id) ON DELETE RESTRICT,
  CHECK ((state IN ('leased', 'cancel-requested')) = (
    lease_owner IS NOT NULL AND lease_token IS NOT NULL
    AND lease_expires_at IS NOT NULL AND heartbeat_at IS NOT NULL AND lease_seconds IS NOT NULL
  )),
  CHECK ((state = 'queued') = (stage = 'queued')),
  CHECK ((state IN ('cancelled', 'succeeded', 'failed')) = (stage = 'complete'))
);

CREATE INDEX IF NOT EXISTS design_option_attempts_lease_idx
  ON design_option_attempts (state, lease_expires_at, created_at, tenant_id, project_id, job_id)
  WHERE state IN ('queued', 'leased', 'cancel-requested');

CREATE TABLE IF NOT EXISTS design_option_sets (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid NOT NULL,
  set_sha256 text NOT NULL CHECK (set_sha256 ~ '^[0-9a-f]{64}$'),
  option_count integer NOT NULL CHECK (option_count BETWEEN 2 AND 8),
  set_payload jsonb NOT NULL CHECK (
    jsonb_typeof(set_payload) = 'object'
    AND set_payload ->> 'schemaVersion' = 'c12-design-option-set-v1'
    AND set_payload ->> 'projectId' = project_id::text
    AND set_payload ->> 'jobId' = job_id::text
    AND set_payload ->> 'setSha256' = set_sha256
    AND jsonb_array_length(set_payload -> 'optionIds') = option_count
  ),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, job_id),
  UNIQUE (tenant_id, project_id, job_id, set_sha256),
  FOREIGN KEY (tenant_id, project_id, job_id)
    REFERENCES design_option_jobs(tenant_id, project_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS design_option_bundles (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid NOT NULL,
  id uuid NOT NULL,
  bundle_sha256 text NOT NULL CHECK (bundle_sha256 ~ '^[0-9a-f]{64}$'),
  candidate_snapshot_sha256 text NOT NULL CHECK (candidate_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  operation_count integer NOT NULL CHECK (operation_count BETWEEN 1 AND 50),
  asset_count integer NOT NULL CHECK (asset_count BETWEEN 0 AND 50),
  bundle_payload jsonb NOT NULL CHECK (
    jsonb_typeof(bundle_payload) = 'object'
    AND bundle_payload ->> 'schemaVersion' = 'c12-operation-bundle-v1'
    AND bundle_payload ->> 'projectId' = project_id::text
    AND bundle_payload ->> 'id' = id::text
    AND bundle_payload ->> 'bundleSha256' = bundle_sha256
    AND bundle_payload ->> 'candidateSnapshotSha256' = candidate_snapshot_sha256
    AND jsonb_array_length(bundle_payload -> 'operations') = operation_count
    AND jsonb_array_length(bundle_payload -> 'assetPlacements') = asset_count
  ),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, job_id, id),
  UNIQUE (tenant_id, project_id, job_id, bundle_sha256),
  FOREIGN KEY (tenant_id, project_id, job_id)
    REFERENCES design_option_sets(tenant_id, project_id, job_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS design_options (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid NOT NULL,
  id uuid NOT NULL,
  bundle_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN (
    'circulation-first', 'conversation-first', 'daylight-first', 'retention-first', 'storage-first'
  )),
  expires_at timestamptz NOT NULL,
  option_payload jsonb NOT NULL CHECK (
    jsonb_typeof(option_payload) = 'object'
    AND option_payload ->> 'schemaVersion' = 'c12-design-option-v1'
    AND option_payload ->> 'projectId' = project_id::text
    AND option_payload ->> 'jobId' = job_id::text
    AND option_payload ->> 'id' = id::text
    AND option_payload ->> 'direction' = direction
    AND option_payload ->> 'status' = 'pending'
  ),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, job_id, id),
  UNIQUE (tenant_id, project_id, id),
  UNIQUE (tenant_id, project_id, job_id, direction),
  FOREIGN KEY (tenant_id, project_id, job_id, bundle_id)
    REFERENCES design_option_bundles(tenant_id, project_id, job_id, id) ON DELETE RESTRICT,
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS design_options_expiry_idx
  ON design_options (expires_at, tenant_id, project_id, job_id, id);

CREATE TABLE IF NOT EXISTS design_option_heads (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid NOT NULL,
  option_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  status text NOT NULL CHECK (status IN ('pending', 'confirmed', 'expired', 'rejected')),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, job_id, option_id),
  FOREIGN KEY (tenant_id, project_id, job_id, option_id)
    REFERENCES design_options(tenant_id, project_id, job_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS design_option_state_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid NOT NULL,
  option_id uuid NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  previous_status text CHECK (previous_status IN ('pending', 'confirmed', 'expired', 'rejected')),
  status text NOT NULL CHECK (status IN ('pending', 'confirmed', 'expired', 'rejected')),
  reason_code text NOT NULL CHECK (reason_code IN ('published', 'confirmed', 'expired', 'rejected')),
  actor_user_id uuid REFERENCES identity_users(id),
  occurred_at timestamptz NOT NULL,
  UNIQUE (tenant_id, project_id, job_id, option_id, version),
  FOREIGN KEY (tenant_id, project_id, job_id, option_id)
    REFERENCES design_option_heads(tenant_id, project_id, job_id, option_id) ON DELETE RESTRICT,
  CHECK ((version = 1 AND previous_status IS NULL AND status = 'pending' AND reason_code = 'published')
    OR (version > 1 AND previous_status = 'pending' AND status <> 'pending'))
);

CREATE TABLE IF NOT EXISTS design_option_job_state_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 100),
  previous_state text CHECK (previous_state IN (
    'queued', 'running', 'cancel-requested', 'succeeded', 'failed', 'cancelled', 'abstained'
  )),
  state text NOT NULL CHECK (state IN (
    'queued', 'running', 'cancel-requested', 'succeeded', 'failed', 'cancelled', 'abstained'
  )),
  stage text NOT NULL CHECK (stage IN (
    'queued', 'deriving-constraints', 'generating', 'validating', 'publishing', 'complete'
  )),
  safe_code text,
  occurred_at timestamptz NOT NULL,
  actor_user_id uuid REFERENCES identity_users(id),
  UNIQUE (tenant_id, project_id, job_id, version),
  FOREIGN KEY (tenant_id, project_id, job_id)
    REFERENCES design_option_jobs(tenant_id, project_id, id) ON DELETE RESTRICT,
  CHECK ((version = 1 AND previous_state IS NULL AND state = 'queued') OR version > 1)
);

CREATE TABLE IF NOT EXISTS design_option_idempotency_effects (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  actor_user_id uuid NOT NULL REFERENCES identity_users(id),
  operation text NOT NULL CHECK (operation IN (
    'design-option.job.create', 'design-option.job.cancel', 'design-option.job.retry',
    'design-option.option.confirm'
  )),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  response_status integer CHECK (response_status IN (200, 201)),
  response_payload jsonb CHECK (
    response_payload IS NULL OR (
      jsonb_typeof(response_payload) = 'object'
      AND NOT response_payload ?| ARRAY['operations', 'assets', 'brief', 'constraints', 'leaseToken']
    )
  ),
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  PRIMARY KEY (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  CHECK ((response_status IS NULL AND response_payload IS NULL AND completed_at IS NULL)
    OR (response_status IS NOT NULL AND response_payload IS NOT NULL AND completed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS design_option_idempotency_project_idx
  ON design_option_idempotency_effects (tenant_id, project_id, created_at, idempotency_key);

CREATE TABLE IF NOT EXISTS design_option_confirmations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid NOT NULL,
  option_id uuid NOT NULL,
  schema_version text NOT NULL CHECK (schema_version = 'c12-option-confirmation-v1'),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  branch_id uuid NOT NULL,
  branch_revision integer NOT NULL CHECK (branch_revision = 1),
  preview_id uuid NOT NULL,
  commit_id uuid NOT NULL,
  profile text NOT NULL DEFAULT 'proposed' CHECK (profile = 'proposed'),
  result_snapshot_id uuid NOT NULL,
  result_snapshot_sha256 text NOT NULL CHECK (result_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  confirmed_by uuid NOT NULL REFERENCES identity_users(id),
  confirmed_at timestamptz NOT NULL,
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  trace_id text NOT NULL CHECK (trace_id ~ '^[0-9a-f]{32}$'),
  UNIQUE (tenant_id, project_id, job_id, option_id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, project_id, job_id, option_id)
    REFERENCES design_option_heads(tenant_id, project_id, job_id, option_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, profile, branch_id, preview_id)
    REFERENCES model_operation_previews(tenant_id, project_id, profile, branch_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, profile, branch_id, commit_id)
    REFERENCES model_operation_commits(tenant_id, project_id, profile, branch_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, profile, result_snapshot_id)
    REFERENCES canonical_model_snapshots(tenant_id, project_id, profile, id)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS design_option_audit_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid NOT NULL,
  option_id uuid,
  action text NOT NULL CHECK (action IN (
    'design-option.job.create', 'design-option.job.cancel', 'design-option.job.retry',
    'design-option.job.publish', 'design-option.job.abstain', 'design-option.job.fail',
    'design-option.option.confirm'
  )),
  outcome text NOT NULL CHECK (outcome IN ('accepted', 'abstained', 'failed')),
  actor_user_id uuid REFERENCES identity_users(id),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  trace_id text NOT NULL CHECK (trace_id ~ '^[0-9a-f]{32}$'),
  metadata jsonb NOT NULL CHECK (
    jsonb_typeof(metadata) = 'object'
    AND NOT metadata ?| ARRAY[
      'statement', 'brief', 'household', 'accessibility', 'narrative', 'operations',
      'assets', 'payload', 'prompt', 'token', 'credential', 'leaseToken'
    ]
  ),
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, project_id, job_id)
    REFERENCES design_option_jobs(tenant_id, project_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS design_option_audit_project_idx
  ON design_option_audit_events (tenant_id, project_id, occurred_at, id);

CREATE TABLE IF NOT EXISTS design_option_outbox (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid NOT NULL,
  option_id uuid,
  event_type text NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9.-]{2,79}$'),
  schema_version text NOT NULL CHECK (schema_version = 'c12-option-job-v1'),
  payload jsonb NOT NULL CHECK (
    jsonb_typeof(payload) = 'object'
    AND NOT payload ?| ARRAY[
      'statement', 'brief', 'household', 'accessibility', 'narrative', 'operations',
      'assets', 'payload', 'prompt', 'token', 'credential', 'leaseToken'
    ]
  ),
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, project_id, job_id)
    REFERENCES design_option_jobs(tenant_id, project_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS design_option_outbox_poll_idx
  ON design_option_outbox (occurred_at, id);

CREATE OR REPLACE FUNCTION c12_reject_append_only_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE OR REPLACE FUNCTION c12_validate_job_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'design option jobs cannot be deleted'; END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.project_id IS DISTINCT FROM NEW.project_id OR OLD.id IS DISTINCT FROM NEW.id
    OR OLD.schema_version IS DISTINCT FROM NEW.schema_version
    OR OLD.brief_id IS DISTINCT FROM NEW.brief_id
    OR OLD.brief_revision IS DISTINCT FROM NEW.brief_revision
    OR OLD.brief_content_sha256 IS DISTINCT FROM NEW.brief_content_sha256
    OR OLD.source_model_id IS DISTINCT FROM NEW.source_model_id
    OR OLD.source_profile IS DISTINCT FROM NEW.source_profile
    OR OLD.source_snapshot_id IS DISTINCT FROM NEW.source_snapshot_id
    OR OLD.source_snapshot_version IS DISTINCT FROM NEW.source_snapshot_version
    OR OLD.source_snapshot_sha256 IS DISTINCT FROM NEW.source_snapshot_sha256
    OR OLD.working_model_id IS DISTINCT FROM NEW.working_model_id
    OR OLD.working_snapshot_id IS DISTINCT FROM NEW.working_snapshot_id
    OR OLD.working_snapshot_version IS DISTINCT FROM NEW.working_snapshot_version
    OR OLD.working_snapshot_sha256 IS DISTINCT FROM NEW.working_snapshot_sha256
    OR OLD.working_snapshot_payload IS DISTINCT FROM NEW.working_snapshot_payload
    OR OLD.constraints_payload IS DISTINCT FROM NEW.constraints_payload
    OR OLD.constraints_sha256 IS DISTINCT FROM NEW.constraints_sha256
    OR OLD.asset_manifest_sha256 IS DISTINCT FROM NEW.asset_manifest_sha256
    OR OLD.requested_option_count IS DISTINCT FROM NEW.requested_option_count
    OR OLD.requested_directions IS DISTINCT FROM NEW.requested_directions
    OR OLD.created_by IS DISTINCT FROM NEW.created_by OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR NEW.version <> OLD.version + 1 OR NEW.updated_at <= OLD.updated_at
  THEN RAISE EXCEPTION 'invalid design option job mutation'; END IF;
  IF NOT (
    (OLD.state = 'queued' AND NEW.state IN ('running', 'failed', 'cancelled'))
    OR (OLD.state = 'running' AND NEW.state IN ('running', 'cancel-requested', 'succeeded', 'failed', 'abstained'))
    OR (OLD.state = 'cancel-requested' AND NEW.state = 'cancelled')
    OR (OLD.state IN ('failed', 'cancelled', 'abstained') AND NEW.state = 'queued' AND NEW.attempt = OLD.attempt + 1)
  ) THEN RAISE EXCEPTION 'invalid design option job state transition'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION c12_validate_attempt_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'design option attempts cannot be deleted'; END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.job_id IS DISTINCT FROM NEW.job_id OR OLD.attempt IS DISTINCT FROM NEW.attempt
    OR OLD.created_at IS DISTINCT FROM NEW.created_at OR NEW.updated_at <= OLD.updated_at
  THEN RAISE EXCEPTION 'invalid design option attempt mutation'; END IF;
  IF OLD.state = 'leased' AND NEW.state = 'leased' AND OLD.lease_token IS DISTINCT FROM NEW.lease_token
    AND OLD.lease_expires_at > statement_timestamp()
  THEN RAISE EXCEPTION 'an unexpired design option lease cannot be reclaimed'; END IF;
  IF NOT (
    (OLD.state = 'queued' AND NEW.state IN ('leased', 'failed', 'cancelled'))
    OR (OLD.state = 'leased' AND NEW.state IN ('leased', 'cancel-requested', 'succeeded', 'failed'))
    OR (OLD.state = 'cancel-requested' AND NEW.state IN ('cancelled', 'failed'))
  ) THEN RAISE EXCEPTION 'invalid design option attempt transition'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION c12_validate_option_head_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'design option heads cannot be deleted'; END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.job_id IS DISTINCT FROM NEW.job_id OR OLD.option_id IS DISTINCT FROM NEW.option_id
    OR OLD.status <> 'pending' OR NEW.status NOT IN ('confirmed', 'expired', 'rejected')
    OR NEW.version <> OLD.version + 1 OR NEW.updated_at <= OLD.updated_at
  THEN RAISE EXCEPTION 'invalid design option head mutation'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION c12_validate_idempotency_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'design option idempotency effects cannot be deleted'; END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key
    OR OLD.actor_user_id IS DISTINCT FROM NEW.actor_user_id OR OLD.operation IS DISTINCT FROM NEW.operation
    OR OLD.request_sha256 IS DISTINCT FROM NEW.request_sha256 OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR OLD.completed_at IS NOT NULL OR NEW.completed_at IS NULL
  THEN RAISE EXCEPTION 'invalid design option idempotency completion'; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS design_option_jobs_validate ON design_option_jobs;
CREATE TRIGGER design_option_jobs_validate BEFORE UPDATE OR DELETE ON design_option_jobs
FOR EACH ROW EXECUTE FUNCTION c12_validate_job_mutation();
DROP TRIGGER IF EXISTS design_option_attempts_validate ON design_option_attempts;
CREATE TRIGGER design_option_attempts_validate BEFORE UPDATE OR DELETE ON design_option_attempts
FOR EACH ROW EXECUTE FUNCTION c12_validate_attempt_mutation();
DROP TRIGGER IF EXISTS design_option_heads_validate ON design_option_heads;
CREATE TRIGGER design_option_heads_validate BEFORE UPDATE OR DELETE ON design_option_heads
FOR EACH ROW EXECUTE FUNCTION c12_validate_option_head_mutation();
DROP TRIGGER IF EXISTS design_option_idempotency_validate ON design_option_idempotency_effects;
CREATE TRIGGER design_option_idempotency_validate BEFORE UPDATE OR DELETE ON design_option_idempotency_effects
FOR EACH ROW EXECUTE FUNCTION c12_validate_idempotency_mutation();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'design_option_sets', 'design_option_bundles', 'design_options',
    'design_option_state_events', 'design_option_job_state_events',
    'design_option_confirmations', 'design_option_audit_events', 'design_option_outbox'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_append_only ON %I', table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER %I_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION c12_reject_append_only_mutation()',
      table_name, table_name
    );
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION c12_current_tenant_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'design_option_jobs', 'design_option_attempts', 'design_option_sets',
    'design_option_bundles', 'design_options', 'design_option_heads',
    'design_option_state_events', 'design_option_job_state_events',
    'design_option_idempotency_effects', 'design_option_confirmations',
    'design_option_audit_events', 'design_option_outbox'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_policy ON %I', table_name, table_name);
    EXECUTE format(
      'CREATE POLICY %I_tenant_policy ON %I USING (tenant_id = c12_current_tenant_id()) WITH CHECK (tenant_id = c12_current_tenant_id())',
      table_name, table_name
    );
  END LOOP;
END
$$;

INSERT INTO platform_schema_migrations (id)
VALUES ('0012_design_options')
ON CONFLICT (id) DO NOTHING;
