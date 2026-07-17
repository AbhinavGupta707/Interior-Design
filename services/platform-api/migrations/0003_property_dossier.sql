DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM platform_schema_migrations
    WHERE id = '0001_identity_projects_intake'
  ) THEN
    RAISE EXCEPTION 'C3 requires migration 0001_identity_projects_intake';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM platform_schema_migrations
    WHERE id = '0002_assets_evidence'
  ) THEN
    RAISE EXCEPTION 'C3 requires migration 0002_assets_evidence';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS property_resolution_snapshots (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES identity_users(id),
  query_sha256 text NOT NULL CHECK (query_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('matched', 'ambiguous', 'no-match', 'unavailable')),
  provider_state text NOT NULL CHECK (provider_state IN ('fixture', 'disabled', 'unavailable')),
  candidate_count integer NOT NULL CHECK (candidate_count BETWEEN 0 AND 20),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT property_resolution_status_consistency CHECK (
    (status = 'matched' AND provider_state = 'fixture' AND candidate_count = 1)
    OR (status = 'ambiguous' AND provider_state = 'fixture' AND candidate_count BETWEEN 2 AND 20)
    OR (status = 'no-match' AND provider_state = 'fixture' AND candidate_count = 0)
    OR (status = 'unavailable' AND provider_state IN ('disabled', 'unavailable')
      AND candidate_count = 0)
  ),
  CONSTRAINT property_resolution_expiry CHECK (
    expires_at = created_at + interval '15 minutes'
  )
);

CREATE INDEX IF NOT EXISTS property_resolution_expiry_idx
  ON property_resolution_snapshots (tenant_id, project_id, expires_at, id);

CREATE TABLE IF NOT EXISTS property_resolution_candidates (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  resolution_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  address jsonb NOT NULL CHECK (jsonb_typeof(address) = 'object'),
  display_address text NOT NULL CHECK (char_length(display_address) BETWEEN 1 AND 240),
  identifiers jsonb NOT NULL CHECK (
    jsonb_typeof(identifiers) = 'array' AND jsonb_array_length(identifiers) <= 5
  ),
  jurisdiction text NOT NULL CHECK (
    jurisdiction IN ('england', 'wales', 'scotland', 'northern-ireland', 'unknown')
  ),
  location jsonb CHECK (location IS NULL OR jsonb_typeof(location) = 'object'),
  source jsonb NOT NULL CHECK (
    jsonb_typeof(source) = 'object'
    AND source ->> 'modelTrainingAllowed' = 'false'
    AND source ->> 'serviceProcessingAllowed' = 'true'
  ),
  dossier_seed jsonb NOT NULL CHECK (
    jsonb_typeof(dossier_seed) = 'array' AND jsonb_array_length(dossier_seed) <= 20
  ),
  normalized_payload_sha256 text NOT NULL CHECK (
    normalized_payload_sha256 ~ '^[0-9a-f]{64}$'
  ),
  PRIMARY KEY (tenant_id, project_id, resolution_id, candidate_id),
  FOREIGN KEY (tenant_id, project_id, resolution_id)
    REFERENCES property_resolution_snapshots(tenant_id, project_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS property_resolution_candidate_opaque_id_idx
  ON property_resolution_candidates (tenant_id, project_id, candidate_id);

CREATE TABLE IF NOT EXISTS property_identities (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  mode text NOT NULL CHECK (mode IN ('candidate', 'manual')),
  address jsonb NOT NULL CHECK (jsonb_typeof(address) = 'object'),
  display_address text NOT NULL CHECK (char_length(display_address) BETWEEN 1 AND 240),
  identifiers jsonb NOT NULL CHECK (
    jsonb_typeof(identifiers) = 'array' AND jsonb_array_length(identifiers) <= 5
  ),
  jurisdiction text NOT NULL CHECK (
    jurisdiction IN ('england', 'wales', 'scotland', 'northern-ireland', 'unknown')
  ),
  location jsonb CHECK (location IS NULL OR jsonb_typeof(location) = 'object'),
  source jsonb NOT NULL CHECK (
    jsonb_typeof(source) = 'object'
    AND source ->> 'modelTrainingAllowed' = 'false'
    AND source ->> 'serviceProcessingAllowed' = 'true'
  ),
  dossier_seed jsonb NOT NULL CHECK (
    jsonb_typeof(dossier_seed) = 'array' AND jsonb_array_length(dossier_seed) <= 20
  ),
  selected_at timestamptz NOT NULL,
  selected_by uuid NOT NULL REFERENCES identity_users(id),
  PRIMARY KEY (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT property_manual_identity_has_no_invented_locator CHECK (
    mode <> 'manual' OR (identifiers = '[]'::jsonb AND location IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS project_properties (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  property_id uuid NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  selected_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  updated_by uuid NOT NULL REFERENCES identity_users(id),
  PRIMARY KEY (tenant_id, project_id),
  FOREIGN KEY (tenant_id, project_id, property_id)
    REFERENCES property_identities(tenant_id, project_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS project_properties_identity_idx
  ON project_properties (tenant_id, project_id, property_id);

CREATE TABLE IF NOT EXISTS property_resolution_consumptions (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  resolution_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  property_id uuid NOT NULL,
  consumed_at timestamptz NOT NULL,
  consumed_by uuid NOT NULL REFERENCES identity_users(id),
  PRIMARY KEY (tenant_id, project_id, resolution_id),
  FOREIGN KEY (tenant_id, project_id, resolution_id, candidate_id)
    REFERENCES property_resolution_candidates(tenant_id, project_id, resolution_id, candidate_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, property_id)
    REFERENCES property_identities(tenant_id, project_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS property_resolution_consumptions_property_idx
  ON property_resolution_consumptions (tenant_id, project_id, property_id);

CREATE TABLE IF NOT EXISTS property_source_records (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  property_id uuid NOT NULL,
  source jsonb NOT NULL CHECK (
    jsonb_typeof(source) = 'object'
    AND source ->> 'modelTrainingAllowed' = 'false'
    AND source ->> 'serviceProcessingAllowed' = 'true'
  ),
  fields text[] NOT NULL CHECK (
    cardinality(fields) BETWEEN 1 AND 100 AND array_position(fields, NULL) IS NULL
  ),
  normalized_payload_sha256 text NOT NULL CHECK (
    normalized_payload_sha256 ~ '^[0-9a-f]{64}$'
  ),
  source_fingerprint text NOT NULL CHECK (source_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, project_id, property_id, id),
  UNIQUE (tenant_id, project_id, property_id, source_fingerprint),
  FOREIGN KEY (tenant_id, project_id, property_id)
    REFERENCES property_identities(tenant_id, project_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS property_dossier_versions (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  property_id uuid NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  generated_at timestamptz NOT NULL,
  planning_status text NOT NULL CHECK (planning_status = 'not-reviewed'),
  interior_knowledge_status text NOT NULL CHECK (
    interior_knowledge_status = 'unknown-without-evidence'
  ),
  coverage_warnings jsonb NOT NULL CHECK (
    jsonb_typeof(coverage_warnings) = 'array'
    AND jsonb_array_length(coverage_warnings) BETWEEN 1 AND 20
  ),
  items jsonb NOT NULL CHECK (
    jsonb_typeof(items) = 'array' AND jsonb_array_length(items) BETWEEN 1 AND 200
  ),
  generated_by uuid NOT NULL REFERENCES identity_users(id),
  PRIMARY KEY (tenant_id, project_id, property_id, version),
  FOREIGN KEY (tenant_id, project_id, property_id)
    REFERENCES property_identities(tenant_id, project_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS property_dossier_version_sources (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  property_id uuid NOT NULL,
  dossier_version integer NOT NULL,
  source_record_id uuid NOT NULL,
  PRIMARY KEY (
    tenant_id,
    project_id,
    property_id,
    dossier_version,
    source_record_id
  ),
  FOREIGN KEY (tenant_id, project_id, property_id, dossier_version)
    REFERENCES property_dossier_versions(tenant_id, project_id, property_id, version)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, property_id, source_record_id)
    REFERENCES property_source_records(tenant_id, project_id, property_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS property_dossier_version_sources_source_idx
  ON property_dossier_version_sources (
    tenant_id,
    project_id,
    property_id,
    source_record_id
  );

CREATE TABLE IF NOT EXISTS property_mutation_idempotency (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  actor_user_id uuid NOT NULL REFERENCES identity_users(id),
  operation text NOT NULL CHECK (char_length(operation) BETWEEN 1 AND 100),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  response_status integer CHECK (response_status IS NULL OR response_status BETWEEN 200 AND 599),
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  PRIMARY KEY (tenant_id, project_id, idempotency_key),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT property_mutation_idempotency_completion CHECK (
    (response_status IS NULL AND response_body IS NULL AND completed_at IS NULL)
    OR (response_status IS NOT NULL AND response_body IS NOT NULL AND completed_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS property_audit_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  property_id uuid,
  actor_user_id uuid NOT NULL REFERENCES identity_users(id),
  action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 100),
  resource_type text NOT NULL CHECK (
    resource_type IN ('property-resolution', 'project-property', 'property-dossier')
  ),
  resource_id uuid NOT NULL,
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  trace_id text NOT NULL CHECK (trace_id ~ '^[0-9a-f]{32}$'),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, property_id)
    REFERENCES property_identities(tenant_id, project_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS property_audit_events_project_time_idx
  ON property_audit_events (tenant_id, project_id, occurred_at, id);

CREATE INDEX IF NOT EXISTS property_audit_events_property_idx
  ON property_audit_events (tenant_id, project_id, property_id)
  WHERE property_id IS NOT NULL;

CREATE OR REPLACE FUNCTION c3_reject_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS property_resolution_snapshots_append_only
  ON property_resolution_snapshots;
CREATE TRIGGER property_resolution_snapshots_append_only
BEFORE UPDATE OR DELETE ON property_resolution_snapshots
FOR EACH ROW EXECUTE FUNCTION c3_reject_append_only_mutation();

DROP TRIGGER IF EXISTS property_resolution_candidates_append_only
  ON property_resolution_candidates;
CREATE TRIGGER property_resolution_candidates_append_only
BEFORE UPDATE OR DELETE ON property_resolution_candidates
FOR EACH ROW EXECUTE FUNCTION c3_reject_append_only_mutation();

DROP TRIGGER IF EXISTS property_identities_append_only ON property_identities;
CREATE TRIGGER property_identities_append_only
BEFORE UPDATE OR DELETE ON property_identities
FOR EACH ROW EXECUTE FUNCTION c3_reject_append_only_mutation();

DROP TRIGGER IF EXISTS property_resolution_consumptions_append_only
  ON property_resolution_consumptions;
CREATE TRIGGER property_resolution_consumptions_append_only
BEFORE UPDATE OR DELETE ON property_resolution_consumptions
FOR EACH ROW EXECUTE FUNCTION c3_reject_append_only_mutation();

DROP TRIGGER IF EXISTS property_source_records_append_only ON property_source_records;
CREATE TRIGGER property_source_records_append_only
BEFORE UPDATE OR DELETE ON property_source_records
FOR EACH ROW EXECUTE FUNCTION c3_reject_append_only_mutation();

DROP TRIGGER IF EXISTS property_dossier_versions_append_only ON property_dossier_versions;
CREATE TRIGGER property_dossier_versions_append_only
BEFORE UPDATE OR DELETE ON property_dossier_versions
FOR EACH ROW EXECUTE FUNCTION c3_reject_append_only_mutation();

DROP TRIGGER IF EXISTS property_dossier_version_sources_append_only
  ON property_dossier_version_sources;
CREATE TRIGGER property_dossier_version_sources_append_only
BEFORE UPDATE OR DELETE ON property_dossier_version_sources
FOR EACH ROW EXECUTE FUNCTION c3_reject_append_only_mutation();

DROP TRIGGER IF EXISTS property_audit_events_append_only ON property_audit_events;
CREATE TRIGGER property_audit_events_append_only
BEFORE UPDATE OR DELETE ON property_audit_events
FOR EACH ROW EXECUTE FUNCTION c3_reject_append_only_mutation();

CREATE OR REPLACE FUNCTION c3_validate_project_property_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'project property selection cannot be deleted';
  END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR NEW.version <> OLD.version + 1
  THEN
    RAISE EXCEPTION 'invalid project property revision';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_properties_validate_mutation ON project_properties;
CREATE TRIGGER project_properties_validate_mutation
BEFORE UPDATE OR DELETE ON project_properties
FOR EACH ROW EXECUTE FUNCTION c3_validate_project_property_mutation();

CREATE OR REPLACE FUNCTION c3_validate_idempotency_completion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'property idempotency records cannot be deleted';
  END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key
    OR OLD.actor_user_id IS DISTINCT FROM NEW.actor_user_id
    OR OLD.operation IS DISTINCT FROM NEW.operation
    OR OLD.request_hash IS DISTINCT FROM NEW.request_hash
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR OLD.completed_at IS NOT NULL
    OR OLD.response_status IS NOT NULL
    OR OLD.response_body IS NOT NULL
    OR NEW.completed_at IS NULL
    OR NEW.response_status IS NULL
    OR NEW.response_body IS NULL
  THEN
    RAISE EXCEPTION 'invalid property idempotency completion';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS property_mutation_idempotency_validate
  ON property_mutation_idempotency;
CREATE TRIGGER property_mutation_idempotency_validate
BEFORE UPDATE OR DELETE ON property_mutation_idempotency
FOR EACH ROW EXECUTE FUNCTION c3_validate_idempotency_completion();

INSERT INTO platform_schema_migrations (id)
VALUES ('0003_property_dossier')
ON CONFLICT (id) DO NOTHING;
