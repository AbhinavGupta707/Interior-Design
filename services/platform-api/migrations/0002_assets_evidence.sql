DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM platform_schema_migrations
    WHERE id = '0001_identity_projects_intake'
  ) THEN
    RAISE EXCEPTION 'C2 requires migration 0001_identity_projects_intake';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS assets (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('plan', 'photograph', 'video', 'document')),
  file_name text NOT NULL CHECK (
    char_length(file_name) BETWEEN 1 AND 255
    AND file_name !~ '[\\/[:cntrl:]]'
  ),
  declared_mime_type text NOT NULL CHECK (
    declared_mime_type IN (
      'image/jpeg',
      'image/png',
      'image/heic',
      'image/heif',
      'application/pdf',
      'image/svg+xml',
      'video/mp4',
      'video/quicktime'
    )
  ),
  detected_mime_type text CHECK (
    detected_mime_type IS NULL
    OR char_length(detected_mime_type) BETWEEN 1 AND 200
  ),
  source_byte_size bigint NOT NULL CHECK (source_byte_size BETWEEN 1 AND 2147483648),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_bucket text NOT NULL DEFAULT 'source' CHECK (source_bucket = 'source'),
  source_object_key text NOT NULL UNIQUE CHECK (
    source_object_key ~ '^sources/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  status text NOT NULL DEFAULT 'pending-upload' CHECK (
    status IN (
      'pending-upload',
      'uploading',
      'uploaded',
      'processing',
      'ready',
      'quarantined',
      'rejected',
      'aborted'
    )
  ),
  rejection_code text CHECK (
    rejection_code IS NULL
    OR rejection_code IN (
      'unsupported-type',
      'signature-mismatch',
      'resource-limit',
      'malformed-media',
      'checksum-mismatch',
      'malware-suspected',
      'processing-failed'
    )
  ),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT assets_rejection_consistency CHECK (
    (status IN ('quarantined', 'rejected') AND rejection_code IS NOT NULL)
    OR (status NOT IN ('quarantined', 'rejected') AND rejection_code IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS assets_project_created_idx
  ON assets (tenant_id, project_id, created_at, id);

CREATE TABLE IF NOT EXISTS asset_rights_assertions (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  basis text NOT NULL CHECK (
    basis IN ('owned-by-user', 'permission-granted', 'public-domain', 'licensed')
  ),
  attribution text CHECK (attribution IS NULL OR char_length(attribution) BETWEEN 1 AND 500),
  licence_url text CHECK (
    licence_url IS NULL
    OR (char_length(licence_url) <= 2048 AND licence_url ~ '^https://')
  ),
  service_processing_consent boolean NOT NULL CHECK (service_processing_consent),
  training_use_consent text NOT NULL DEFAULT 'denied' CHECK (
    training_use_consent IN ('denied', 'granted')
  ),
  asserted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, project_id, asset_id),
  FOREIGN KEY (tenant_id, project_id, asset_id)
    REFERENCES assets(tenant_id, project_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS asset_upload_sessions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  provider_upload_id text NOT NULL CHECK (
    char_length(provider_upload_id) BETWEEN 1 AND 2048
    AND provider_upload_id !~ '[[:cntrl:]]'
  ),
  state text NOT NULL DEFAULT 'initiated' CHECK (
    state IN ('initiated', 'uploading', 'completed', 'aborted', 'expired')
  ),
  part_size integer NOT NULL CHECK (part_size BETWEEN 5242880 AND 134217728),
  minimum_non_final_part_size integer NOT NULL DEFAULT 5242880 CHECK (
    minimum_non_final_part_size = 5242880
  ),
  maximum_part_count integer NOT NULL DEFAULT 10000 CHECK (maximum_part_count = 10000),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  aborted_at timestamptz,
  expired_at timestamptz,
  UNIQUE (tenant_id, project_id, asset_id, id),
  FOREIGN KEY (tenant_id, project_id, asset_id)
    REFERENCES assets(tenant_id, project_id, id) ON DELETE RESTRICT,
  CONSTRAINT asset_upload_sessions_terminal_time CHECK (
    (state = 'completed' AND completed_at IS NOT NULL AND aborted_at IS NULL AND expired_at IS NULL)
    OR (state = 'aborted' AND completed_at IS NULL AND aborted_at IS NOT NULL AND expired_at IS NULL)
    OR (state = 'expired' AND completed_at IS NULL AND aborted_at IS NULL AND expired_at IS NOT NULL)
    OR (state IN ('initiated', 'uploading')
      AND completed_at IS NULL AND aborted_at IS NULL AND expired_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS asset_upload_sessions_cleanup_idx
  ON asset_upload_sessions (expires_at, id)
  WHERE state IN ('initiated', 'uploading');

CREATE TABLE IF NOT EXISTS asset_upload_parts (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  session_id uuid NOT NULL,
  part_number integer NOT NULL CHECK (part_number BETWEEN 1 AND 10000),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 134217728),
  checksum_sha256 text NOT NULL CHECK (
    checksum_sha256 ~ '^[A-Za-z0-9+/]{43}=$'
  ),
  provider_etag text CHECK (
    provider_etag IS NULL
    OR (
      char_length(provider_etag) BETWEEN 1 AND 512
      AND provider_etag !~ '[[:cntrl:]]'
    )
  ),
  signed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  PRIMARY KEY (tenant_id, project_id, session_id, part_number),
  FOREIGN KEY (tenant_id, project_id, asset_id, session_id)
    REFERENCES asset_upload_sessions(tenant_id, project_id, asset_id, id) ON DELETE RESTRICT,
  CONSTRAINT asset_upload_parts_completion_consistency CHECK (
    (provider_etag IS NULL AND completed_at IS NULL)
    OR (provider_etag IS NOT NULL AND completed_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS asset_processing_jobs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'leased', 'retryable', 'succeeded', 'failed')
  ),
  command jsonb NOT NULL CHECK (jsonb_typeof(command) = 'object'),
  result jsonb CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 10),
  maximum_attempts integer NOT NULL DEFAULT 10 CHECK (maximum_attempts = 10),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_owner text CHECK (lease_owner IS NULL OR char_length(lease_owner) BETWEEN 1 AND 120),
  lease_expires_at timestamptz,
  last_error_code text CHECK (
    last_error_code IS NULL OR last_error_code ~ '^[a-z0-9][a-z0-9-]{0,79}$'
  ),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  UNIQUE (tenant_id, project_id, asset_id),
  FOREIGN KEY (tenant_id, project_id, asset_id)
    REFERENCES assets(tenant_id, project_id, id) ON DELETE RESTRICT,
  CONSTRAINT asset_processing_jobs_lease_consistency CHECK (
    (status = 'leased' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'leased' AND lease_owner IS NULL AND lease_expires_at IS NULL)
  ),
  CONSTRAINT asset_processing_jobs_result_consistency CHECK (
    (status = 'succeeded' AND result IS NOT NULL AND completed_at IS NOT NULL)
    OR (status = 'failed' AND result IS NULL AND completed_at IS NOT NULL)
    OR (status IN ('queued', 'leased', 'retryable') AND result IS NULL AND completed_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS asset_processing_jobs_claim_idx
  ON asset_processing_jobs (available_at, created_at, id)
  WHERE status IN ('queued', 'retryable', 'leased');

CREATE TABLE IF NOT EXISTS derived_asset_artifacts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  bucket text NOT NULL CHECK (bucket IN ('derived', 'quarantine')),
  object_key text NOT NULL UNIQUE CHECK (
    char_length(object_key) BETWEEN 1 AND 1024
    AND object_key ~ '^[A-Za-z0-9][A-Za-z0-9/_.=+-]*$'
    AND object_key !~ '(^|/)\.\.?(/|$)'
  ),
  kind text NOT NULL CHECK (kind IN ('preview', 'thumbnail', 'metadata-manifest')),
  mime_type text NOT NULL CHECK (char_length(mime_type) BETWEEN 1 AND 200),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 268435456),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, project_id, asset_id, kind, sha256),
  FOREIGN KEY (tenant_id, project_id, asset_id)
    REFERENCES assets(tenant_id, project_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS derived_asset_artifacts_asset_idx
  ON derived_asset_artifacts (tenant_id, project_id, asset_id, kind, created_at, id);

CREATE TABLE IF NOT EXISTS asset_audit_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  actor_kind text NOT NULL CHECK (actor_kind IN ('user', 'worker', 'system')),
  actor_user_id uuid REFERENCES identity_users(id),
  actor_identifier text CHECK (
    actor_identifier IS NULL OR char_length(actor_identifier) BETWEEN 1 AND 120
  ),
  action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 100),
  resource_type text NOT NULL CHECK (resource_type IN ('asset', 'upload-session', 'processing-job')),
  resource_id uuid NOT NULL,
  request_id text CHECK (request_id IS NULL OR char_length(request_id) BETWEEN 1 AND 128),
  trace_id text CHECK (trace_id IS NULL OR trace_id ~ '^[0-9a-f]{32}$'),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (tenant_id, project_id, asset_id)
    REFERENCES assets(tenant_id, project_id, id) ON DELETE RESTRICT,
  CONSTRAINT asset_audit_events_actor_consistency CHECK (
    (actor_kind = 'user' AND actor_user_id IS NOT NULL AND actor_identifier IS NULL
      AND request_id IS NOT NULL AND trace_id IS NOT NULL)
    OR (actor_kind IN ('worker', 'system') AND actor_user_id IS NULL
      AND actor_identifier IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS asset_audit_events_project_time_idx
  ON asset_audit_events (tenant_id, project_id, occurred_at, id);

CREATE OR REPLACE FUNCTION c2_reject_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS asset_rights_assertions_append_only ON asset_rights_assertions;
CREATE TRIGGER asset_rights_assertions_append_only
BEFORE UPDATE OR DELETE ON asset_rights_assertions
FOR EACH ROW EXECUTE FUNCTION c2_reject_append_only_mutation();

DROP TRIGGER IF EXISTS derived_asset_artifacts_append_only ON derived_asset_artifacts;
CREATE TRIGGER derived_asset_artifacts_append_only
BEFORE UPDATE OR DELETE ON derived_asset_artifacts
FOR EACH ROW EXECUTE FUNCTION c2_reject_append_only_mutation();

DROP TRIGGER IF EXISTS asset_audit_events_append_only ON asset_audit_events;
CREATE TRIGGER asset_audit_events_append_only
BEFORE UPDATE OR DELETE ON asset_audit_events
FOR EACH ROW EXECUTE FUNCTION c2_reject_append_only_mutation();

CREATE OR REPLACE FUNCTION c2_validate_asset_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.id IS DISTINCT FROM NEW.id
    OR OLD.kind IS DISTINCT FROM NEW.kind
    OR OLD.file_name IS DISTINCT FROM NEW.file_name
    OR OLD.declared_mime_type IS DISTINCT FROM NEW.declared_mime_type
    OR OLD.source_byte_size IS DISTINCT FROM NEW.source_byte_size
    OR OLD.source_sha256 IS DISTINCT FROM NEW.source_sha256
    OR OLD.source_bucket IS DISTINCT FROM NEW.source_bucket
    OR OLD.source_object_key IS DISTINCT FROM NEW.source_object_key
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
  THEN
    RAISE EXCEPTION 'asset source identity is immutable';
  END IF;

  IF OLD.status IN ('ready', 'quarantined', 'rejected', 'aborted') THEN
    RAISE EXCEPTION 'terminal asset is immutable';
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status AND NOT (
    (OLD.status = 'pending-upload' AND NEW.status IN ('uploading', 'aborted'))
    OR (OLD.status = 'uploading' AND NEW.status IN ('uploaded', 'aborted'))
    OR (OLD.status = 'uploaded' AND NEW.status = 'processing')
    OR (OLD.status = 'processing' AND NEW.status IN ('ready', 'quarantined', 'rejected'))
  ) THEN
    RAISE EXCEPTION 'illegal asset status transition from % to %', OLD.status, NEW.status;
  END IF;

  IF OLD.detected_mime_type IS NOT NULL
    AND OLD.detected_mime_type IS DISTINCT FROM NEW.detected_mime_type
  THEN
    RAISE EXCEPTION 'detected MIME type is immutable once recorded';
  END IF;

  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assets_validate_mutation ON assets;
CREATE TRIGGER assets_validate_mutation
BEFORE UPDATE ON assets
FOR EACH ROW EXECUTE FUNCTION c2_validate_asset_mutation();

CREATE OR REPLACE FUNCTION c2_validate_upload_session_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.asset_id IS DISTINCT FROM NEW.asset_id
    OR OLD.id IS DISTINCT FROM NEW.id
    OR OLD.provider_upload_id IS DISTINCT FROM NEW.provider_upload_id
    OR OLD.part_size IS DISTINCT FROM NEW.part_size
    OR OLD.minimum_non_final_part_size IS DISTINCT FROM NEW.minimum_non_final_part_size
    OR OLD.maximum_part_count IS DISTINCT FROM NEW.maximum_part_count
    OR OLD.expires_at IS DISTINCT FROM NEW.expires_at
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
  THEN
    RAISE EXCEPTION 'upload session identity is immutable';
  END IF;

  IF OLD.state IN ('completed', 'aborted', 'expired') THEN
    RAISE EXCEPTION 'terminal upload session is immutable';
  END IF;

  IF OLD.state IS DISTINCT FROM NEW.state AND NOT (
    (OLD.state = 'initiated' AND NEW.state IN ('uploading', 'completed', 'aborted', 'expired'))
    OR (OLD.state = 'uploading' AND NEW.state IN ('completed', 'aborted', 'expired'))
  ) THEN
    RAISE EXCEPTION 'illegal upload session transition from % to %', OLD.state, NEW.state;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS asset_upload_sessions_validate_mutation ON asset_upload_sessions;
CREATE TRIGGER asset_upload_sessions_validate_mutation
BEFORE UPDATE ON asset_upload_sessions
FOR EACH ROW EXECUTE FUNCTION c2_validate_upload_session_mutation();

CREATE OR REPLACE FUNCTION c2_validate_upload_part_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'upload parts cannot be deleted';
  END IF;

  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.asset_id IS DISTINCT FROM NEW.asset_id
    OR OLD.session_id IS DISTINCT FROM NEW.session_id
    OR OLD.part_number IS DISTINCT FROM NEW.part_number
    OR OLD.byte_size IS DISTINCT FROM NEW.byte_size
    OR OLD.checksum_sha256 IS DISTINCT FROM NEW.checksum_sha256
    OR OLD.signed_at IS DISTINCT FROM NEW.signed_at
  THEN
    RAISE EXCEPTION 'upload part declaration is immutable';
  END IF;

  IF OLD.provider_etag IS NOT NULL
    OR OLD.completed_at IS NOT NULL
    OR NEW.provider_etag IS NULL
    OR NEW.completed_at IS NULL
  THEN
    RAISE EXCEPTION 'upload part may only be completed once';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS asset_upload_parts_validate_mutation ON asset_upload_parts;
CREATE TRIGGER asset_upload_parts_validate_mutation
BEFORE UPDATE OR DELETE ON asset_upload_parts
FOR EACH ROW EXECUTE FUNCTION c2_validate_upload_part_mutation();

INSERT INTO platform_schema_migrations (id)
VALUES ('0002_assets_evidence')
ON CONFLICT (id) DO NOTHING;
