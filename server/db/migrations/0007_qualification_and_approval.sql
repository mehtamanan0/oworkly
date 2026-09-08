-- The qualification_case is the new top-level artifact grouping a worker,
-- process, target level, the package version used, the deterministic result,
-- the approval chain, and (eventually) the certificate — replacing the old
-- MVP's "outcome triggers everything inline" pattern with an explicit,
-- inspectable object that has its own state machine.

CREATE TABLE qualification_case (
    qualification_case_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
    worker_id       UUID NOT NULL REFERENCES worker(worker_id),
    process_id      UUID NOT NULL REFERENCES process(process_id),
    from_process_level_id UUID REFERENCES process_level(process_level_id),
    target_process_level_id UUID NOT NULL REFERENCES process_level(process_level_id),
    assessment_package_id UUID REFERENCES assessment_package(assessment_package_id),
    status          VARCHAR(30) NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
        'DRAFT','NOT_ELIGIBLE','TRAINING_REQUIRED','READY_FOR_ASSESSMENT','ASSESSMENT_IN_PROGRESS',
        'FAILED','RETEST_COOLING','PENDING_APPROVAL','RETURNED_FOR_REVIEW','APPROVED','CERTIFIED',
        'EXPIRED','RENEWAL_IN_PROGRESS','CANCELLED')),
    qualification_number VARCHAR(50) UNIQUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_qualification_case_worker ON qualification_case(worker_id, status);
CREATE INDEX ix_qualification_case_company ON qualification_case(company_id, status);

ALTER TABLE assessment_attempt
    ADD CONSTRAINT fk_attempt_qualification_case FOREIGN KEY (qualification_case_id) REFERENCES qualification_case(qualification_case_id);

CREATE TABLE qualification_result (
    qualification_result_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    qualification_case_id UUID NOT NULL REFERENCES qualification_case(qualification_case_id) ON DELETE CASCADE,
    assessment_attempt_id UUID NOT NULL REFERENCES assessment_attempt(assessment_attempt_id),
    weighted_score_pct NUMERIC(5,2) NOT NULL,
    pass_threshold_pct NUMERIC(5,2) NOT NULL,
    result          VARCHAR(10) NOT NULL CHECK (result IN ('PASS','FAIL')),
    decided_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    decision_engine_version VARCHAR(20) NOT NULL DEFAULT 'rules-v1'
);

CREATE TABLE qualification_component_result (
    qualification_component_result_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    qualification_result_id UUID NOT NULL REFERENCES qualification_result(qualification_result_id) ON DELETE CASCADE,
    assessment_component_attempt_id UUID NOT NULL REFERENCES assessment_component_attempt(assessment_component_attempt_id),
    raw_pct         NUMERIC(5,2) NOT NULL,
    weight_pct      NUMERIC(5,2) NOT NULL,
    weighted_pct    NUMERIC(5,2) NOT NULL,
    gate_pct        NUMERIC(5,2),
    gate_passed     BOOLEAN,
    status          VARCHAR(10) NOT NULL CHECK (status IN ('PASS','FAIL'))
);

CREATE TABLE qualification_rule_check (
    qualification_rule_check_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    qualification_result_id UUID NOT NULL REFERENCES qualification_result(qualification_result_id) ON DELETE CASCADE,
    rule_code       VARCHAR(50) NOT NULL,
    label           TEXT NOT NULL,
    passed          BOOLEAN NOT NULL,
    detail_json     JSONB
);

-- Configurable, ordered approval chains — Supervisor -> HOD -> L&D by default,
-- but company/process-configurable, not code.
CREATE TABLE approval_policy (
    approval_policy_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
    process_id      UUID REFERENCES process(process_id),
    name            VARCHAR(150) NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE approval_policy_stage (
    approval_policy_stage_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    approval_policy_id UUID NOT NULL REFERENCES approval_policy(approval_policy_id) ON DELETE CASCADE,
    sequence_no     SMALLINT NOT NULL,
    role_id         SMALLINT NOT NULL REFERENCES role(role_id),
    stage_label     VARCHAR(100) NOT NULL,
    is_required     BOOLEAN NOT NULL DEFAULT TRUE,
    allow_parallel_with_next BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (approval_policy_id, sequence_no)
);

CREATE TABLE qualification_approval_instance (
    qualification_approval_instance_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    qualification_case_id UUID NOT NULL REFERENCES qualification_case(qualification_case_id) ON DELETE CASCADE,
    approval_policy_id UUID NOT NULL REFERENCES approval_policy(approval_policy_id),
    status          VARCHAR(20) NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','approved','returned')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ
);

CREATE TABLE qualification_approval_action (
    qualification_approval_action_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    qualification_approval_instance_id UUID NOT NULL REFERENCES qualification_approval_instance(qualification_approval_instance_id) ON DELETE CASCADE,
    approval_policy_stage_id UUID NOT NULL REFERENCES approval_policy_stage(approval_policy_stage_id),
    resolved_approver_user_id UUID REFERENCES app_user(user_id),
    action          VARCHAR(20) CHECK (action IN ('approved', 'returned')),
    remarks         TEXT,
    acted_at        TIMESTAMPTZ,
    idempotency_key UUID UNIQUE,
    UNIQUE (qualification_approval_instance_id, approval_policy_stage_id)
);
