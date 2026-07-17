CREATE TABLE IF NOT EXISTS platform_schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS identity_tenants (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS identity_users (
  id uuid PRIMARY KEY,
  subject text NOT NULL UNIQUE CHECK (char_length(subject) BETWEEN 3 AND 200),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS identity_memberships (
  tenant_id uuid NOT NULL REFERENCES identity_tenants(id),
  user_id uuid NOT NULL REFERENCES identity_users(id),
  role text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  fixture_persona text UNIQUE,
  is_fixture boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, user_id),
  CONSTRAINT identity_memberships_fixture_consistency CHECK (
    (is_fixture AND fixture_persona IS NOT NULL)
    OR (NOT is_fixture AND fixture_persona IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS identity_memberships_tenant_idx
  ON identity_memberships (tenant_id, user_id);

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES identity_tenants(id),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS projects_tenant_created_idx
  ON projects (tenant_id, created_at, id);

CREATE TABLE IF NOT EXISTS project_intakes (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  intake jsonb NOT NULL CHECK (jsonb_typeof(intake) = 'object'),
  version integer NOT NULL CHECK (version >= 1),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by uuid NOT NULL REFERENCES identity_users(id),
  PRIMARY KEY (tenant_id, project_id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS mutation_idempotency (
  tenant_id uuid NOT NULL REFERENCES identity_tenants(id),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  actor_user_id uuid NOT NULL REFERENCES identity_users(id),
  operation text NOT NULL CHECK (char_length(operation) BETWEEN 1 AND 100),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  PRIMARY KEY (tenant_id, idempotency_key),
  CONSTRAINT mutation_idempotency_completion_consistency CHECK (
    (response_status IS NULL AND response_body IS NULL AND completed_at IS NULL)
    OR (response_status IS NOT NULL AND response_body IS NOT NULL AND completed_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES identity_tenants(id),
  actor_user_id uuid NOT NULL REFERENCES identity_users(id),
  action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 100),
  resource_type text NOT NULL CHECK (char_length(resource_type) BETWEEN 1 AND 80),
  resource_id uuid NOT NULL,
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  trace_id text NOT NULL CHECK (trace_id ~ '^[0-9a-f]{32}$'),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS audit_events_tenant_time_idx
  ON audit_events (tenant_id, occurred_at, id);

INSERT INTO platform_schema_migrations (id)
VALUES ('0001_identity_projects_intake')
ON CONFLICT (id) DO NOTHING;
