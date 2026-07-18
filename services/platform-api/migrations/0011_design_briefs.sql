DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform_schema_migrations WHERE id = '0010_scenes') THEN
    RAISE EXCEPTION 'C11 requires migration 0010_scenes';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS design_briefs (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  current_revision integer NOT NULL CHECK (current_revision >= 1),
  current_status text NOT NULL CHECK (current_status IN ('draft', 'accepted')),
  latest_accepted_revision integer CHECK (
    latest_accepted_revision IS NULL OR latest_accepted_revision >= 1
  ),
  created_by uuid NOT NULL REFERENCES identity_users(id),
  created_at timestamptz NOT NULL,
  updated_by uuid NOT NULL REFERENCES identity_users(id),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, id),
  UNIQUE (tenant_id, project_id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  CHECK (updated_at >= created_at),
  CHECK (latest_accepted_revision IS NULL OR latest_accepted_revision <= current_revision)
);

CREATE TABLE IF NOT EXISTS design_brief_revisions (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  brief_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  schema_version text NOT NULL CHECK (schema_version = 'c11-design-brief-v1'),
  status text NOT NULL CHECK (status IN ('draft', 'accepted')),
  reason text NOT NULL CHECK (reason IN ('created', 'updated', 'accepted', 'reopened')),
  previous_revision integer CHECK (
    (revision = 1 AND previous_revision IS NULL AND reason = 'created')
    OR (revision > 1 AND previous_revision = revision - 1 AND reason <> 'created')
  ),
  brief_payload jsonb NOT NULL CHECK (
    jsonb_typeof(brief_payload) = 'object'
    AND brief_payload ->> 'schemaVersion' = schema_version
    AND brief_payload ->> 'id' = brief_id::text
    AND brief_payload ->> 'projectId' = project_id::text
    AND (brief_payload ->> 'revision')::integer = revision
    AND brief_payload ->> 'status' = status
    AND jsonb_typeof(brief_payload -> 'entries') = 'array'
    AND jsonb_array_length(brief_payload -> 'entries') <= 500
    AND jsonb_typeof(brief_payload -> 'referenceBoard') = 'array'
    AND jsonb_array_length(brief_payload -> 'referenceBoard') <= 100
  ),
  canonical_byte_length integer NOT NULL CHECK (
    canonical_byte_length BETWEEN 1 AND 1048576
  ),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  snapshot_sha256 text NOT NULL CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  entry_count integer NOT NULL CHECK (entry_count BETWEEN 0 AND 500),
  reference_count integer NOT NULL CHECK (reference_count BETWEEN 0 AND 100),
  updated_by uuid NOT NULL REFERENCES identity_users(id),
  updated_at timestamptz NOT NULL,
  accepted_by uuid REFERENCES identity_users(id),
  accepted_at timestamptz,
  PRIMARY KEY (tenant_id, project_id, brief_id, revision),
  UNIQUE (tenant_id, project_id, brief_id, revision, status),
  UNIQUE (tenant_id, project_id, brief_id, revision, snapshot_sha256),
  FOREIGN KEY (tenant_id, project_id, brief_id)
    REFERENCES design_briefs(tenant_id, project_id, id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT design_brief_revision_counts CHECK (
    jsonb_array_length(brief_payload -> 'entries') = entry_count
    AND jsonb_array_length(brief_payload -> 'referenceBoard') = reference_count
  ),
  CONSTRAINT design_brief_revision_acceptance CHECK (
    (status = 'accepted' AND reason = 'accepted'
      AND accepted_by IS NOT NULL AND accepted_at IS NOT NULL)
    OR (status = 'draft' AND reason <> 'accepted'
      AND accepted_by IS NULL AND accepted_at IS NULL)
  )
);

ALTER TABLE design_briefs DROP CONSTRAINT IF EXISTS design_briefs_current_revision_fkey;
ALTER TABLE design_briefs ADD CONSTRAINT design_briefs_current_revision_fkey
  FOREIGN KEY (tenant_id, project_id, id, current_revision, current_status)
  REFERENCES design_brief_revisions(tenant_id, project_id, brief_id, revision, status)
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS design_brief_revisions_history_idx
  ON design_brief_revisions (tenant_id, project_id, brief_id, revision DESC);
CREATE INDEX IF NOT EXISTS design_brief_revisions_hash_idx
  ON design_brief_revisions (tenant_id, project_id, content_sha256, revision);

CREATE TABLE IF NOT EXISTS design_brief_entry_projections (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  brief_id uuid NOT NULL,
  revision integer NOT NULL,
  entry_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 499),
  classification text NOT NULL CHECK (classification IN (
    'observed-evidence', 'household-assertion', 'hard-constraint', 'preference',
    'inferred-suggestion', 'unresolved-conflict', 'unknown'
  )),
  category text NOT NULL CHECK (category IN (
    'household-change', 'accessibility', 'work-study', 'cooking-dining',
    'entertaining', 'storage', 'privacy', 'acoustics', 'daylight-view',
    'garden-outdoor', 'retained-item', 'spatial-need', 'adjacency',
    'minimum-dimension', 'style-aesthetic', 'material-colour', 'reference',
    'budget-category', 'disruption-timing', 'sustainability',
    'decision-criterion', 'professional-review', 'other'
  )),
  priority integer NOT NULL CHECK (priority BETWEEN 1 AND 5),
  status text NOT NULL CHECK (status IN ('active', 'resolved', 'withdrawn')),
  statement text NOT NULL CHECK (char_length(btrim(statement)) BETWEEN 1 AND 500),
  provenance_method text NOT NULL CHECK (provenance_method IN (
    'user-stated', 'evidence-linked', 'assistant-extracted',
    'assistant-suggested', 'system-derived'
  )),
  captured_at timestamptz NOT NULL,
  asset_id uuid,
  source_message_id uuid,
  source_snapshot_id uuid,
  stated_by_user_id uuid REFERENCES identity_users(id),
  room_or_level_element_ids jsonb NOT NULL CHECK (
    jsonb_typeof(room_or_level_element_ids) = 'array'
    AND jsonb_array_length(room_or_level_element_ids) <= 50
  ),
  entry_payload jsonb NOT NULL CHECK (
    jsonb_typeof(entry_payload) = 'object'
    AND entry_payload ->> 'id' = entry_id::text
    AND entry_payload ->> 'classification' = classification
    AND entry_payload ->> 'category' = category
    AND (entry_payload ->> 'priority')::integer = priority
    AND entry_payload ->> 'status' = status
    AND entry_payload ->> 'statement' = statement
    AND entry_payload -> 'provenance' ->> 'method' = provenance_method
  ),
  PRIMARY KEY (tenant_id, project_id, brief_id, revision, entry_id),
  UNIQUE (tenant_id, project_id, brief_id, revision, ordinal),
  FOREIGN KEY (tenant_id, project_id, brief_id, revision)
    REFERENCES design_brief_revisions(tenant_id, project_id, brief_id, revision)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, asset_id)
    REFERENCES assets(tenant_id, project_id, id) ON DELETE RESTRICT,
  CONSTRAINT design_brief_entry_provenance CHECK (
    (provenance_method = 'user-stated'
      AND stated_by_user_id IS NOT NULL AND asset_id IS NULL AND source_message_id IS NULL)
    OR (provenance_method = 'evidence-linked'
      AND asset_id IS NOT NULL AND stated_by_user_id IS NULL AND source_message_id IS NULL)
    OR (provenance_method IN ('assistant-extracted', 'assistant-suggested')
      AND source_message_id IS NOT NULL AND asset_id IS NULL AND stated_by_user_id IS NULL)
    OR (provenance_method = 'system-derived'
      AND asset_id IS NULL AND source_message_id IS NULL AND stated_by_user_id IS NULL)
  ),
  CONSTRAINT design_brief_entry_classification CHECK (
    (classification <> 'household-assertion' OR provenance_method = 'user-stated')
    AND (classification <> 'preference'
      OR provenance_method IN ('user-stated', 'assistant-extracted'))
    AND (classification <> 'hard-constraint' OR provenance_method <> 'assistant-suggested')
    AND (classification <> 'observed-evidence'
      OR provenance_method = 'evidence-linked'
      OR (provenance_method = 'system-derived' AND source_snapshot_id IS NOT NULL))
    AND (classification <> 'inferred-suggestion'
      OR provenance_method IN ('assistant-suggested', 'system-derived'))
    AND (classification <> 'hard-constraint' OR status = 'active')
  )
);

CREATE INDEX IF NOT EXISTS design_brief_entries_asset_idx
  ON design_brief_entry_projections (tenant_id, project_id, asset_id, brief_id, revision)
  WHERE asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS design_brief_entries_snapshot_idx
  ON design_brief_entry_projections (tenant_id, project_id, source_snapshot_id, brief_id, revision)
  WHERE source_snapshot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS design_brief_entries_classification_idx
  ON design_brief_entry_projections (
    tenant_id, project_id, classification, status, brief_id, revision
  );

CREATE TABLE IF NOT EXISTS design_brief_reference_projections (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  brief_id uuid NOT NULL,
  revision integer NOT NULL,
  item_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 99),
  asset_id uuid NOT NULL,
  rights_record_sha256 text NOT NULL CHECK (rights_record_sha256 ~ '^[0-9a-f]{64}$'),
  sentiment text NOT NULL CHECK (sentiment IN ('like', 'dislike', 'context-only')),
  note text CHECK (note IS NULL OR char_length(btrim(note)) BETWEEN 1 AND 500),
  item_payload jsonb NOT NULL CHECK (
    jsonb_typeof(item_payload) = 'object'
    AND item_payload ->> 'id' = item_id::text
    AND item_payload ->> 'assetId' = asset_id::text
    AND item_payload ->> 'rightsRecordSha256' = rights_record_sha256
    AND item_payload ->> 'sentiment' = sentiment
  ),
  PRIMARY KEY (tenant_id, project_id, brief_id, revision, item_id),
  UNIQUE (tenant_id, project_id, brief_id, revision, ordinal),
  FOREIGN KEY (tenant_id, project_id, brief_id, revision)
    REFERENCES design_brief_revisions(tenant_id, project_id, brief_id, revision)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, asset_id)
    REFERENCES assets(tenant_id, project_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS design_brief_references_asset_idx
  ON design_brief_reference_projections (
    tenant_id, project_id, asset_id, brief_id, revision
  );

CREATE TABLE IF NOT EXISTS design_brief_acceptance_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  brief_id uuid NOT NULL,
  accepted_revision integer NOT NULL CHECK (accepted_revision >= 2),
  accepted_status text NOT NULL DEFAULT 'accepted' CHECK (accepted_status = 'accepted'),
  accepted_by uuid NOT NULL REFERENCES identity_users(id),
  accepted_at timestamptz NOT NULL,
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  trace_id text NOT NULL CHECK (trace_id ~ '^[0-9a-f]{32}$'),
  UNIQUE (tenant_id, project_id, brief_id, accepted_revision),
  FOREIGN KEY (tenant_id, project_id, brief_id, accepted_revision, accepted_status)
    REFERENCES design_brief_revisions(tenant_id, project_id, brief_id, revision, status)
    ON DELETE RESTRICT
);

ALTER TABLE design_briefs DROP CONSTRAINT IF EXISTS design_briefs_latest_acceptance_fkey;
ALTER TABLE design_briefs ADD CONSTRAINT design_briefs_latest_acceptance_fkey
  FOREIGN KEY (tenant_id, project_id, id, latest_accepted_revision)
  REFERENCES design_brief_acceptance_events(
    tenant_id, project_id, brief_id, accepted_revision
  ) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS design_brief_acceptance_time_idx
  ON design_brief_acceptance_events (tenant_id, project_id, accepted_at, id);

CREATE TABLE IF NOT EXISTS design_brief_idempotency_effects (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  actor_user_id uuid NOT NULL REFERENCES identity_users(id),
  operation text NOT NULL CHECK (operation IN (
    'brief.update', 'brief.accept', 'consultation.session.create',
    'consultation.session.cancel', 'consultation.proposal.confirm'
  )),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  response_status integer CHECK (response_status IN (200, 201)),
  response_payload jsonb CHECK (
    response_payload IS NULL OR jsonb_typeof(response_payload) = 'object'
  ),
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  PRIMARY KEY (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT design_brief_idempotency_completion CHECK (
    (response_status IS NULL AND response_payload IS NULL AND completed_at IS NULL)
    OR (response_status IS NOT NULL AND response_payload IS NOT NULL AND completed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS design_brief_idempotency_project_idx
  ON design_brief_idempotency_effects (tenant_id, project_id, created_at, idempotency_key);

CREATE TABLE IF NOT EXISTS design_brief_audit_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  brief_id uuid NOT NULL,
  revision integer NOT NULL,
  action text NOT NULL CHECK (action IN (
    'brief.create', 'brief.update', 'brief.accept', 'brief.reopen'
  )),
  actor_user_id uuid NOT NULL REFERENCES identity_users(id),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  trace_id text NOT NULL CHECK (trace_id ~ '^[0-9a-f]{32}$'),
  metadata jsonb NOT NULL CHECK (
    jsonb_typeof(metadata) = 'object'
    AND metadata ?& ARRAY[
      'revision', 'entryCount', 'referenceCount', 'contentSha256', 'snapshotSha256'
    ]
    AND NOT metadata ?| ARRAY[
      'statement', 'message', 'operations', 'entries', 'referenceBoard', 'payload',
      'prompt', 'health', 'accessibility', 'address', 'assetLocator', 'url',
      'token', 'credential', 'secret'
    ]
  ),
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, project_id, brief_id, revision)
    REFERENCES design_brief_revisions(tenant_id, project_id, brief_id, revision)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS design_brief_audit_project_idx
  ON design_brief_audit_events (tenant_id, project_id, occurred_at, id);

CREATE TABLE IF NOT EXISTS consultation_sessions (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  schema_version text NOT NULL CHECK (schema_version = 'c11-consultation-session-v1'),
  base_brief_id uuid NOT NULL,
  base_brief_revision integer NOT NULL CHECK (base_brief_revision >= 1),
  provider_mode text NOT NULL CHECK (provider_mode IN ('deterministic-local', 'external-disabled')),
  state text NOT NULL CHECK (state IN ('active', 'cancelled', 'completed')),
  turn_count integer NOT NULL DEFAULT 0 CHECK (turn_count BETWEEN 0 AND 100),
  created_by uuid NOT NULL REFERENCES identity_users(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  cancelled_at timestamptz,
  PRIMARY KEY (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id, base_brief_id, base_brief_revision)
    REFERENCES design_brief_revisions(tenant_id, project_id, brief_id, revision)
    ON DELETE RESTRICT,
  CONSTRAINT consultation_session_terminal_time CHECK (
    (state = 'cancelled' AND cancelled_at IS NOT NULL)
    OR (state <> 'cancelled' AND cancelled_at IS NULL)
  ),
  CHECK (updated_at >= created_at)
);

CREATE INDEX IF NOT EXISTS consultation_sessions_project_idx
  ON consultation_sessions (tenant_id, project_id, created_at DESC, id);
CREATE INDEX IF NOT EXISTS consultation_sessions_active_idx
  ON consultation_sessions (tenant_id, project_id, updated_at, id)
  WHERE state = 'active';

CREATE TABLE IF NOT EXISTS consultation_messages (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  session_id uuid NOT NULL,
  id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 200),
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  client_message_id uuid,
  content text NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 8000),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid REFERENCES identity_users(id),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, session_id, id),
  UNIQUE (tenant_id, project_id, session_id, ordinal),
  UNIQUE (tenant_id, project_id, session_id, client_message_id),
  UNIQUE (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id, session_id)
    REFERENCES consultation_sessions(tenant_id, project_id, id) ON DELETE RESTRICT,
  CONSTRAINT consultation_message_actor CHECK (
    (role = 'user' AND created_by IS NOT NULL AND client_message_id IS NOT NULL)
    OR (role IN ('assistant', 'system') AND created_by IS NULL AND client_message_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS consultation_messages_session_idx
  ON consultation_messages (tenant_id, project_id, session_id, ordinal);

ALTER TABLE design_brief_entry_projections
  DROP CONSTRAINT IF EXISTS design_brief_entries_source_message_fkey;
ALTER TABLE design_brief_entry_projections
  ADD CONSTRAINT design_brief_entries_source_message_fkey
  FOREIGN KEY (tenant_id, project_id, source_message_id)
  REFERENCES consultation_messages(tenant_id, project_id, id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS consultation_patch_proposals (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  session_id uuid NOT NULL,
  id uuid NOT NULL,
  schema_version text NOT NULL CHECK (schema_version = 'c11-brief-patch-proposal-v1'),
  base_brief_id uuid NOT NULL,
  base_brief_revision integer NOT NULL CHECK (base_brief_revision >= 1),
  source_message_id uuid NOT NULL,
  proposal_payload jsonb NOT NULL CHECK (
    jsonb_typeof(proposal_payload) = 'object'
    AND proposal_payload ->> 'schemaVersion' = schema_version
    AND proposal_payload ->> 'id' = id::text
    AND proposal_payload ->> 'sessionId' = session_id::text
    AND proposal_payload ->> 'projectId' = project_id::text
    AND proposal_payload ->> 'baseBriefId' = base_brief_id::text
    AND (proposal_payload ->> 'baseBriefRevision')::integer = base_brief_revision
    AND proposal_payload ->> 'sourceMessageId' = source_message_id::text
    AND proposal_payload ->> 'status' = 'pending'
    AND proposal_payload -> 'providerManifest' ->> 'adapter' = 'deterministic-local-v1'
    AND (proposal_payload -> 'providerManifest' ->> 'externalNetworkUsed')::boolean = false
    AND jsonb_typeof(proposal_payload -> 'operations') = 'array'
    AND jsonb_array_length(proposal_payload -> 'operations') <= 100
    AND jsonb_typeof(proposal_payload -> 'clarifyingQuestions') = 'array'
    AND jsonb_array_length(proposal_payload -> 'clarifyingQuestions') <= 20
    AND jsonb_typeof(proposal_payload -> 'professionalReview') = 'array'
    AND jsonb_array_length(proposal_payload -> 'professionalReview') <= 50
  ),
  proposal_sha256 text NOT NULL CHECK (proposal_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  PRIMARY KEY (tenant_id, project_id, session_id, id),
  UNIQUE (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id, session_id)
    REFERENCES consultation_sessions(tenant_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, base_brief_id, base_brief_revision)
    REFERENCES design_brief_revisions(tenant_id, project_id, brief_id, revision)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, source_message_id)
    REFERENCES consultation_messages(tenant_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, session_id, source_message_id)
    REFERENCES consultation_messages(tenant_id, project_id, session_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS consultation_proposals_session_idx
  ON consultation_patch_proposals (tenant_id, project_id, session_id, created_at, id);
CREATE INDEX IF NOT EXISTS consultation_proposals_expiry_idx
  ON consultation_patch_proposals (expires_at, id);

CREATE TABLE IF NOT EXISTS consultation_proposal_state_events (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 4),
  status text NOT NULL CHECK (status IN ('pending', 'confirmed', 'expired', 'rejected')),
  changed_by uuid REFERENCES identity_users(id),
  reason_code text CHECK (
    reason_code IS NULL OR reason_code IN (
      'confirmed', 'expired', 'rejected', 'session-cancelled', 'session-completed',
      'superseded-by-new-turn'
    )
  ),
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, proposal_id, ordinal),
  UNIQUE (tenant_id, project_id, proposal_id, ordinal, status),
  FOREIGN KEY (tenant_id, project_id, proposal_id)
    REFERENCES consultation_patch_proposals(tenant_id, project_id, id) ON DELETE RESTRICT,
  CONSTRAINT consultation_proposal_state_actor CHECK (
    (status = 'pending' AND ordinal = 1 AND changed_by IS NULL AND reason_code IS NULL)
    OR (status = 'confirmed' AND ordinal = 2
      AND changed_by IS NOT NULL AND reason_code = 'confirmed')
    OR (status IN ('expired', 'rejected') AND ordinal = 2 AND reason_code IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS consultation_proposal_heads (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  current_ordinal integer NOT NULL DEFAULT 1 CHECK (current_ordinal BETWEEN 1 AND 4),
  current_status text NOT NULL DEFAULT 'pending' CHECK (
    current_status IN ('pending', 'confirmed', 'expired', 'rejected')
  ),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, proposal_id),
  FOREIGN KEY (tenant_id, project_id, proposal_id, current_ordinal, current_status)
    REFERENCES consultation_proposal_state_events(
      tenant_id, project_id, proposal_id, ordinal, status
    ) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS consultation_proposal_heads_pending_idx
  ON consultation_proposal_heads (tenant_id, project_id, updated_at, proposal_id)
  WHERE current_status = 'pending';

CREATE TABLE IF NOT EXISTS consultation_proposal_confirmations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  session_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  brief_id uuid NOT NULL,
  base_brief_revision integer NOT NULL CHECK (base_brief_revision >= 1),
  applied_brief_revision integer NOT NULL CHECK (
    applied_brief_revision = base_brief_revision + 1
  ),
  confirmed_by uuid NOT NULL REFERENCES identity_users(id),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  confirmed_at timestamptz NOT NULL,
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  trace_id text NOT NULL CHECK (trace_id ~ '^[0-9a-f]{32}$'),
  UNIQUE (tenant_id, project_id, proposal_id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, project_id, session_id, proposal_id)
    REFERENCES consultation_patch_proposals(tenant_id, project_id, session_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, brief_id, base_brief_revision)
    REFERENCES design_brief_revisions(tenant_id, project_id, brief_id, revision)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, brief_id, applied_brief_revision)
    REFERENCES design_brief_revisions(tenant_id, project_id, brief_id, revision)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS consultation_confirmations_brief_idx
  ON consultation_proposal_confirmations (
    tenant_id, project_id, brief_id, applied_brief_revision
  );

CREATE OR REPLACE FUNCTION c11_reject_append_only_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE OR REPLACE FUNCTION c11_validate_brief_pointer_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'design brief identities cannot be deleted'; END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.id IS DISTINCT FROM NEW.id
    OR OLD.created_by IS DISTINCT FROM NEW.created_by
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR NEW.current_revision <> OLD.current_revision + 1
    OR NEW.updated_at <= OLD.updated_at
  THEN RAISE EXCEPTION 'design brief identity or revision ordering is immutable'; END IF;
  IF NOT (
    (OLD.current_status = 'draft' AND NEW.current_status IN ('draft', 'accepted'))
    OR (OLD.current_status = 'accepted' AND NEW.current_status = 'draft')
  ) THEN
    RAISE EXCEPTION 'illegal design brief lifecycle transition from % to %',
      OLD.current_status, NEW.current_status;
  END IF;
  IF NEW.current_status = 'accepted'
    AND NEW.latest_accepted_revision IS DISTINCT FROM NEW.current_revision
  THEN RAISE EXCEPTION 'accepted current brief must advance the acceptance pointer'; END IF;
  IF NEW.current_status = 'draft'
    AND NEW.latest_accepted_revision IS DISTINCT FROM OLD.latest_accepted_revision
  THEN RAISE EXCEPTION 'draft edits cannot rewrite acceptance history'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION c11_validate_idempotency_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'brief idempotency effects cannot be deleted'; END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key
    OR OLD.actor_user_id IS DISTINCT FROM NEW.actor_user_id
    OR OLD.operation IS DISTINCT FROM NEW.operation
    OR OLD.request_sha256 IS DISTINCT FROM NEW.request_sha256
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
  THEN RAISE EXCEPTION 'brief idempotency identity is immutable'; END IF;
  IF OLD.completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'completed brief idempotency effects are immutable';
  END IF;
  IF NEW.completed_at IS NULL THEN RAISE EXCEPTION 'idempotency completion is required'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION c11_validate_session_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'consultation sessions cannot be deleted'; END IF;
  IF OLD.state IN ('cancelled', 'completed') THEN
    RAISE EXCEPTION 'terminal consultation sessions are immutable';
  END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.id IS DISTINCT FROM NEW.id
    OR OLD.schema_version IS DISTINCT FROM NEW.schema_version
    OR OLD.base_brief_id IS DISTINCT FROM NEW.base_brief_id
    OR OLD.base_brief_revision IS DISTINCT FROM NEW.base_brief_revision
    OR OLD.provider_mode IS DISTINCT FROM NEW.provider_mode
    OR OLD.created_by IS DISTINCT FROM NEW.created_by
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR NEW.updated_at <= OLD.updated_at
    OR NEW.turn_count < OLD.turn_count
    OR NEW.turn_count > OLD.turn_count + 1
  THEN RAISE EXCEPTION 'consultation session identity or ordering is immutable'; END IF;
  IF NOT (
    (NEW.state = 'active' AND NEW.turn_count = OLD.turn_count + 1)
    OR (NEW.state IN ('cancelled', 'completed') AND NEW.turn_count = OLD.turn_count)
  ) THEN RAISE EXCEPTION 'illegal consultation session transition'; END IF;
  IF NEW.state IN ('cancelled', 'completed') AND EXISTS (
    SELECT 1
    FROM consultation_patch_proposals p
    JOIN consultation_proposal_heads h
      ON h.tenant_id = p.tenant_id AND h.project_id = p.project_id
      AND h.proposal_id = p.id
    WHERE p.tenant_id = NEW.tenant_id AND p.project_id = NEW.project_id
      AND p.session_id = NEW.id AND h.current_status = 'pending'
  ) THEN
    RAISE EXCEPTION 'terminal consultation sessions cannot retain pending proposals';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION c11_validate_proposal_head_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'consultation proposal heads cannot be deleted'; END IF;
  IF OLD.current_status <> 'pending' THEN
    RAISE EXCEPTION 'terminal consultation proposals are immutable';
  END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.proposal_id IS DISTINCT FROM NEW.proposal_id
    OR NEW.current_ordinal <> OLD.current_ordinal + 1
    OR NEW.current_status NOT IN ('confirmed', 'expired', 'rejected')
    OR NEW.updated_at <= OLD.updated_at
  THEN RAISE EXCEPTION 'illegal consultation proposal transition'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION c11_validate_entry_sources()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE snapshot_count integer;
BEGIN
  IF NEW.source_snapshot_id IS NOT NULL THEN
    SELECT count(*)::integer INTO snapshot_count
    FROM canonical_model_snapshots s
    WHERE s.tenant_id = NEW.tenant_id AND s.project_id = NEW.project_id
      AND s.id = NEW.source_snapshot_id;
    IF snapshot_count <> 1 THEN
      RAISE EXCEPTION 'brief source snapshot must resolve exactly once inside project scope';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS design_briefs_validate_mutation ON design_briefs;
CREATE TRIGGER design_briefs_validate_mutation
BEFORE UPDATE OR DELETE ON design_briefs
FOR EACH ROW EXECUTE FUNCTION c11_validate_brief_pointer_mutation();

DROP TRIGGER IF EXISTS design_brief_idempotency_validate ON design_brief_idempotency_effects;
CREATE TRIGGER design_brief_idempotency_validate
BEFORE UPDATE OR DELETE ON design_brief_idempotency_effects
FOR EACH ROW EXECUTE FUNCTION c11_validate_idempotency_mutation();

DROP TRIGGER IF EXISTS consultation_sessions_validate_mutation ON consultation_sessions;
CREATE TRIGGER consultation_sessions_validate_mutation
BEFORE UPDATE OR DELETE ON consultation_sessions
FOR EACH ROW EXECUTE FUNCTION c11_validate_session_mutation();

DROP TRIGGER IF EXISTS consultation_proposal_heads_validate_mutation
  ON consultation_proposal_heads;
CREATE TRIGGER consultation_proposal_heads_validate_mutation
BEFORE UPDATE OR DELETE ON consultation_proposal_heads
FOR EACH ROW EXECUTE FUNCTION c11_validate_proposal_head_mutation();

DROP TRIGGER IF EXISTS design_brief_entry_sources_validate
  ON design_brief_entry_projections;
CREATE TRIGGER design_brief_entry_sources_validate
BEFORE INSERT ON design_brief_entry_projections
FOR EACH ROW EXECUTE FUNCTION c11_validate_entry_sources();

DROP TRIGGER IF EXISTS design_brief_revisions_append_only ON design_brief_revisions;
CREATE TRIGGER design_brief_revisions_append_only
BEFORE UPDATE OR DELETE ON design_brief_revisions
FOR EACH ROW EXECUTE FUNCTION c11_reject_append_only_mutation();
DROP TRIGGER IF EXISTS design_brief_entries_append_only ON design_brief_entry_projections;
CREATE TRIGGER design_brief_entries_append_only
BEFORE UPDATE OR DELETE ON design_brief_entry_projections
FOR EACH ROW EXECUTE FUNCTION c11_reject_append_only_mutation();
DROP TRIGGER IF EXISTS design_brief_references_append_only ON design_brief_reference_projections;
CREATE TRIGGER design_brief_references_append_only
BEFORE UPDATE OR DELETE ON design_brief_reference_projections
FOR EACH ROW EXECUTE FUNCTION c11_reject_append_only_mutation();
DROP TRIGGER IF EXISTS design_brief_acceptances_append_only ON design_brief_acceptance_events;
CREATE TRIGGER design_brief_acceptances_append_only
BEFORE UPDATE OR DELETE ON design_brief_acceptance_events
FOR EACH ROW EXECUTE FUNCTION c11_reject_append_only_mutation();
DROP TRIGGER IF EXISTS design_brief_audit_append_only ON design_brief_audit_events;
CREATE TRIGGER design_brief_audit_append_only
BEFORE UPDATE OR DELETE ON design_brief_audit_events
FOR EACH ROW EXECUTE FUNCTION c11_reject_append_only_mutation();
DROP TRIGGER IF EXISTS consultation_messages_append_only ON consultation_messages;
CREATE TRIGGER consultation_messages_append_only
BEFORE UPDATE OR DELETE ON consultation_messages
FOR EACH ROW EXECUTE FUNCTION c11_reject_append_only_mutation();
DROP TRIGGER IF EXISTS consultation_proposals_append_only ON consultation_patch_proposals;
CREATE TRIGGER consultation_proposals_append_only
BEFORE UPDATE OR DELETE ON consultation_patch_proposals
FOR EACH ROW EXECUTE FUNCTION c11_reject_append_only_mutation();
DROP TRIGGER IF EXISTS consultation_proposal_states_append_only
  ON consultation_proposal_state_events;
CREATE TRIGGER consultation_proposal_states_append_only
BEFORE UPDATE OR DELETE ON consultation_proposal_state_events
FOR EACH ROW EXECUTE FUNCTION c11_reject_append_only_mutation();
DROP TRIGGER IF EXISTS consultation_confirmations_append_only
  ON consultation_proposal_confirmations;
CREATE TRIGGER consultation_confirmations_append_only
BEFORE UPDATE OR DELETE ON consultation_proposal_confirmations
FOR EACH ROW EXECUTE FUNCTION c11_reject_append_only_mutation();

INSERT INTO platform_schema_migrations (id)
VALUES ('0011_design_briefs')
ON CONFLICT (id) DO NOTHING;
