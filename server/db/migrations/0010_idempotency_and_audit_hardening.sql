-- Generic idempotency table used by every write endpoint listed in the
-- hardening spec (attempt creation, submissions, approvals, certificate
-- issuance, ingestion/AI job creation, etc.) via one shared middleware rather
-- than a bespoke mechanism per route.
--
-- audit_log gains reason/correlation_id, and a restricted runtime role is
-- created with UPDATE/DELETE revoked on audit_log (and on approval actions,
-- which are equally compliance-immutable once acted) — real DB-level
-- immutability, not just "nothing in the code path updates it". The
-- placeholder password below is a local-dev default, exactly like the
-- existing docker-compose Postgres password; production must rotate it via
-- ALTER ROLE from a secrets manager, never by editing this file.

CREATE TABLE idempotency_key (
    idempotency_key TEXT PRIMARY KEY,
    endpoint        TEXT NOT NULL,
    request_hash    TEXT,
    response_status INT,
    response_body   JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE audit_log ADD COLUMN reason TEXT;
ALTER TABLE audit_log ADD COLUMN correlation_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'oworkly_app_runtime') THEN
    CREATE ROLE oworkly_app_runtime LOGIN PASSWORD 'change-me-in-production-oworkly_runtime_dev_pw';
  END IF;
END $$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO oworkly_app_runtime', current_database());
END $$;

GRANT USAGE ON SCHEMA public TO oworkly_app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO oworkly_app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO oworkly_app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO oworkly_app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO oworkly_app_runtime;

REVOKE UPDATE, DELETE ON audit_log FROM oworkly_app_runtime;
REVOKE UPDATE, DELETE ON qualification_approval_action FROM oworkly_app_runtime;
