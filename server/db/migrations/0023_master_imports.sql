-- M13: shared master-data import engine (organisation + worker imports
-- reuse the same batch/staging/error lifecycle -- see importService.ts).
-- Unvalidated rows are never written to live hierarchy/worker tables; a
-- batch only writes real data on an explicit /publish call after validation.

CREATE TABLE import_batch (
    import_batch_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id        UUID NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
    import_type       VARCHAR(20) NOT NULL CHECK (import_type IN ('ORGANISATION','WORKER')),
    status            VARCHAR(20) NOT NULL DEFAULT 'UPLOADED'
        CHECK (status IN ('UPLOADED','VALIDATING','VALID','INVALID','PUBLISHED','PARTIALLY_PUBLISHED','FAILED','CANCELLED')),
    source_filename   VARCHAR(255) NOT NULL,
    source_file_ref   TEXT,
    uploaded_by_user_id UUID NOT NULL REFERENCES app_user(user_id),
    row_count         INT NOT NULL DEFAULT 0,
    created_count     INT NOT NULL DEFAULT 0,
    updated_count     INT NOT NULL DEFAULT 0,
    skipped_count     INT NOT NULL DEFAULT 0,
    error_count       INT NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    validated_at      TIMESTAMPTZ,
    published_at      TIMESTAMPTZ,
    cancelled_at      TIMESTAMPTZ
);
CREATE INDEX ix_import_batch_company ON import_batch(company_id, created_at DESC);
CREATE INDEX ix_import_batch_status ON import_batch(status);

CREATE TABLE import_staging_row (
    staging_row_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    import_batch_id   UUID NOT NULL REFERENCES import_batch(import_batch_id) ON DELETE CASCADE,
    row_number        INT NOT NULL,
    raw_json          JSONB NOT NULL,
    normalized_json   JSONB,
    is_valid          BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (import_batch_id, row_number)
);
CREATE INDEX ix_import_staging_row_batch ON import_staging_row(import_batch_id);

CREATE TABLE import_row_error (
    import_row_error_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    import_batch_id   UUID NOT NULL REFERENCES import_batch(import_batch_id) ON DELETE CASCADE,
    row_number        INT NOT NULL,
    field             VARCHAR(100),
    code              VARCHAR(60) NOT NULL,
    message           TEXT NOT NULL
);
CREATE INDEX ix_import_row_error_batch ON import_row_error(import_batch_id);
