DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM platform_schema_migrations WHERE id = '0001_identity_projects_intake'
  ) THEN
    RAISE EXCEPTION 'C4 requires migration 0001_identity_projects_intake';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM platform_schema_migrations WHERE id = '0002_assets_evidence'
  ) THEN
    RAISE EXCEPTION 'C4 requires migration 0002_assets_evidence';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM platform_schema_migrations WHERE id = '0003_property_dossier'
  ) THEN
    RAISE EXCEPTION 'C4 requires migration 0003_property_dossier';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS canonical_model_profiles (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  model_id uuid NOT NULL,
  profile text NOT NULL CHECK (profile IN ('existing', 'proposed', 'as-built')),
  current_snapshot_id uuid,
  current_snapshot_sha256 text CHECK (
    current_snapshot_sha256 IS NULL OR current_snapshot_sha256 ~ '^[0-9a-f]{64}$'
  ),
  current_snapshot_version integer CHECK (
    current_snapshot_version IS NULL OR current_snapshot_version >= 1
  ),
  updated_at timestamptz,
  updated_by uuid REFERENCES identity_users(id),
  PRIMARY KEY (tenant_id, project_id, profile),
  UNIQUE (tenant_id, project_id, model_id, profile),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_model_profiles_pointer_consistency CHECK (
    (
      current_snapshot_id IS NULL
      AND current_snapshot_sha256 IS NULL
      AND current_snapshot_version IS NULL
      AND updated_at IS NULL
      AND updated_by IS NULL
    )
    OR (
      current_snapshot_id IS NOT NULL
      AND current_snapshot_sha256 IS NOT NULL
      AND current_snapshot_version IS NOT NULL
      AND updated_at IS NOT NULL
      AND updated_by IS NOT NULL
    )
  )
);

CREATE TABLE IF NOT EXISTS canonical_model_snapshots (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  model_id uuid NOT NULL,
  profile text NOT NULL CHECK (profile IN ('existing', 'proposed', 'as-built')),
  property_id uuid,
  derived_from_snapshot_sha256 text CHECK (
    derived_from_snapshot_sha256 IS NULL
    OR derived_from_snapshot_sha256 ~ '^[0-9a-f]{64}$'
  ),
  version integer NOT NULL CHECK (version >= 1),
  schema_version text NOT NULL CHECK (schema_version = 'c4-canonical-home-v1'),
  canonical_snapshot jsonb NOT NULL CHECK (jsonb_typeof(canonical_snapshot) = 'object'),
  snapshot_sha256 text NOT NULL CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  canonical_byte_length integer NOT NULL CHECK (
    canonical_byte_length BETWEEN 1 AND 10485760
  ),
  validation_findings jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(validation_findings) = 'array'
    AND jsonb_array_length(validation_findings) <= 10000
  ),
  created_by uuid NOT NULL REFERENCES identity_users(id),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, model_id, profile, id),
  UNIQUE (tenant_id, project_id, profile, id),
  UNIQUE (
    tenant_id,
    project_id,
    model_id,
    profile,
    id,
    snapshot_sha256,
    version
  ),
  UNIQUE (tenant_id, project_id, model_id, profile, version),
  FOREIGN KEY (tenant_id, project_id, model_id, profile)
    REFERENCES canonical_model_profiles(tenant_id, project_id, model_id, profile)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, property_id)
    REFERENCES property_identities(tenant_id, project_id, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_model_snapshots_profile_derivation CHECK (
    (profile = 'existing' AND derived_from_snapshot_sha256 IS NULL)
    OR (profile IN ('proposed', 'as-built') AND derived_from_snapshot_sha256 IS NOT NULL)
  ),
  CONSTRAINT canonical_model_snapshots_json_boundary CHECK (
    canonical_snapshot ->> 'schemaVersion' = schema_version
    AND canonical_snapshot ->> 'projectId' = project_id::text
    AND canonical_snapshot ->> 'modelId' = model_id::text
    AND canonical_snapshot ->> 'profile' = profile
    AND (
      (property_id IS NULL AND NOT canonical_snapshot ? 'propertyId')
      OR canonical_snapshot ->> 'propertyId' = property_id::text
    )
    AND (
      (
        derived_from_snapshot_sha256 IS NULL
        AND NOT canonical_snapshot ? 'derivedFromSnapshotSha256'
      )
      OR canonical_snapshot ->> 'derivedFromSnapshotSha256' = derived_from_snapshot_sha256
    )
  )
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'canonical_model_profiles_current_snapshot_fkey'
      AND conrelid = 'canonical_model_profiles'::regclass
  ) THEN
    ALTER TABLE canonical_model_profiles
      ADD CONSTRAINT canonical_model_profiles_current_snapshot_fkey
      FOREIGN KEY (
        tenant_id,
        project_id,
        model_id,
        profile,
        current_snapshot_id,
        current_snapshot_sha256,
        current_snapshot_version
      )
      REFERENCES canonical_model_snapshots (
        tenant_id,
        project_id,
        model_id,
        profile,
        id,
        snapshot_sha256,
        version
      )
      ON DELETE RESTRICT;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS canonical_model_snapshots_route_lookup_idx
  ON canonical_model_snapshots (tenant_id, project_id, profile, id);

CREATE INDEX IF NOT EXISTS canonical_model_snapshots_hash_lookup_idx
  ON canonical_model_snapshots (tenant_id, project_id, snapshot_sha256);

CREATE INDEX IF NOT EXISTS canonical_model_snapshots_property_idx
  ON canonical_model_snapshots (tenant_id, project_id, property_id)
  WHERE property_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS canonical_model_idempotency (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  profile text NOT NULL CHECK (profile IN ('existing', 'proposed', 'as-built')),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  actor_user_id uuid NOT NULL REFERENCES identity_users(id),
  operation text NOT NULL CHECK (operation = 'canonical-model.snapshot.create'),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  response_status integer CHECK (response_status IS NULL OR response_status = 201),
  response_snapshot_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  PRIMARY KEY (tenant_id, project_id, profile, idempotency_key),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, profile, response_snapshot_id)
    REFERENCES canonical_model_snapshots(tenant_id, project_id, profile, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_model_idempotency_completion CHECK (
    (
      response_status IS NULL
      AND response_snapshot_id IS NULL
      AND completed_at IS NULL
    )
    OR (
      response_status = 201
      AND response_snapshot_id IS NOT NULL
      AND completed_at IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS canonical_model_idempotency_response_idx
  ON canonical_model_idempotency (tenant_id, project_id, profile, response_snapshot_id)
  WHERE response_snapshot_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS canonical_model_audit_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  model_id uuid NOT NULL,
  profile text NOT NULL CHECK (profile IN ('existing', 'proposed', 'as-built')),
  snapshot_id uuid NOT NULL,
  snapshot_sha256 text NOT NULL CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  actor_user_id uuid NOT NULL REFERENCES identity_users(id),
  action text NOT NULL CHECK (action = 'canonical-model.snapshot.create'),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  trace_id text NOT NULL CHECK (trace_id ~ '^[0-9a-f]{32}$'),
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, project_id, model_id, profile, snapshot_id)
    REFERENCES canonical_model_snapshots(tenant_id, project_id, model_id, profile, id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS canonical_model_audit_events_project_time_idx
  ON canonical_model_audit_events (tenant_id, project_id, occurred_at, id);

CREATE INDEX IF NOT EXISTS canonical_model_audit_events_snapshot_idx
  ON canonical_model_audit_events (tenant_id, project_id, model_id, profile, snapshot_id);

CREATE OR REPLACE FUNCTION c4_reject_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS canonical_model_snapshots_append_only ON canonical_model_snapshots;
CREATE TRIGGER canonical_model_snapshots_append_only
BEFORE UPDATE OR DELETE ON canonical_model_snapshots
FOR EACH ROW EXECUTE FUNCTION c4_reject_append_only_mutation();

DROP TRIGGER IF EXISTS canonical_model_audit_events_append_only ON canonical_model_audit_events;
CREATE TRIGGER canonical_model_audit_events_append_only
BEFORE UPDATE OR DELETE ON canonical_model_audit_events
FOR EACH ROW EXECUTE FUNCTION c4_reject_append_only_mutation();

CREATE OR REPLACE FUNCTION c4_validate_profile_pointer_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'canonical model profiles cannot be deleted';
  END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.model_id IS DISTINCT FROM NEW.model_id
    OR OLD.profile IS DISTINCT FROM NEW.profile
  THEN
    RAISE EXCEPTION 'canonical model profile identity is immutable';
  END IF;
  IF OLD.current_snapshot_version IS NULL THEN
    IF NEW.current_snapshot_version <> 1 THEN
      RAISE EXCEPTION 'first canonical model profile version must be one';
    END IF;
  ELSIF NEW.current_snapshot_version <> OLD.current_snapshot_version + 1 THEN
    RAISE EXCEPTION 'canonical model profile version must advance by one';
  END IF;
  IF NEW.current_snapshot_id IS NULL
    OR NEW.current_snapshot_sha256 IS NULL
    OR NEW.updated_at IS NULL
    OR NEW.updated_by IS NULL
  THEN
    RAISE EXCEPTION 'canonical model current pointer must be complete';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS canonical_model_profiles_validate_pointer ON canonical_model_profiles;
CREATE TRIGGER canonical_model_profiles_validate_pointer
BEFORE UPDATE OR DELETE ON canonical_model_profiles
FOR EACH ROW EXECUTE FUNCTION c4_validate_profile_pointer_mutation();

CREATE OR REPLACE FUNCTION c4_validate_idempotency_completion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'canonical model idempotency records cannot be deleted';
  END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.profile IS DISTINCT FROM NEW.profile
    OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key
    OR OLD.actor_user_id IS DISTINCT FROM NEW.actor_user_id
    OR OLD.operation IS DISTINCT FROM NEW.operation
    OR OLD.request_hash IS DISTINCT FROM NEW.request_hash
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR OLD.completed_at IS NOT NULL
    OR OLD.response_status IS NOT NULL
    OR OLD.response_snapshot_id IS NOT NULL
    OR NEW.completed_at IS NULL
    OR NEW.response_status <> 201
    OR NEW.response_snapshot_id IS NULL
  THEN
    RAISE EXCEPTION 'invalid canonical model idempotency completion';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS canonical_model_idempotency_validate ON canonical_model_idempotency;
CREATE TRIGGER canonical_model_idempotency_validate
BEFORE UPDATE OR DELETE ON canonical_model_idempotency
FOR EACH ROW EXECUTE FUNCTION c4_validate_idempotency_completion();

INSERT INTO platform_schema_migrations (id)
VALUES ('0004_canonical_models')
ON CONFLICT (id) DO NOTHING;
