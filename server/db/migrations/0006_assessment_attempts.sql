-- Replaces the old assessment_attempt/assessment_score_component pair with a
-- normalized attempt -> component-attempt -> item-response chain. One row per
-- item response (not just a detail_json blob) is the "real" per-criterion
-- audit trail the hardening plan called for, now built directly into the new
-- model instead of retrofitted onto the old one.
--
-- assessment_attempt.qualification_case_id is added without its FK yet —
-- qualification_case is created in the next migration; the FK is attached
-- there.
--
-- The old MVP schema already has a table named assessment_attempt (legacy
-- Module 3 demo) — renamed out of the way rather than dropped, preserving its
-- data and the FKs pointing at it (Postgres tracks FKs by OID, so a rename
-- doesn't break assessment_outcome/assessment_score_component's references).

ALTER TABLE assessment_attempt RENAME TO legacy_assessment_attempt;

CREATE TABLE assessment_attempt (
    assessment_attempt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    qualification_case_id UUID,
    assessment_package_id UUID NOT NULL REFERENCES assessment_package(assessment_package_id),
    worker_id       UUID NOT NULL REFERENCES worker(worker_id),
    attempt_no      SMALLINT NOT NULL DEFAULT 1,
    status          VARCHAR(20) NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled','in_progress','submitted','scored','cancelled')),
    client_idempotency_key UUID UNIQUE,
    started_at      TIMESTAMPTZ,
    submitted_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_assessment_attempt_worker ON assessment_attempt(worker_id, status);

CREATE TABLE assessment_component_attempt (
    assessment_component_attempt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_attempt_id UUID NOT NULL REFERENCES assessment_attempt(assessment_attempt_id) ON DELETE CASCADE,
    assessment_package_component_id UUID NOT NULL REFERENCES assessment_package_component(assessment_package_component_id),
    status          VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','scored')),
    raw_score       NUMERIC(8,2),
    max_possible_score NUMERIC(8,2),
    weighted_pct    NUMERIC(5,2),
    forced_fail     BOOLEAN NOT NULL DEFAULT FALSE,
    evaluator_user_id UUID REFERENCES app_user(user_id),
    scored_at       TIMESTAMPTZ,
    UNIQUE (assessment_attempt_id, assessment_package_component_id)
);

CREATE TABLE assessment_item_response (
    assessment_item_response_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_component_attempt_id UUID NOT NULL REFERENCES assessment_component_attempt(assessment_component_attempt_id) ON DELETE CASCADE,
    assessment_item_id UUID NOT NULL REFERENCES assessment_item(assessment_item_id),
    response_json   JSONB,
    raw_score       NUMERIC(6,2) NOT NULL,
    max_score       NUMERIC(6,2) NOT NULL,
    is_correct      BOOLEAN,
    evaluator_capacity VARCHAR(20) NOT NULL CHECK (evaluator_capacity IN ('SELF','SUPERVISOR_ASSESSOR','TRAINER','SYSTEM')),
    evaluator_user_id UUID REFERENCES app_user(user_id),
    assessor_remark TEXT,
    scored_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (assessment_component_attempt_id, assessment_item_id)
);

CREATE TABLE assessment_evidence (
    assessment_evidence_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_item_response_id UUID NOT NULL REFERENCES assessment_item_response(assessment_item_response_id) ON DELETE CASCADE,
    evidence_file_id UUID NOT NULL REFERENCES evidence_file(evidence_file_id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE self_assessment_review (
    self_assessment_review_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_attempt_id UUID NOT NULL UNIQUE REFERENCES assessment_attempt(assessment_attempt_id),
    reviewed_by_user_id UUID REFERENCES app_user(user_id),
    reviewed_at     TIMESTAMPTZ,
    outcome_note    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
