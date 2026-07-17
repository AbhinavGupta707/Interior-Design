DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform_schema_migrations WHERE id = '0005_model_operations') THEN
    RAISE EXCEPTION 'C9 requires migration 0005_model_operations';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform_schema_migrations WHERE id = '0006_plan_processing') THEN
    RAISE EXCEPTION 'C9 requires migration 0006_plan_processing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform_schema_migrations WHERE id = '0007_native_capture') THEN
    RAISE EXCEPTION 'C9 requires migration 0007_native_capture';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform_schema_migrations WHERE id = '0008_reconstruction') THEN
    RAISE EXCEPTION 'C9 requires migration 0008_reconstruction';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS fusion_jobs (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  request_payload jsonb NOT NULL CHECK (
    jsonb_typeof(request_payload) = 'object'
    AND request_payload ->> 'inferencePolicy' = 'label-and-expose'
    AND jsonb_array_length(request_payload -> 'sources') BETWEEN 2 AND 32
  ),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  source_manifest_sha256 text NOT NULL CHECK (source_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 3),
  state text NOT NULL CHECK (state IN (
    'queued', 'registering', 'fitting', 'comparing', 'proposed', 'abstained',
    'cancel-requested', 'cancelled', 'failed'
  )),
  proposal_id uuid,
  retryable boolean NOT NULL DEFAULT false,
  safe_code text CHECK (safe_code IS NULL OR safe_code ~ '^[A-Z][A-Z0-9_]{2,79}$'),
  created_by uuid NOT NULL REFERENCES identity_users(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  PRIMARY KEY (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fusion_jobs_proposal_state CHECK ((state = 'proposed') = (proposal_id IS NOT NULL)),
  CONSTRAINT fusion_jobs_safe_state CHECK (
    ((state IN ('abstained', 'failed')) = (safe_code IS NOT NULL))
  ),
  CONSTRAINT fusion_jobs_retryable_state CHECK (
    NOT retryable OR state IN ('cancelled', 'failed', 'abstained')
  )
);

CREATE INDEX IF NOT EXISTS fusion_jobs_list_idx
  ON fusion_jobs (tenant_id, project_id, created_at DESC, id);
CREATE INDEX IF NOT EXISTS fusion_jobs_queue_idx
  ON fusion_jobs (created_at, id)
  WHERE state IN ('queued', 'registering', 'fitting', 'comparing', 'cancel-requested');

CREATE TABLE IF NOT EXISTS fusion_job_sources (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid NOT NULL,
  source_id uuid NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN (
    'plan-proposal', 'roomplan-proposal', 'reconstruction-result',
    'measurement-set', 'user-assertion-set'
  )),
  reference_id uuid NOT NULL,
  schema_version text NOT NULL CHECK (char_length(schema_version) BETWEEN 1 AND 100),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  element_count integer NOT NULL CHECK (element_count BETWEEN 0 AND 100000),
  evidence_state text NOT NULL CHECK (evidence_state IN (
    'observed', 'source-derived', 'fused', 'inferred', 'user-asserted'
  )),
  coordinate_frame text NOT NULL CHECK (coordinate_frame IN (
    'project-local', 'source-local-metric', 'source-local-arbitrary'
  )),
  scale_status text NOT NULL CHECK (scale_status IN (
    'metric-validated', 'metric-estimated', 'unknown'
  )),
  service_processing_consent boolean NOT NULL CHECK (service_processing_consent),
  training_use_consent text NOT NULL CHECK (training_use_consent = 'denied'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, job_id, source_id),
  CONSTRAINT fusion_job_sources_exact_unique
    UNIQUE (tenant_id, project_id, job_id, source_kind, reference_id),
  FOREIGN KEY (tenant_id, project_id, job_id)
    REFERENCES fusion_jobs(tenant_id, project_id, id) ON DELETE RESTRICT,
  CONSTRAINT fusion_job_sources_scale CHECK (
    coordinate_frame <> 'project-local' OR scale_status <> 'unknown'
  ),
  CONSTRAINT fusion_job_sources_assertion CHECK (
    (source_kind = 'user-assertion-set') = (evidence_state = 'user-asserted')
  )
);

CREATE TABLE IF NOT EXISTS fusion_source_rights_withdrawals (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN (
    'plan-proposal', 'roomplan-proposal', 'reconstruction-result',
    'measurement-set', 'user-assertion-set'
  )),
  reference_id uuid NOT NULL,
  reason_code text NOT NULL CHECK (reason_code = 'RIGHTS_WITHDRAWN'),
  withdrawn_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, source_kind, reference_id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION c9_source_rights_active(
  requested_tenant uuid,
  requested_project uuid,
  requested_kind text,
  requested_reference uuid
) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE active boolean;
BEGIN
  IF requested_kind = 'plan-proposal' THEN
    SELECT j.state = 'proposed' AND a.status = 'ready'
      AND ar.service_processing_consent AND ar.training_use_consent = 'denied'
    INTO active
    FROM plan_processing_results r
    JOIN plan_processing_jobs j
      ON j.tenant_id = r.tenant_id AND j.project_id = r.project_id AND j.id = r.job_id
    JOIN assets a
      ON a.tenant_id = j.tenant_id AND a.project_id = j.project_id AND a.id = j.asset_id
    JOIN asset_rights_assertions ar
      ON ar.tenant_id = a.tenant_id AND ar.project_id = a.project_id AND ar.asset_id = a.id
    WHERE r.tenant_id = requested_tenant AND r.project_id = requested_project
      AND r.id = requested_reference AND r.status = 'proposal' LIMIT 1;
  ELSIF requested_kind = 'roomplan-proposal' THEN
    SELECT e.permitted AND e.service_processing_consent AND e.training_use_consent = 'denied'
    INTO active
    FROM capture_results r JOIN LATERAL (
      SELECT permitted, service_processing_consent, training_use_consent
      FROM capture_rights_events
      WHERE tenant_id = r.tenant_id AND project_id = r.project_id
        AND capture_session_id = r.capture_session_id
      ORDER BY occurred_at DESC, id DESC LIMIT 1
    ) e ON true
    WHERE r.tenant_id = requested_tenant AND r.project_id = requested_project
      AND r.id = requested_reference AND r.status = 'proposal' LIMIT 1;
  ELSIF requested_kind = 'reconstruction-result' THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM reconstruction_job_sources s
      JOIN assets a
        ON a.tenant_id = s.tenant_id AND a.project_id = s.project_id AND a.id = s.asset_id
      JOIN asset_rights_assertions ar
        ON ar.tenant_id = s.tenant_id AND ar.project_id = s.project_id AND ar.asset_id = s.asset_id
      LEFT JOIN reconstruction_rights_withdrawals w
        ON w.tenant_id = s.tenant_id AND w.project_id = s.project_id AND w.asset_id = s.asset_id
      WHERE s.tenant_id = r.tenant_id AND s.project_id = r.project_id AND s.job_id = r.job_id
        AND (a.status <> 'ready' OR NOT ar.service_processing_consent
          OR ar.training_use_consent <> 'denied' OR w.asset_id IS NOT NULL)
    ) INTO active
    FROM reconstruction_results r
    WHERE r.tenant_id = requested_tenant AND r.project_id = requested_project
      AND r.id = requested_reference AND r.status = 'completed' LIMIT 1;
  ELSE
    active := false;
  END IF;
  RETURN coalesce(active, false);
END;
$$;

CREATE TABLE IF NOT EXISTS fusion_attempts (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid NOT NULL,
  attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 3),
  state text NOT NULL CHECK (state IN (
    'queued', 'leased', 'cancel-requested', 'cancelled', 'succeeded', 'failed'
  )),
  stage text NOT NULL CHECK (stage IN ('registering', 'fitting', 'comparing')),
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
  FOREIGN KEY (tenant_id, project_id, job_id)
    REFERENCES fusion_jobs(tenant_id, project_id, id) ON DELETE RESTRICT,
  CONSTRAINT fusion_attempts_lease_state CHECK (
    ((state IN ('leased', 'cancel-requested')) =
      (lease_owner IS NOT NULL AND lease_token IS NOT NULL
        AND lease_expires_at IS NOT NULL AND lease_seconds IS NOT NULL))
  )
);

CREATE INDEX IF NOT EXISTS fusion_attempts_lease_idx
  ON fusion_attempts (state, lease_expires_at, created_at, job_id)
  WHERE state IN ('queued', 'leased', 'cancel-requested');

CREATE TABLE IF NOT EXISTS fusion_proposals (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid NOT NULL,
  attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 3),
  id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('full-house-proposal', 'partial-proposal', 'abstained')),
  base_profile text NOT NULL DEFAULT 'existing' CHECK (base_profile = 'existing'),
  base_snapshot_id uuid NOT NULL,
  base_snapshot_sha256 text NOT NULL CHECK (base_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  source_manifest_sha256 text NOT NULL CHECK (source_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  proposal_payload jsonb NOT NULL CHECK (
    jsonb_typeof(proposal_payload) = 'object'
    AND proposal_payload ->> 'schemaVersion' = 'c9-full-house-proposal-v1'
    AND proposal_payload ->> 'authority' = 'proposal-only'
    AND proposal_payload ->> 'id' = id::text
    AND proposal_payload ->> 'projectId' = project_id::text
    AND proposal_payload ->> 'status' = status
    AND proposal_payload ->> 'sourceManifestSha256' = source_manifest_sha256
    AND (proposal_payload ->> 'version')::int = 1
  ),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, id),
  UNIQUE (tenant_id, project_id, job_id, attempt),
  UNIQUE (tenant_id, project_id, job_id, id),
  FOREIGN KEY (tenant_id, project_id, job_id, attempt)
    REFERENCES fusion_attempts(tenant_id, project_id, job_id, attempt) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, base_profile, base_snapshot_id)
    REFERENCES canonical_model_snapshots(tenant_id, project_id, profile, id) ON DELETE RESTRICT
);

ALTER TABLE fusion_jobs DROP CONSTRAINT IF EXISTS fusion_jobs_proposal_fk;
ALTER TABLE fusion_jobs ADD CONSTRAINT fusion_jobs_proposal_fk
  FOREIGN KEY (tenant_id, project_id, id, proposal_id)
  REFERENCES fusion_proposals(tenant_id, project_id, job_id, id)
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS fusion_proposal_review_heads (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, proposal_id),
  FOREIGN KEY (tenant_id, project_id, proposal_id)
    REFERENCES fusion_proposals(tenant_id, project_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS fusion_discrepancy_decisions (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  id uuid NOT NULL,
  discrepancy_id uuid NOT NULL,
  choice text NOT NULL CHECK (choice IN (
    'accept-candidate', 'keep-base', 'correct', 'mark-unknown', 'defer'
  )),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
  decision_payload jsonb NOT NULL CHECK (
    jsonb_typeof(decision_payload) = 'object'
    AND decision_payload ->> 'choice' = choice
    AND decision_payload ->> 'discrepancyId' = discrepancy_id::text
    AND jsonb_typeof(decision_payload -> 'correctedOperations') = 'array'
    AND jsonb_array_length(decision_payload -> 'correctedOperations') <= 10
  ),
  decided_by uuid NOT NULL REFERENCES identity_users(id),
  decided_at timestamptz NOT NULL,
  version integer NOT NULL CHECK (version >= 2),
  PRIMARY KEY (tenant_id, project_id, proposal_id, id),
  FOREIGN KEY (tenant_id, project_id, proposal_id)
    REFERENCES fusion_proposals(tenant_id, project_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS fusion_decisions_latest_idx
  ON fusion_discrepancy_decisions (
    tenant_id, project_id, proposal_id, discrepancy_id, version DESC, decided_at DESC, id DESC
  );

CREATE TABLE IF NOT EXISTS fusion_operation_drafts (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  id uuid NOT NULL,
  profile text NOT NULL DEFAULT 'existing' CHECK (profile = 'existing'),
  branch_id uuid NOT NULL,
  expected_branch_revision integer NOT NULL CHECK (expected_branch_revision >= 0),
  expected_head_snapshot_sha256 text NOT NULL CHECK (expected_head_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  decision_ids uuid[] NOT NULL CHECK (cardinality(decision_ids) BETWEEN 1 AND 50),
  operation_count integer NOT NULL CHECK (operation_count BETWEEN 1 AND 50),
  draft_payload jsonb NOT NULL CHECK (
    jsonb_typeof(draft_payload) = 'object'
    AND draft_payload ->> 'schemaVersion' = 'c9-operation-draft-v1'
    AND draft_payload ->> 'proposalId' = proposal_id::text
    AND draft_payload ->> 'projectId' = project_id::text
    AND draft_payload ->> 'branchId' = branch_id::text
    AND jsonb_array_length(draft_payload -> 'operations') = operation_count
  ),
  created_by uuid NOT NULL REFERENCES identity_users(id),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, proposal_id, id),
  FOREIGN KEY (tenant_id, project_id, proposal_id)
    REFERENCES fusion_proposals(tenant_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, profile, branch_id)
    REFERENCES model_branches(tenant_id, project_id, profile, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS fusion_audit_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid NOT NULL,
  action text NOT NULL CHECK (action ~ '^fusion[.][a-z0-9.-]{2,100}$'),
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
      'request', 'proposal', 'candidateSnapshot', 'operations', 'correctedOperations',
      'sourcePayload', 'path', 'url', 'signedUrl', 'token', 'credential', 'stdout', 'stderr'
    ]
  ),
  occurred_at timestamptz NOT NULL,
  CHECK ((actor_user_id IS NOT NULL)::integer + (worker_id IS NOT NULL)::integer = 1),
  FOREIGN KEY (tenant_id, project_id, job_id)
    REFERENCES fusion_jobs(tenant_id, project_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS fusion_audit_job_idx
  ON fusion_audit_events (tenant_id, project_id, job_id, occurred_at, id);

CREATE TABLE IF NOT EXISTS fusion_outbox (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type ~ '^fusion[.][a-z0-9.-]{2,100}$'),
  schema_version text NOT NULL CHECK (schema_version = 'c9-fusion-job-v1'),
  payload jsonb NOT NULL CHECK (
    jsonb_typeof(payload) = 'object'
    AND NOT payload ?| ARRAY[
      'request', 'proposal', 'candidateSnapshot', 'operations', 'correctedOperations',
      'sourcePayload', 'path', 'url', 'signedUrl', 'token', 'credential', 'stdout', 'stderr'
    ]
  ),
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, project_id, job_id)
    REFERENCES fusion_jobs(tenant_id, project_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS fusion_outbox_poll_idx ON fusion_outbox (occurred_at, id);

CREATE OR REPLACE FUNCTION c9_reject_append_only_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE OR REPLACE FUNCTION c9_validate_job_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'fusion jobs cannot be deleted'; END IF;
  IF OLD.state = 'proposed' THEN RAISE EXCEPTION 'published proposed fusion jobs are immutable'; END IF;
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
  THEN RAISE EXCEPTION 'fusion job identity is immutable'; END IF;
  IF NOT (
    (OLD.state = 'queued' AND NEW.state IN ('registering', 'cancelled', 'failed'))
    OR (OLD.state = 'registering' AND NEW.state IN (
      'registering', 'fitting', 'abstained', 'cancel-requested', 'failed'
    ))
    OR (OLD.state = 'fitting' AND NEW.state IN (
      'fitting', 'comparing', 'abstained', 'cancel-requested', 'failed'
    ))
    OR (OLD.state = 'comparing' AND NEW.state IN (
      'comparing', 'proposed', 'abstained', 'cancel-requested', 'failed'
    ))
    OR (OLD.state = 'cancel-requested' AND NEW.state IN ('cancelled', 'failed'))
    OR (OLD.state IN ('cancelled', 'failed', 'abstained')
      AND NEW.state = 'queued' AND NEW.attempt = OLD.attempt + 1)
  ) THEN RAISE EXCEPTION 'illegal fusion job transition from % to %', OLD.state, NEW.state; END IF;
  IF NEW.attempt <> OLD.attempt AND NOT (
    OLD.state IN ('cancelled', 'failed', 'abstained')
    AND NEW.state = 'queued' AND NEW.attempt = OLD.attempt + 1
  ) THEN RAISE EXCEPTION 'fusion attempt changed outside retry'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION c9_validate_attempt_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'fusion attempts cannot be deleted'; END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.job_id IS DISTINCT FROM NEW.job_id
    OR OLD.attempt IS DISTINCT FROM NEW.attempt
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR NEW.fence_version <> OLD.fence_version + 1
    OR NEW.updated_at <= OLD.updated_at
  THEN RAISE EXCEPTION 'fusion attempt identity is immutable'; END IF;
  IF OLD.state IN ('cancelled', 'succeeded', 'failed') THEN
    RAISE EXCEPTION 'terminal fusion attempts are immutable';
  END IF;
  IF NOT (
    (OLD.state = 'queued' AND NEW.state IN ('leased', 'cancelled', 'failed'))
    OR (OLD.state = 'leased' AND NEW.state IN ('leased', 'cancel-requested', 'succeeded', 'failed'))
    OR (OLD.state = 'cancel-requested' AND NEW.state IN ('cancelled', 'failed'))
  ) THEN RAISE EXCEPTION 'illegal fusion attempt transition from % to %', OLD.state, NEW.state; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION c9_validate_review_head_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'fusion review heads cannot be deleted'; END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.proposal_id IS DISTINCT FROM NEW.proposal_id
    OR NEW.version <> OLD.version + 1
    OR NEW.updated_at <= OLD.updated_at
  THEN RAISE EXCEPTION 'fusion review head must advance exactly once'; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fusion_jobs_validate_mutation ON fusion_jobs;
CREATE TRIGGER fusion_jobs_validate_mutation BEFORE UPDATE OR DELETE ON fusion_jobs
FOR EACH ROW EXECUTE FUNCTION c9_validate_job_mutation();
DROP TRIGGER IF EXISTS fusion_attempts_validate_mutation ON fusion_attempts;
CREATE TRIGGER fusion_attempts_validate_mutation BEFORE UPDATE OR DELETE ON fusion_attempts
FOR EACH ROW EXECUTE FUNCTION c9_validate_attempt_mutation();
DROP TRIGGER IF EXISTS fusion_review_heads_validate_mutation ON fusion_proposal_review_heads;
CREATE TRIGGER fusion_review_heads_validate_mutation
BEFORE UPDATE OR DELETE ON fusion_proposal_review_heads
FOR EACH ROW EXECUTE FUNCTION c9_validate_review_head_mutation();

DROP TRIGGER IF EXISTS fusion_job_sources_append_only ON fusion_job_sources;
CREATE TRIGGER fusion_job_sources_append_only BEFORE UPDATE OR DELETE ON fusion_job_sources
FOR EACH ROW EXECUTE FUNCTION c9_reject_append_only_mutation();
DROP TRIGGER IF EXISTS fusion_rights_withdrawals_append_only ON fusion_source_rights_withdrawals;
CREATE TRIGGER fusion_rights_withdrawals_append_only BEFORE UPDATE OR DELETE ON fusion_source_rights_withdrawals
FOR EACH ROW EXECUTE FUNCTION c9_reject_append_only_mutation();
DROP TRIGGER IF EXISTS fusion_proposals_append_only ON fusion_proposals;
CREATE TRIGGER fusion_proposals_append_only BEFORE UPDATE OR DELETE ON fusion_proposals
FOR EACH ROW EXECUTE FUNCTION c9_reject_append_only_mutation();
DROP TRIGGER IF EXISTS fusion_decisions_append_only ON fusion_discrepancy_decisions;
CREATE TRIGGER fusion_decisions_append_only BEFORE UPDATE OR DELETE ON fusion_discrepancy_decisions
FOR EACH ROW EXECUTE FUNCTION c9_reject_append_only_mutation();
DROP TRIGGER IF EXISTS fusion_drafts_append_only ON fusion_operation_drafts;
CREATE TRIGGER fusion_drafts_append_only BEFORE UPDATE OR DELETE ON fusion_operation_drafts
FOR EACH ROW EXECUTE FUNCTION c9_reject_append_only_mutation();
DROP TRIGGER IF EXISTS fusion_audit_append_only ON fusion_audit_events;
CREATE TRIGGER fusion_audit_append_only BEFORE UPDATE OR DELETE ON fusion_audit_events
FOR EACH ROW EXECUTE FUNCTION c9_reject_append_only_mutation();
DROP TRIGGER IF EXISTS fusion_outbox_append_only ON fusion_outbox;
CREATE TRIGGER fusion_outbox_append_only BEFORE UPDATE OR DELETE ON fusion_outbox
FOR EACH ROW EXECUTE FUNCTION c9_reject_append_only_mutation();

INSERT INTO platform_schema_migrations (id)
VALUES ('0009_model_fusion')
ON CONFLICT (id) DO NOTHING;
