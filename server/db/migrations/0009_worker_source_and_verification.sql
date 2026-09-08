-- Worker source/enrollment/verification: data sources (HRMS/vendor connectors,
-- configurable rows not hardcoded connector names), per-process enrollment
-- (current/target process level — distinct from the historical
-- worker_process_skill read-model), and worker self-assessment verification
-- (salted-hash PIN, never plaintext, with lockout and an audited session log).

ALTER TABLE worker ADD COLUMN employment_type_migrating_note TEXT; -- documents the value remap below, dropped at end
UPDATE worker SET employment_type = 'DIRECT' WHERE employment_type = 'permanent';
UPDATE worker SET employment_type = 'CONTRACT' WHERE employment_type = 'contract';
ALTER TABLE worker DROP CONSTRAINT IF EXISTS worker_employment_type_check;
ALTER TABLE worker ALTER COLUMN employment_type SET DEFAULT 'DIRECT';
ALTER TABLE worker ADD CONSTRAINT worker_employment_type_check CHECK (employment_type IN ('DIRECT','CONTRACT','VENDOR'));
ALTER TABLE worker DROP COLUMN employment_type_migrating_note;

CREATE TABLE data_source (
    data_source_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
    source_type     VARCHAR(30) NOT NULL,
    name            VARCHAR(150) NOT NULL,
    category        VARCHAR(20) NOT NULL DEFAULT 'HRMS' CHECK (category IN ('HRMS','ERP','EXTERNAL','NATIVE')),
    status          VARCHAR(20) NOT NULL DEFAULT 'Connected' CHECK (status IN ('Connected','Degraded','Disabled','Error')),
    description     TEXT,
    mapped_fields   TEXT[],
    last_success_sync_at TIMESTAMPTZ,
    last_attempt_sync_at TIMESTAMPTZ,
    error_summary   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sync_run (
    sync_run_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_source_id  UUID NOT NULL REFERENCES data_source(data_source_id) ON DELETE CASCADE,
    status          VARCHAR(20) NOT NULL CHECK (status IN ('success','degraded','error')),
    workers_synced  INT NOT NULL DEFAULT 0,
    error_detail    TEXT,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at     TIMESTAMPTZ
);

ALTER TABLE worker ADD COLUMN data_source_id UUID REFERENCES data_source(data_source_id);

CREATE TABLE worker_process_enrollment (
    worker_process_enrollment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id       UUID NOT NULL REFERENCES worker(worker_id) ON DELETE CASCADE,
    process_id      UUID NOT NULL REFERENCES process(process_id) ON DELETE CASCADE,
    current_process_level_id UUID REFERENCES process_level(process_level_id),
    target_process_level_id UUID REFERENCES process_level(process_level_id),
    status          VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
    enrolled_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    source          VARCHAR(20) NOT NULL DEFAULT 'manual',
    UNIQUE (worker_id, process_id)
);

CREATE TABLE worker_verification_credential (
    worker_id       UUID PRIMARY KEY REFERENCES worker(worker_id) ON DELETE CASCADE,
    pin_hash        TEXT NOT NULL,
    pin_salt        TEXT NOT NULL,
    failed_attempt_count SMALLINT NOT NULL DEFAULT 0,
    locked_until    TIMESTAMPTZ,
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE worker_verification_session (
    worker_verification_session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id       UUID NOT NULL REFERENCES worker(worker_id),
    method          VARCHAR(30) NOT NULL CHECK (method IN ('SUPERVISOR_PIN','SUPERVISOR_LOGIN','FACE_RECOGNITION')),
    supervisor_user_id UUID REFERENCES app_user(user_id),
    device_info     TEXT,
    outcome         VARCHAR(20) NOT NULL CHECK (outcome IN ('success','failed')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
