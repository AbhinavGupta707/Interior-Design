DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM platform_schema_migrations WHERE id = '0004_canonical_models'
  ) THEN
    RAISE EXCEPTION 'C5 requires migration 0004_canonical_models';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS model_branches (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  model_id uuid NOT NULL,
  profile text NOT NULL CHECK (profile IN ('existing', 'proposed', 'as-built')),
  id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  source_snapshot_id uuid NOT NULL,
  source_snapshot_sha256 text NOT NULL CHECK (source_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  source_snapshot_version integer NOT NULL CHECK (source_snapshot_version >= 1),
  head_snapshot_id uuid NOT NULL,
  head_snapshot_sha256 text NOT NULL CHECK (head_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  head_snapshot_version integer NOT NULL CHECK (head_snapshot_version >= 1),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_by uuid NOT NULL REFERENCES identity_users(id),
  created_at timestamptz NOT NULL,
  updated_by uuid NOT NULL REFERENCES identity_users(id),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, model_id, profile, id),
  UNIQUE (tenant_id, project_id, profile, id),
  FOREIGN KEY (tenant_id, project_id, model_id, profile)
    REFERENCES canonical_model_profiles(tenant_id, project_id, model_id, profile)
    ON DELETE RESTRICT,
  FOREIGN KEY (
    tenant_id, project_id, model_id, profile,
    source_snapshot_id, source_snapshot_sha256, source_snapshot_version
  ) REFERENCES canonical_model_snapshots (
    tenant_id, project_id, model_id, profile, id, snapshot_sha256, version
  ) ON DELETE RESTRICT,
  FOREIGN KEY (
    tenant_id, project_id, model_id, profile,
    head_snapshot_id, head_snapshot_sha256, head_snapshot_version
  ) REFERENCES canonical_model_snapshots (
    tenant_id, project_id, model_id, profile, id, snapshot_sha256, version
  ) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS model_branches_route_idx
  ON model_branches (tenant_id, project_id, profile, id);
CREATE INDEX IF NOT EXISTS model_branches_list_idx
  ON model_branches (tenant_id, project_id, profile, created_at, id);

CREATE TABLE IF NOT EXISTS model_operation_previews (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  model_id uuid NOT NULL,
  profile text NOT NULL CHECK (profile IN ('existing', 'proposed', 'as-built')),
  branch_id uuid NOT NULL,
  id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES identity_users(id),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  base_revision integer NOT NULL CHECK (base_revision >= 0),
  base_snapshot_id uuid NOT NULL,
  base_snapshot_sha256 text NOT NULL CHECK (base_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  base_snapshot_version integer NOT NULL CHECK (base_snapshot_version >= 1),
  operation_payload jsonb NOT NULL CHECK (
    jsonb_typeof(operation_payload) = 'array'
    AND jsonb_array_length(operation_payload) BETWEEN 1 AND 50
  ),
  operation_payload_sha256 text NOT NULL CHECK (operation_payload_sha256 ~ '^[0-9a-f]{64}$'),
  result_snapshot_sha256 text NOT NULL CHECK (result_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  result_canonical_byte_length integer NOT NULL CHECK (
    result_canonical_byte_length BETWEEN 1 AND 10485760
  ),
  findings jsonb NOT NULL CHECK (
    jsonb_typeof(findings) = 'array' AND jsonb_array_length(findings) <= 10000
  ),
  has_blocking_findings boolean NOT NULL,
  PRIMARY KEY (tenant_id, project_id, model_id, profile, branch_id, id),
  UNIQUE (tenant_id, project_id, profile, branch_id, id),
  FOREIGN KEY (tenant_id, project_id, model_id, profile, branch_id)
    REFERENCES model_branches(tenant_id, project_id, model_id, profile, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (
    tenant_id, project_id, model_id, profile,
    base_snapshot_id, base_snapshot_sha256, base_snapshot_version
  ) REFERENCES canonical_model_snapshots (
    tenant_id, project_id, model_id, profile, id, snapshot_sha256, version
  ) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS model_operation_previews_expiry_idx
  ON model_operation_previews (expires_at, tenant_id, project_id, model_id, profile, branch_id);

CREATE TABLE IF NOT EXISTS model_operation_commits (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  model_id uuid NOT NULL,
  profile text NOT NULL CHECK (profile IN ('existing', 'proposed', 'as-built')),
  branch_id uuid NOT NULL,
  id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  message text NOT NULL CHECK (char_length(btrim(message)) BETWEEN 1 AND 500),
  preview_id uuid,
  operation_count integer NOT NULL CHECK (operation_count BETWEEN 1 AND 50),
  parent_snapshot_id uuid NOT NULL,
  parent_snapshot_sha256 text NOT NULL CHECK (parent_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  parent_snapshot_version integer NOT NULL CHECK (parent_snapshot_version >= 1),
  snapshot_id uuid NOT NULL,
  snapshot_sha256 text NOT NULL CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  snapshot_version integer NOT NULL CHECK (snapshot_version >= 1),
  validation_findings jsonb NOT NULL CHECK (
    jsonb_typeof(validation_findings) = 'array'
    AND jsonb_array_length(validation_findings) <= 10000
  ),
  committed_by uuid NOT NULL REFERENCES identity_users(id),
  committed_at timestamptz NOT NULL,
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  trace_id text NOT NULL CHECK (trace_id ~ '^[0-9a-f]{32}$'),
  PRIMARY KEY (tenant_id, project_id, model_id, profile, branch_id, id),
  UNIQUE (tenant_id, project_id, profile, branch_id, id),
  UNIQUE (tenant_id, project_id, model_id, profile, branch_id, revision),
  UNIQUE (tenant_id, project_id, model_id, profile, branch_id, preview_id),
  FOREIGN KEY (tenant_id, project_id, model_id, profile, branch_id)
    REFERENCES model_branches(tenant_id, project_id, model_id, profile, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, model_id, profile, branch_id, preview_id)
    REFERENCES model_operation_previews(tenant_id, project_id, model_id, profile, branch_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (
    tenant_id, project_id, model_id, profile,
    parent_snapshot_id, parent_snapshot_sha256, parent_snapshot_version
  ) REFERENCES canonical_model_snapshots (
    tenant_id, project_id, model_id, profile, id, snapshot_sha256, version
  ) ON DELETE RESTRICT,
  FOREIGN KEY (
    tenant_id, project_id, model_id, profile,
    snapshot_id, snapshot_sha256, snapshot_version
  ) REFERENCES canonical_model_snapshots (
    tenant_id, project_id, model_id, profile, id, snapshot_sha256, version
  ) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS model_operation_commits_history_idx
  ON model_operation_commits (
    tenant_id, project_id, model_id, profile, branch_id, revision DESC
  );

CREATE TABLE IF NOT EXISTS model_operation_envelopes (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  model_id uuid NOT NULL,
  profile text NOT NULL CHECK (profile IN ('existing', 'proposed', 'as-built')),
  branch_id uuid NOT NULL,
  commit_id uuid NOT NULL,
  id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 49),
  schema_version text NOT NULL CHECK (schema_version = 'c5-model-operation-v1'),
  type text NOT NULL CHECK (type IN (
    'snapshot.initialize.v1',
    'snapshot.restore.v1',
    'level.create.v1',
    'wall.create.v1',
    'wall.translate.v1',
    'opening.insert.v1',
    'space.create.v1',
    'space.rename.v1',
    'element.metadata.correct.v1',
    'element.provenance.correct.v1'
  )),
  client_operation_id uuid NOT NULL,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
  operation_payload jsonb NOT NULL CHECK (
    jsonb_typeof(operation_payload) = 'object'
    AND operation_payload ->> 'schemaVersion' = schema_version
    AND operation_payload ->> 'type' = type
    AND operation_payload ->> 'clientOperationId' = client_operation_id::text
    AND operation_payload ->> 'reason' = reason
  ),
  committed_by uuid NOT NULL REFERENCES identity_users(id),
  committed_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, model_id, profile, branch_id, commit_id, id),
  UNIQUE (tenant_id, project_id, model_id, profile, branch_id, commit_id, ordinal),
  UNIQUE (tenant_id, project_id, model_id, profile, branch_id, client_operation_id),
  UNIQUE (tenant_id, project_id, profile, branch_id, id),
  FOREIGN KEY (tenant_id, project_id, model_id, profile, branch_id, commit_id)
    REFERENCES model_operation_commits(tenant_id, project_id, model_id, profile, branch_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS model_operation_envelopes_history_idx
  ON model_operation_envelopes (
    tenant_id, project_id, model_id, profile, branch_id, revision DESC, ordinal DESC, id DESC
  );

CREATE TABLE IF NOT EXISTS model_operation_idempotency (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  model_id uuid NOT NULL,
  profile text NOT NULL CHECK (profile IN ('existing', 'proposed', 'as-built')),
  branch_id uuid,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  actor_user_id uuid NOT NULL REFERENCES identity_users(id),
  operation text NOT NULL CHECK (operation IN (
    'model.branch.create',
    'model.operation.preview',
    'model.operation.commit',
    'model.branch.restore',
    'snapshot.initialize.v1'
  )),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  response_kind text CHECK (response_kind IN ('branch', 'preview', 'commit', 'snapshot')),
  response_id uuid,
  response_status integer CHECK (response_status IN (200, 201)),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  PRIMARY KEY (tenant_id, project_id, model_id, profile, idempotency_key),
  CONSTRAINT model_operation_idempotency_completion CHECK (
    (
      response_kind IS NULL AND response_id IS NULL
      AND response_status IS NULL AND completed_at IS NULL
    ) OR (
      response_kind IS NOT NULL AND response_id IS NOT NULL
      AND response_status IS NOT NULL AND completed_at IS NOT NULL
    )
  )
);

CREATE TABLE IF NOT EXISTS model_domain_audit_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  model_id uuid NOT NULL,
  profile text NOT NULL CHECK (profile IN ('existing', 'proposed', 'as-built')),
  branch_id uuid NOT NULL,
  commit_id uuid,
  revision integer NOT NULL CHECK (revision >= 0),
  action text NOT NULL CHECK (action IN (
    'model:snapshot:create',
    'model:branch:create',
    'model:branch:read',
    'model:branch:compare',
    'model:operation:preview',
    'model:operation:commit',
    'model:branch:restore',
    'model:operation:history',
    'model:audit:read'
  )),
  event_type text NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9.-]{2,79}$'),
  operation_types jsonb NOT NULL CHECK (
    jsonb_typeof(operation_types) = 'array'
    AND jsonb_array_length(operation_types) <= 50
  ),
  outcome text NOT NULL CHECK (outcome IN ('accepted', 'denied')),
  snapshot_id uuid NOT NULL,
  snapshot_sha256 text NOT NULL CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  actor_user_id uuid NOT NULL REFERENCES identity_users(id),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  trace_id text NOT NULL CHECK (trace_id ~ '^[0-9a-f]{32}$'),
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, project_id, model_id, profile, branch_id)
    REFERENCES model_branches(tenant_id, project_id, model_id, profile, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, model_id, profile, branch_id, commit_id)
    REFERENCES model_operation_commits(tenant_id, project_id, model_id, profile, branch_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, model_id, profile, snapshot_id)
    REFERENCES canonical_model_snapshots(tenant_id, project_id, model_id, profile, id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS model_domain_audit_events_history_idx
  ON model_domain_audit_events (
    tenant_id, project_id, model_id, profile, branch_id, occurred_at DESC, id DESC
  );

CREATE TABLE IF NOT EXISTS model_transactional_outbox (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  model_id uuid NOT NULL,
  profile text NOT NULL CHECK (profile IN ('existing', 'proposed', 'as-built')),
  branch_id uuid NOT NULL,
  commit_id uuid,
  revision integer NOT NULL CHECK (revision >= 0),
  event_type text NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9.-]{2,79}$'),
  schema_version text NOT NULL CHECK (schema_version = 'c5-model-operation-v1'),
  payload jsonb NOT NULL CHECK (
    jsonb_typeof(payload) = 'object'
    AND NOT payload ?| ARRAY['snapshot', 'canonicalSnapshot', 'token', 'credential', 'previewId']
  ),
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, project_id, model_id, profile, branch_id)
    REFERENCES model_branches(tenant_id, project_id, model_id, profile, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, model_id, profile, branch_id, commit_id)
    REFERENCES model_operation_commits(tenant_id, project_id, model_id, profile, branch_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS model_transactional_outbox_poll_idx
  ON model_transactional_outbox (occurred_at, id);

CREATE OR REPLACE FUNCTION c5_reject_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE OR REPLACE FUNCTION c5_validate_branch_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'model branches cannot be deleted';
  END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.model_id IS DISTINCT FROM NEW.model_id
    OR OLD.profile IS DISTINCT FROM NEW.profile
    OR OLD.id IS DISTINCT FROM NEW.id
    OR OLD.name IS DISTINCT FROM NEW.name
    OR OLD.source_snapshot_id IS DISTINCT FROM NEW.source_snapshot_id
    OR OLD.source_snapshot_sha256 IS DISTINCT FROM NEW.source_snapshot_sha256
    OR OLD.source_snapshot_version IS DISTINCT FROM NEW.source_snapshot_version
    OR OLD.created_by IS DISTINCT FROM NEW.created_by
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR NEW.revision <> OLD.revision + 1
    OR NEW.updated_at <= OLD.updated_at
  THEN
    RAISE EXCEPTION 'invalid model branch head mutation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION c5_validate_preview_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR OLD.expires_at > statement_timestamp() THEN
    RAISE EXCEPTION 'model operation previews are immutable until expiry';
  END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION c5_validate_idempotency_completion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'model operation idempotency records cannot be deleted';
  END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.model_id IS DISTINCT FROM NEW.model_id
    OR OLD.profile IS DISTINCT FROM NEW.profile
    OR OLD.branch_id IS DISTINCT FROM NEW.branch_id
    OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key
    OR OLD.actor_user_id IS DISTINCT FROM NEW.actor_user_id
    OR OLD.operation IS DISTINCT FROM NEW.operation
    OR OLD.request_hash IS DISTINCT FROM NEW.request_hash
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR OLD.completed_at IS NOT NULL
    OR NEW.completed_at IS NULL
    OR NEW.response_kind IS NULL
    OR NEW.response_id IS NULL
    OR NEW.response_status IS NULL
  THEN
    RAISE EXCEPTION 'invalid model operation idempotency completion';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS model_branches_validate_mutation ON model_branches;
CREATE TRIGGER model_branches_validate_mutation
BEFORE UPDATE OR DELETE ON model_branches
FOR EACH ROW EXECUTE FUNCTION c5_validate_branch_mutation();

DROP TRIGGER IF EXISTS model_operation_previews_validate_mutation ON model_operation_previews;
CREATE TRIGGER model_operation_previews_validate_mutation
BEFORE UPDATE OR DELETE ON model_operation_previews
FOR EACH ROW EXECUTE FUNCTION c5_validate_preview_delete();

DROP TRIGGER IF EXISTS model_operation_idempotency_validate ON model_operation_idempotency;
CREATE TRIGGER model_operation_idempotency_validate
BEFORE UPDATE OR DELETE ON model_operation_idempotency
FOR EACH ROW EXECUTE FUNCTION c5_validate_idempotency_completion();

DROP TRIGGER IF EXISTS model_operation_commits_append_only ON model_operation_commits;
CREATE TRIGGER model_operation_commits_append_only
BEFORE UPDATE OR DELETE ON model_operation_commits
FOR EACH ROW EXECUTE FUNCTION c5_reject_append_only_mutation();

DROP TRIGGER IF EXISTS model_operation_envelopes_append_only ON model_operation_envelopes;
CREATE TRIGGER model_operation_envelopes_append_only
BEFORE UPDATE OR DELETE ON model_operation_envelopes
FOR EACH ROW EXECUTE FUNCTION c5_reject_append_only_mutation();

DROP TRIGGER IF EXISTS model_domain_audit_events_append_only ON model_domain_audit_events;
CREATE TRIGGER model_domain_audit_events_append_only
BEFORE UPDATE OR DELETE ON model_domain_audit_events
FOR EACH ROW EXECUTE FUNCTION c5_reject_append_only_mutation();

DROP TRIGGER IF EXISTS model_transactional_outbox_append_only ON model_transactional_outbox;
CREATE TRIGGER model_transactional_outbox_append_only
BEFORE UPDATE OR DELETE ON model_transactional_outbox
FOR EACH ROW EXECUTE FUNCTION c5_reject_append_only_mutation();

INSERT INTO platform_schema_migrations (id)
VALUES ('0005_model_operations')
ON CONFLICT (id) DO NOTHING;
