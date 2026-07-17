DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform_schema_migrations WHERE id = '0002_assets_evidence') THEN
    RAISE EXCEPTION 'C7 requires migration 0002_assets_evidence';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform_schema_migrations WHERE id = '0004_canonical_models') THEN
    RAISE EXCEPTION 'C7 requires migration 0004_canonical_models';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform_schema_migrations WHERE id = '0006_plan_processing') THEN
    RAISE EXCEPTION 'C7 requires migration 0006_plan_processing';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS capture_sessions (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  mode text NOT NULL CHECK (mode IN ('single-room', 'structure')),
  state text NOT NULL CHECK (state IN (
    'created', 'uploading', 'uploaded', 'processing', 'proposed', 'abstained',
    'cancel-requested', 'cancelled', 'failed'
  )),
  package_id uuid,
  result_id uuid,
  proposal_id uuid,
  retryable boolean NOT NULL DEFAULT false,
  safe_code text CHECK (safe_code IS NULL OR safe_code ~ '^[A-Z][A-Z0-9_]{2,79}$'),
  created_by uuid NOT NULL REFERENCES identity_users(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  PRIMARY KEY (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT capture_sessions_result_state CHECK (
    ((state IN ('proposed', 'abstained')) = (result_id IS NOT NULL))
    AND ((state = 'proposed') = (proposal_id IS NOT NULL))
  ),
  CONSTRAINT capture_sessions_safe_state CHECK (
    ((state IN ('abstained', 'failed')) = (safe_code IS NOT NULL))
  ),
  CONSTRAINT capture_sessions_retryable_state CHECK (NOT retryable OR state = 'failed')
);

CREATE INDEX IF NOT EXISTS capture_sessions_project_list_idx
  ON capture_sessions (tenant_id, project_id, created_at, id);

CREATE TABLE IF NOT EXISTS capture_briefs (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  capture_session_id uuid NOT NULL,
  schema_version text NOT NULL CHECK (schema_version = 'c7-capture-session-v1'),
  expires_at timestamptz NOT NULL,
  instructions_version text NOT NULL CHECK (char_length(instructions_version) BETWEEN 1 AND 100),
  brief_payload jsonb NOT NULL CHECK (
    jsonb_typeof(brief_payload) = 'object'
    AND brief_payload ->> 'schemaVersion' = 'c7-capture-session-v1'
    AND brief_payload ->> 'captureSessionId' = capture_session_id::text
    AND brief_payload ->> 'projectId' = project_id::text
  ),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, capture_session_id),
  FOREIGN KEY (tenant_id, project_id, capture_session_id)
    REFERENCES capture_sessions(tenant_id, project_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS capture_briefs_expiry_idx
  ON capture_briefs (expires_at, capture_session_id);

CREATE TABLE IF NOT EXISTS capture_rights_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  capture_session_id uuid NOT NULL,
  permitted boolean NOT NULL,
  basis text NOT NULL CHECK (
    basis IN ('owned-by-user', 'permission-granted', 'public-domain', 'licensed')
  ),
  service_processing_consent boolean NOT NULL,
  training_use_consent text NOT NULL CHECK (training_use_consent = 'denied'),
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,79}$'),
  actor_user_id uuid REFERENCES identity_users(id),
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, project_id, capture_session_id)
    REFERENCES capture_sessions(tenant_id, project_id, id) ON DELETE RESTRICT,
  CONSTRAINT capture_rights_events_permission_consistency CHECK (
    (permitted AND service_processing_consent AND actor_user_id IS NOT NULL)
    OR (NOT permitted AND NOT service_processing_consent)
  )
);

CREATE INDEX IF NOT EXISTS capture_rights_events_current_idx
  ON capture_rights_events (tenant_id, project_id, capture_session_id, occurred_at DESC, id DESC);

CREATE UNIQUE INDEX IF NOT EXISTS capture_rights_events_one_withdrawal_idx
  ON capture_rights_events (tenant_id, project_id, capture_session_id)
  WHERE NOT permitted;

CREATE TABLE IF NOT EXISTS capture_artifacts (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  capture_session_id uuid NOT NULL,
  id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN (
    'captured-room-json', 'captured-room-data-json', 'captured-structure-json',
    'roomplan-normalized-json', 'quality-manifest-json', 'structure-usdz'
  )),
  content_type text NOT NULL CHECK (content_type IN ('application/json', 'model/vnd.usdz+zip')),
  room_id uuid,
  source_byte_size bigint NOT NULL CHECK (source_byte_size BETWEEN 1 AND 536870912),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_bucket text NOT NULL DEFAULT 'source' CHECK (source_bucket = 'source'),
  source_object_key text NOT NULL UNIQUE CHECK (
    source_object_key ~ '^capture-sources/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'uploaded', 'aborted')),
  created_at timestamptz NOT NULL,
  uploaded_at timestamptz,
  PRIMARY KEY (tenant_id, project_id, capture_session_id, id),
  UNIQUE (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id, capture_session_id)
    REFERENCES capture_sessions(tenant_id, project_id, id) ON DELETE RESTRICT,
  CONSTRAINT capture_artifacts_scope CHECK (
    ((kind IN ('captured-room-json', 'captured-room-data-json')) = (room_id IS NOT NULL))
  ),
  CONSTRAINT capture_artifacts_media CHECK (
    (kind = 'structure-usdz' AND content_type = 'model/vnd.usdz+zip')
    OR (kind <> 'structure-usdz' AND content_type = 'application/json')
  ),
  CONSTRAINT capture_artifacts_upload_time CHECK (
    (state = 'uploaded' AND uploaded_at IS NOT NULL)
    OR (state <> 'uploaded' AND uploaded_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS capture_artifacts_session_idx
  ON capture_artifacts (tenant_id, project_id, capture_session_id, created_at, id);

CREATE TABLE IF NOT EXISTS capture_artifact_upload_sessions (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  capture_session_id uuid NOT NULL,
  artifact_id uuid NOT NULL,
  id uuid NOT NULL,
  provider_upload_id text NOT NULL CHECK (
    char_length(provider_upload_id) BETWEEN 1 AND 2048
    AND provider_upload_id !~ '[[:cntrl:]]'
  ),
  state text NOT NULL CHECK (state IN ('initiated', 'uploading', 'completed', 'aborted', 'expired')),
  part_size integer NOT NULL CHECK (part_size = 8388608),
  minimum_non_final_part_size integer NOT NULL CHECK (minimum_non_final_part_size = 5242880),
  maximum_part_count integer NOT NULL CHECK (maximum_part_count = 10000),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  aborted_at timestamptz,
  expired_at timestamptz,
  PRIMARY KEY (tenant_id, project_id, capture_session_id, id),
  UNIQUE (tenant_id, project_id, capture_session_id, artifact_id),
  UNIQUE (tenant_id, project_id, capture_session_id, artifact_id, id),
  UNIQUE (tenant_id, project_id, artifact_id, id),
  FOREIGN KEY (tenant_id, project_id, capture_session_id, artifact_id)
    REFERENCES capture_artifacts(tenant_id, project_id, capture_session_id, id) ON DELETE RESTRICT,
  CONSTRAINT capture_upload_sessions_terminal_time CHECK (
    (state = 'completed' AND completed_at IS NOT NULL AND aborted_at IS NULL AND expired_at IS NULL)
    OR (state = 'aborted' AND completed_at IS NULL AND aborted_at IS NOT NULL AND expired_at IS NULL)
    OR (state = 'expired' AND completed_at IS NULL AND aborted_at IS NULL AND expired_at IS NOT NULL)
    OR (state IN ('initiated', 'uploading')
      AND completed_at IS NULL AND aborted_at IS NULL AND expired_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS capture_upload_sessions_cleanup_idx
  ON capture_artifact_upload_sessions (expires_at, id)
  WHERE state IN ('initiated', 'uploading');

CREATE TABLE IF NOT EXISTS capture_artifact_upload_parts (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  capture_session_id uuid NOT NULL,
  artifact_id uuid NOT NULL,
  upload_session_id uuid NOT NULL,
  part_number integer NOT NULL CHECK (part_number BETWEEN 1 AND 10000),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 134217728),
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[A-Za-z0-9+/]{43}=$'),
  provider_etag text CHECK (
    provider_etag IS NULL OR (
      char_length(provider_etag) BETWEEN 1 AND 512
      AND provider_etag !~ '[[:cntrl:]]'
    )
  ),
  signed_at timestamptz NOT NULL,
  completed_at timestamptz,
  PRIMARY KEY (tenant_id, project_id, capture_session_id, upload_session_id, part_number),
  FOREIGN KEY (tenant_id, project_id, capture_session_id, artifact_id, upload_session_id)
    REFERENCES capture_artifact_upload_sessions(
      tenant_id,
      project_id,
      capture_session_id,
      artifact_id,
      id
    )
    ON DELETE RESTRICT,
  CONSTRAINT capture_upload_parts_completion CHECK (
    (provider_etag IS NULL AND completed_at IS NULL)
    OR (provider_etag IS NOT NULL AND completed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS capture_upload_parts_artifact_idx
  ON capture_artifact_upload_parts (tenant_id, project_id, capture_session_id, artifact_id);

CREATE TABLE IF NOT EXISTS capture_packages (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  capture_session_id uuid NOT NULL,
  id uuid NOT NULL,
  schema_version text NOT NULL CHECK (schema_version = 'c7-capture-package-v1'),
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_payload jsonb NOT NULL CHECK (
    jsonb_typeof(manifest_payload) = 'object'
    AND manifest_payload ->> 'schemaVersion' = 'c7-capture-package-v1'
    AND manifest_payload ->> 'captureSessionId' = capture_session_id::text
    AND manifest_payload ->> 'projectId' = project_id::text
  ),
  total_source_bytes bigint NOT NULL CHECK (total_source_bytes BETWEEN 1 AND 2147483648),
  artifact_count integer NOT NULL CHECK (artifact_count BETWEEN 3 AND 256),
  created_by uuid NOT NULL REFERENCES identity_users(id),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, capture_session_id, id),
  UNIQUE (tenant_id, project_id, capture_session_id),
  UNIQUE (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id, capture_session_id)
    REFERENCES capture_sessions(tenant_id, project_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS capture_processing_attempts (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  capture_session_id uuid NOT NULL,
  package_id uuid NOT NULL,
  id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number BETWEEN 1 AND 3),
  state text NOT NULL CHECK (state IN (
    'queued', 'leased', 'cancel-requested', 'cancelled', 'succeeded', 'failed'
  )),
  available_at timestamptz NOT NULL,
  lease_owner text CHECK (
    lease_owner IS NULL OR (
      char_length(lease_owner) BETWEEN 3 AND 100
      AND lease_owner ~ '^[A-Za-z0-9_.:-]+$'
    )
  ),
  lease_token uuid,
  lease_expires_at timestamptz,
  retryable boolean NOT NULL DEFAULT false,
  safe_code text CHECK (safe_code IS NULL OR safe_code ~ '^[A-Z][A-Z0-9_]{2,79}$'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  PRIMARY KEY (tenant_id, project_id, capture_session_id, id),
  UNIQUE (tenant_id, project_id, capture_session_id, attempt_number),
  UNIQUE (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id, capture_session_id, package_id)
    REFERENCES capture_packages(tenant_id, project_id, capture_session_id, id) ON DELETE RESTRICT,
  CONSTRAINT capture_attempts_lease_state CHECK (
    ((state IN ('leased', 'cancel-requested')) =
      (lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL))
  ),
  CONSTRAINT capture_attempts_terminal_state CHECK (
    (state = 'failed' AND safe_code IS NOT NULL)
    OR (state <> 'failed' AND safe_code IS NULL AND NOT retryable)
  )
);

CREATE INDEX IF NOT EXISTS capture_attempts_queue_idx
  ON capture_processing_attempts (available_at, created_at, id)
  WHERE state IN ('queued', 'leased', 'cancel-requested');

CREATE TABLE IF NOT EXISTS capture_results (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  capture_session_id uuid NOT NULL,
  package_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('proposal', 'abstained')),
  normalized_input_sha256 text NOT NULL CHECK (normalized_input_sha256 ~ '^[0-9a-f]{64}$'),
  package_manifest_sha256 text NOT NULL CHECK (package_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  converter_manifest_sha256 text NOT NULL CHECK (converter_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  result_sha256 text NOT NULL CHECK (result_sha256 ~ '^[0-9a-f]{64}$'),
  result_payload jsonb NOT NULL CHECK (
    jsonb_typeof(result_payload) = 'object'
    AND result_payload ->> 'schemaVersion' = 'c7-capture-proposal-v1'
    AND result_payload ->> 'captureSessionId' = capture_session_id::text
    AND result_payload ->> 'packageId' = package_id::text
    AND result_payload ->> 'projectId' = project_id::text
    AND result_payload ->> 'proposalId' = id::text
    AND result_payload ->> 'status' = status
  ),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, capture_session_id, id),
  UNIQUE (tenant_id, project_id, capture_session_id),
  UNIQUE (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id, capture_session_id, package_id)
    REFERENCES capture_packages(tenant_id, project_id, capture_session_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, capture_session_id, attempt_id)
    REFERENCES capture_processing_attempts(tenant_id, project_id, capture_session_id, id)
    ON DELETE RESTRICT
);

ALTER TABLE capture_sessions DROP CONSTRAINT IF EXISTS capture_sessions_package_fk;
ALTER TABLE capture_sessions ADD CONSTRAINT capture_sessions_package_fk
  FOREIGN KEY (tenant_id, project_id, id, package_id)
  REFERENCES capture_packages(tenant_id, project_id, capture_session_id, id)
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE capture_sessions DROP CONSTRAINT IF EXISTS capture_sessions_result_fk;
ALTER TABLE capture_sessions ADD CONSTRAINT capture_sessions_result_fk
  FOREIGN KEY (tenant_id, project_id, id, result_id)
  REFERENCES capture_results(tenant_id, project_id, capture_session_id, id)
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS capture_audit_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  capture_session_id uuid NOT NULL,
  action text NOT NULL CHECK (action ~ '^capture[.][a-z0-9.-]{2,79}$'),
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
      'providerUploadId', 'sourceObjectKey', 'objectKey', 'signedUrl', 'url',
      'rawSource', 'rawJson', 'worldMap', 'token', 'credential'
    ]
  ),
  occurred_at timestamptz NOT NULL,
  CHECK ((actor_user_id IS NOT NULL)::integer + (worker_id IS NOT NULL)::integer = 1),
  FOREIGN KEY (tenant_id, project_id, capture_session_id)
    REFERENCES capture_sessions(tenant_id, project_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS capture_audit_session_idx
  ON capture_audit_events (tenant_id, project_id, capture_session_id, occurred_at, id);

CREATE TABLE IF NOT EXISTS capture_outbox (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  capture_session_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type ~ '^capture[.][a-z0-9.-]{2,79}$'),
  schema_version text NOT NULL CHECK (schema_version = 'c7-capture-session-v1'),
  payload jsonb NOT NULL CHECK (
    jsonb_typeof(payload) = 'object'
    AND NOT payload ?| ARRAY[
      'providerUploadId', 'sourceObjectKey', 'objectKey', 'signedUrl', 'url',
      'rawSource', 'rawJson', 'worldMap', 'token', 'credential'
    ]
  ),
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, project_id, capture_session_id)
    REFERENCES capture_sessions(tenant_id, project_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS capture_outbox_poll_idx ON capture_outbox (occurred_at, id);

CREATE OR REPLACE FUNCTION c7_reject_append_only_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE OR REPLACE FUNCTION c7_validate_session_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'capture sessions cannot be deleted'; END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.id IS DISTINCT FROM NEW.id
    OR OLD.mode IS DISTINCT FROM NEW.mode
    OR OLD.created_by IS DISTINCT FROM NEW.created_by
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR NEW.version <> OLD.version + 1
    OR NEW.updated_at <= OLD.updated_at
  THEN RAISE EXCEPTION 'capture session identity is immutable'; END IF;
  IF OLD.state IN ('proposed', 'abstained', 'cancelled') THEN
    RAISE EXCEPTION 'terminal capture sessions are immutable';
  END IF;
  IF NOT (
    (OLD.state = 'created' AND NEW.state IN ('uploading', 'cancelled', 'failed'))
    OR (OLD.state = 'uploading' AND NEW.state IN ('uploaded', 'cancelled', 'failed'))
    OR (OLD.state = 'uploaded' AND NEW.state IN ('processing', 'cancelled', 'failed'))
    OR (OLD.state = 'processing' AND NEW.state IN (
      'proposed', 'abstained', 'cancel-requested', 'failed'
    ))
    OR (OLD.state = 'cancel-requested' AND NEW.state = 'cancelled')
    OR (OLD.state = 'failed' AND NEW.state IN ('uploaded', 'cancelled'))
  ) THEN RAISE EXCEPTION 'illegal capture session transition from % to %', OLD.state, NEW.state; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION c7_validate_artifact_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'capture artifacts cannot be deleted'; END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.capture_session_id IS DISTINCT FROM NEW.capture_session_id
    OR OLD.id IS DISTINCT FROM NEW.id
    OR OLD.kind IS DISTINCT FROM NEW.kind
    OR OLD.content_type IS DISTINCT FROM NEW.content_type
    OR OLD.room_id IS DISTINCT FROM NEW.room_id
    OR OLD.source_byte_size IS DISTINCT FROM NEW.source_byte_size
    OR OLD.source_sha256 IS DISTINCT FROM NEW.source_sha256
    OR OLD.source_bucket IS DISTINCT FROM NEW.source_bucket
    OR OLD.source_object_key IS DISTINCT FROM NEW.source_object_key
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
  THEN RAISE EXCEPTION 'capture artifact source identity is immutable'; END IF;
  IF OLD.state <> 'pending' OR NEW.state NOT IN ('uploaded', 'aborted') THEN
    RAISE EXCEPTION 'illegal capture artifact transition from % to %', OLD.state, NEW.state;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION c7_validate_upload_session_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'capture upload sessions cannot be deleted'; END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.capture_session_id IS DISTINCT FROM NEW.capture_session_id
    OR OLD.artifact_id IS DISTINCT FROM NEW.artifact_id
    OR OLD.id IS DISTINCT FROM NEW.id
    OR OLD.provider_upload_id IS DISTINCT FROM NEW.provider_upload_id
    OR OLD.part_size IS DISTINCT FROM NEW.part_size
    OR OLD.minimum_non_final_part_size IS DISTINCT FROM NEW.minimum_non_final_part_size
    OR OLD.maximum_part_count IS DISTINCT FROM NEW.maximum_part_count
    OR OLD.expires_at IS DISTINCT FROM NEW.expires_at
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
  THEN RAISE EXCEPTION 'capture upload session identity is immutable'; END IF;
  IF OLD.state IN ('completed', 'aborted', 'expired') THEN
    RAISE EXCEPTION 'terminal capture upload sessions are immutable';
  END IF;
  IF OLD.state IS DISTINCT FROM NEW.state AND NOT (
    (OLD.state = 'initiated' AND NEW.state IN ('uploading', 'completed', 'aborted', 'expired'))
    OR (OLD.state = 'uploading' AND NEW.state IN ('completed', 'aborted', 'expired'))
  ) THEN RAISE EXCEPTION 'illegal capture upload transition from % to %', OLD.state, NEW.state; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION c7_validate_upload_part_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'capture upload parts cannot be deleted'; END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.capture_session_id IS DISTINCT FROM NEW.capture_session_id
    OR OLD.artifact_id IS DISTINCT FROM NEW.artifact_id
    OR OLD.upload_session_id IS DISTINCT FROM NEW.upload_session_id
    OR OLD.part_number IS DISTINCT FROM NEW.part_number
    OR OLD.byte_size IS DISTINCT FROM NEW.byte_size
    OR OLD.checksum_sha256 IS DISTINCT FROM NEW.checksum_sha256
    OR OLD.signed_at IS DISTINCT FROM NEW.signed_at
    OR OLD.provider_etag IS NOT NULL
    OR OLD.completed_at IS NOT NULL
    OR NEW.provider_etag IS NULL
    OR NEW.completed_at IS NULL
  THEN RAISE EXCEPTION 'capture upload part declaration is immutable'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION c7_validate_attempt_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'capture attempts cannot be deleted'; END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.capture_session_id IS DISTINCT FROM NEW.capture_session_id
    OR OLD.package_id IS DISTINCT FROM NEW.package_id
    OR OLD.id IS DISTINCT FROM NEW.id
    OR OLD.attempt_number IS DISTINCT FROM NEW.attempt_number
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR NEW.version <> OLD.version + 1
    OR NEW.updated_at <= OLD.updated_at
  THEN RAISE EXCEPTION 'capture attempt identity is immutable'; END IF;
  IF OLD.state IN ('cancelled', 'succeeded', 'failed') THEN
    RAISE EXCEPTION 'terminal capture attempts are immutable';
  END IF;
  IF NOT (
    (OLD.state = 'queued' AND NEW.state IN ('leased', 'cancelled', 'failed'))
    OR (OLD.state = 'leased' AND NEW.state IN (
      'leased', 'cancel-requested', 'cancelled', 'succeeded', 'failed'
    ))
    OR (OLD.state = 'cancel-requested' AND NEW.state = 'cancelled')
  ) THEN RAISE EXCEPTION 'illegal capture attempt transition from % to %', OLD.state, NEW.state; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS capture_sessions_validate_mutation ON capture_sessions;
CREATE TRIGGER capture_sessions_validate_mutation BEFORE UPDATE OR DELETE ON capture_sessions
FOR EACH ROW EXECUTE FUNCTION c7_validate_session_mutation();

DROP TRIGGER IF EXISTS capture_artifacts_validate_mutation ON capture_artifacts;
CREATE TRIGGER capture_artifacts_validate_mutation BEFORE UPDATE OR DELETE ON capture_artifacts
FOR EACH ROW EXECUTE FUNCTION c7_validate_artifact_mutation();

DROP TRIGGER IF EXISTS capture_upload_sessions_validate_mutation ON capture_artifact_upload_sessions;
CREATE TRIGGER capture_upload_sessions_validate_mutation
BEFORE UPDATE OR DELETE ON capture_artifact_upload_sessions
FOR EACH ROW EXECUTE FUNCTION c7_validate_upload_session_mutation();

DROP TRIGGER IF EXISTS capture_upload_parts_validate_mutation ON capture_artifact_upload_parts;
CREATE TRIGGER capture_upload_parts_validate_mutation
BEFORE UPDATE OR DELETE ON capture_artifact_upload_parts
FOR EACH ROW EXECUTE FUNCTION c7_validate_upload_part_mutation();

DROP TRIGGER IF EXISTS capture_attempts_validate_mutation ON capture_processing_attempts;
CREATE TRIGGER capture_attempts_validate_mutation
BEFORE UPDATE OR DELETE ON capture_processing_attempts
FOR EACH ROW EXECUTE FUNCTION c7_validate_attempt_mutation();

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'capture_briefs', 'capture_rights_events', 'capture_packages', 'capture_results',
    'capture_audit_events', 'capture_outbox'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_append_only ON %I', table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER %I_append_only BEFORE UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION c7_reject_append_only_mutation()',
      table_name,
      table_name
    );
  END LOOP;
END
$$;

INSERT INTO platform_schema_migrations (id)
VALUES ('0007_native_capture')
ON CONFLICT (id) DO NOTHING;
