DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform_schema_migrations WHERE id = '0007_native_capture') THEN
    RAISE EXCEPTION 'C14.8 requires migration 0007_native_capture';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform_schema_migrations WHERE id = '0008_reconstruction') THEN
    RAISE EXCEPTION 'C14.8 requires migration 0008_reconstruction';
  END IF;
END
$$;

ALTER TABLE capture_sessions DROP CONSTRAINT IF EXISTS capture_sessions_state_check;
ALTER TABLE capture_sessions ADD CONSTRAINT capture_sessions_state_check CHECK (state IN (
  'created', 'uploading', 'uploaded', 'processing', 'accepted', 'proposed', 'abstained',
  'cancel-requested', 'cancelled', 'failed'
));

ALTER TABLE capture_artifacts DROP CONSTRAINT IF EXISTS capture_artifacts_kind_check;
ALTER TABLE capture_artifacts ADD CONSTRAINT capture_artifacts_kind_check CHECK (kind IN (
  'captured-room-json', 'captured-room-data-json', 'captured-structure-json',
  'roomplan-normalized-json', 'quality-manifest-json', 'depth-sequence', 'structure-usdz'
));

ALTER TABLE capture_artifacts DROP CONSTRAINT IF EXISTS capture_artifacts_content_type_check;
ALTER TABLE capture_artifacts ADD CONSTRAINT capture_artifacts_content_type_check CHECK (
  content_type IN ('application/json', 'application/octet-stream', 'model/vnd.usdz+zip')
);

ALTER TABLE capture_artifacts DROP CONSTRAINT IF EXISTS capture_artifacts_media;
ALTER TABLE capture_artifacts ADD CONSTRAINT capture_artifacts_media CHECK (
  (kind = 'structure-usdz' AND content_type = 'model/vnd.usdz+zip')
  OR (kind = 'depth-sequence' AND content_type = 'application/octet-stream')
  OR (kind NOT IN ('structure-usdz', 'depth-sequence') AND content_type = 'application/json')
);

CREATE TABLE IF NOT EXISTS capture_envelopes (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  capture_session_id uuid NOT NULL,
  id uuid NOT NULL,
  schema_version text NOT NULL CHECK (schema_version = 'capture-envelope-v1'),
  envelope_sha256 text NOT NULL CHECK (envelope_sha256 ~ '^[0-9a-f]{64}$'),
  envelope_payload jsonb NOT NULL CHECK (
    jsonb_typeof(envelope_payload) = 'object'
    AND envelope_payload ->> 'schemaVersion' = 'capture-envelope-v1'
    AND envelope_payload ->> 'projectId' = project_id::text
    AND envelope_payload ->> 'captureSessionId' = capture_session_id::text
    AND envelope_payload ->> 'transferState' = 'complete'
  ),
  accepted_by uuid NOT NULL REFERENCES identity_users(id),
  accepted_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, capture_session_id, id),
  UNIQUE (tenant_id, project_id, capture_session_id),
  UNIQUE (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id, capture_session_id)
    REFERENCES capture_sessions(tenant_id, project_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS capture_envelope_media_sources (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  capture_session_id uuid NOT NULL,
  envelope_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('rgb-keyframe', 'rgb-video')),
  detected_mime_type text NOT NULL CHECK (detected_mime_type IN (
    'image/heic', 'image/jpeg', 'image/png', 'video/mp4', 'video/quicktime'
  )),
  source_byte_size bigint NOT NULL CHECK (source_byte_size BETWEEN 1 AND 21474836480),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, capture_session_id, envelope_id, asset_id),
  FOREIGN KEY (tenant_id, project_id, capture_session_id, envelope_id)
    REFERENCES capture_envelopes(tenant_id, project_id, capture_session_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, asset_id)
    REFERENCES assets(tenant_id, project_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS capture_envelope_depth_sources (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  capture_session_id uuid NOT NULL,
  envelope_id uuid NOT NULL,
  artifact_id uuid NOT NULL,
  source_byte_size bigint NOT NULL CHECK (source_byte_size BETWEEN 1 AND 536870912),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, capture_session_id, envelope_id, artifact_id),
  FOREIGN KEY (tenant_id, project_id, capture_session_id, envelope_id)
    REFERENCES capture_envelopes(tenant_id, project_id, capture_session_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, capture_session_id, artifact_id)
    REFERENCES capture_artifacts(tenant_id, project_id, capture_session_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS capture_envelope_roomplan_sources (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  capture_session_id uuid NOT NULL,
  envelope_id uuid NOT NULL,
  source_capture_session_id uuid NOT NULL,
  source_package_id uuid NOT NULL,
  package_manifest_sha256 text NOT NULL CHECK (package_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (
    tenant_id, project_id, capture_session_id, envelope_id,
    source_capture_session_id, source_package_id
  ),
  FOREIGN KEY (tenant_id, project_id, capture_session_id, envelope_id)
    REFERENCES capture_envelopes(tenant_id, project_id, capture_session_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, source_capture_session_id, source_package_id)
    REFERENCES capture_packages(tenant_id, project_id, capture_session_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS capture_envelope_reconstruction_links (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  capture_session_id uuid NOT NULL,
  envelope_id uuid NOT NULL,
  reconstruction_job_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES identity_users(id),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, capture_session_id, envelope_id),
  UNIQUE (tenant_id, project_id, reconstruction_job_id),
  FOREIGN KEY (tenant_id, project_id, capture_session_id, envelope_id)
    REFERENCES capture_envelopes(tenant_id, project_id, capture_session_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, reconstruction_job_id)
    REFERENCES reconstruction_jobs(tenant_id, project_id, id) ON DELETE RESTRICT
);

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
  IF OLD.state IN ('accepted', 'proposed', 'abstained', 'cancelled') THEN
    RAISE EXCEPTION 'terminal capture sessions are immutable';
  END IF;
  IF NOT (
    (OLD.state = 'created' AND NEW.state IN ('uploading', 'accepted', 'cancelled', 'failed'))
    OR (OLD.state = 'uploading' AND NEW.state IN ('uploaded', 'accepted', 'cancelled', 'failed'))
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

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'capture_envelopes', 'capture_envelope_media_sources',
    'capture_envelope_depth_sources', 'capture_envelope_roomplan_sources',
    'capture_envelope_reconstruction_links'
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
VALUES ('0015_device_neutral_capture_envelopes')
ON CONFLICT (id) DO NOTHING;
