-- ============================================================================
-- Oworkly LMS & Assessment Platform — MVP v1 PostgreSQL schema
--
-- Derived directly from `../Architecture Spec - Phase 1/02_Database_Schema.sql`
-- (Modules 1-6 + platform foundation). Adapted for a single-tenant demo:
--
--   - Section A (platform.tenants, schema-per-tenant multi-tenancy) is
--     dropped. Per 01_Architecture_Overview.md §7, a single-tenant / on-prem
--     install "collapses to a single implicit tenant schema" and "typically
--     skips Section A entirely" — this schema IS that collapsed form,
--     applied directly to the default `public` schema.
--   - document_source / document_chunk / pgvector and sync_log are dropped:
--     out of MVP scope (no RAG ingestion, no live HRMS integration — the
--     platform runs in "Standalone" integration mode per §6.1).
--   - evidence_file.captured_geo (POINT) is dropped — a demo-only trim.
--   - process gains required_headcount_l2/l3/l4: the real Phase 2 design
--     (§13, Module 7/8) computes this from a dedicated headcount_requirement
--     table + scheduled engine. For the MVP demo we need *something* to
--     drive the Skill Matrix view against the real ingested Excel data
--     without building Module 8 early, so it's staged directly on `process`
--     instead. Everything else below matches the Phase 1 DDL as reviewed.
--
--   - UPDATE (Self/Supervisor/Trainer assessment model): assessment_template
--     gains assessment_category + is_readiness_check_only; the new
--     assessment_template_role_scope table; practical_checklist_item /
--     behaviour_criterion / assessment_score_component gain
--     evaluator_capacity; learning_activity_catalog gains min_completion_pct,
--     requires_assessment, linked_assessment_template_id; learning_path_activity
--     gains min_completion_pct_override; activity_completion gains
--     completion_pct + linked_assessment_attempt_id. Ported 1:1 from the
--     Architecture Spec revision reflecting the reviewed Assessment Master
--     Architecture diagram.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ----------------------------------------------------------------------------
-- Cross-cutting: identity, audit, evidence storage
-- ----------------------------------------------------------------------------

CREATE TABLE app_user (
    user_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_idp_subject VARCHAR(255),
    email           VARCHAR(255) UNIQUE,
    phone           VARCHAR(20),
    display_name    VARCHAR(200) NOT NULL,
    worker_id       UUID,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE role (
    role_id     SMALLSERIAL PRIMARY KEY,
    role_code   VARCHAR(30) NOT NULL UNIQUE,
    role_name   VARCHAR(100) NOT NULL
);
INSERT INTO role (role_code, role_name) VALUES
    ('ADMIN','Admin'), ('LND_TEAM','L&D Team'), ('MANAGER','Manager'),
    ('TRAINER','Trainer'), ('ASSESSOR','Assessor'), ('EMPLOYEE','Employee/Contractor'),
    ('SUPERVISOR','Supervisor'), ('AUDITOR','Auditor');

CREATE TABLE user_role (
    user_id     UUID NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
    role_id     SMALLINT NOT NULL REFERENCES role(role_id),
    org_unit_id UUID,
    PRIMARY KEY (user_id, role_id, org_unit_id)
);

CREATE TABLE assessor_process_scope (
    user_id     UUID NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
    process_id  UUID NOT NULL,
    PRIMARY KEY (user_id, process_id)
);

CREATE TABLE audit_log (
    audit_id        BIGSERIAL PRIMARY KEY,
    entity_name     VARCHAR(100) NOT NULL,
    entity_id       UUID NOT NULL,
    action          VARCHAR(20) NOT NULL CHECK (action IN ('INSERT','UPDATE','STATUS_CHANGE','DELETE')),
    changed_by      UUID REFERENCES app_user(user_id),
    changed_via     VARCHAR(20) NOT NULL DEFAULT 'web' CHECK (changed_via IN ('web','mobile','api_sync','system')),
    before_json     JSONB,
    after_json      JSONB,
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_audit_log_entity ON audit_log(entity_name, entity_id, changed_at DESC);

CREATE TABLE evidence_file (
    evidence_file_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    storage_key      TEXT NOT NULL,
    file_type        VARCHAR(20) NOT NULL CHECK (file_type IN ('photo','video','document','signature','audio')),
    mime_type        VARCHAR(100),
    file_size_bytes  BIGINT,
    sha256_checksum  CHAR(64) NOT NULL,
    captured_at      TIMESTAMPTZ,
    uploaded_by      UUID REFERENCES app_user(user_id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- MODULE 1 — Setup & Master Data
-- ----------------------------------------------------------------------------

CREATE TABLE org_unit (
    org_unit_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_org_unit_id UUID REFERENCES org_unit(org_unit_id),
    unit_type       VARCHAR(20) NOT NULL CHECK (unit_type IN ('PLANT','PROJECT','DEPARTMENT','FUNCTION','AREA')),
    code            VARCHAR(30) NOT NULL,
    name            VARCHAR(200) NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (parent_org_unit_id, code)
);
CREATE INDEX ix_org_unit_parent ON org_unit(parent_org_unit_id);

CREATE TABLE job_role (
    job_role_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            VARCHAR(30) NOT NULL UNIQUE,
    name            VARCHAR(200) NOT NULL,
    description     TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE process (
    process_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_unit_id     UUID NOT NULL REFERENCES org_unit(org_unit_id),
    parent_process_id UUID REFERENCES process(process_id),
    code            VARCHAR(30) NOT NULL,
    name            VARCHAR(200) NOT NULL,
    is_critical     BOOLEAN NOT NULL DEFAULT FALSE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    -- MVP-only staging columns, see header note re: Phase 2 Module 7/8
    required_headcount_l2 SMALLINT,
    required_headcount_l3 SMALLINT,
    required_headcount_l4 SMALLINT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_unit_id, code)
);
CREATE INDEX ix_process_org_unit ON process(org_unit_id);
CREATE INDEX ix_process_parent ON process(parent_process_id);

CREATE TABLE job_role_process (
    job_role_id     UUID NOT NULL REFERENCES job_role(job_role_id) ON DELETE CASCADE,
    process_id      UUID NOT NULL REFERENCES process(process_id) ON DELETE CASCADE,
    PRIMARY KEY (job_role_id, process_id)
);

CREATE TABLE skill_level_definition (
    skill_level_id  SMALLSERIAL PRIMARY KEY,
    level_code      VARCHAR(10) NOT NULL UNIQUE,
    ordinal         SMALLINT NOT NULL UNIQUE,
    label           VARCHAR(100) NOT NULL,
    color_hex       VARCHAR(7),
    description     TEXT
);
INSERT INTO skill_level_definition (level_code, ordinal, label, color_hex) VALUES
    ('L1', 1, 'New Joiner',        '#E53935'),
    ('L2', 2, 'Operator',          '#1A237E'),
    ('L3', 3, 'Advanced Operator', '#2E7D32'),
    ('L4', 4, 'Expert / Trainer',  '#1565C0');

CREATE TABLE competency_framework (
    competency_framework_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    process_id      UUID NOT NULL REFERENCES process(process_id) ON DELETE CASCADE,
    skill_level_id  SMALLINT NOT NULL REFERENCES skill_level_definition(skill_level_id),
    knowledge_criteria TEXT,
    practical_criteria TEXT,
    behaviour_criteria TEXT,
    experience_criteria TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (process_id, skill_level_id)
);

CREATE TABLE contractor_company (
    contractor_company_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(200) NOT NULL,
    vendor_code     VARCHAR(50) UNIQUE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE worker (
    worker_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hrms_employee_code  VARCHAR(50) UNIQUE,
    employment_type     VARCHAR(20) NOT NULL DEFAULT 'permanent'
        CHECK (employment_type IN ('permanent','contract')),
    contractor_company_id UUID REFERENCES contractor_company(contractor_company_id),
    first_name          VARCHAR(100) NOT NULL,
    last_name            VARCHAR(100),
    photo_evidence_file_id UUID REFERENCES evidence_file(evidence_file_id),
    org_unit_id          UUID NOT NULL REFERENCES org_unit(org_unit_id),
    primary_job_role_id  UUID REFERENCES job_role(job_role_id),
    reporting_manager_worker_id UUID REFERENCES worker(worker_id),
    status               VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active','inactive','on_leave','exited')),
    medical_compliance_status VARCHAR(20) DEFAULT 'unknown'
        CHECK (medical_compliance_status IN ('fit','unfit','pending','unknown')),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_worker_org_unit ON worker(org_unit_id);
CREATE INDEX ix_worker_hrms_code ON worker(hrms_employee_code);

ALTER TABLE app_user ADD CONSTRAINT fk_app_user_worker FOREIGN KEY (worker_id) REFERENCES worker(worker_id);
ALTER TABLE user_role ADD CONSTRAINT fk_user_role_org_unit FOREIGN KEY (org_unit_id) REFERENCES org_unit(org_unit_id);
ALTER TABLE assessor_process_scope ADD CONSTRAINT fk_scope_process FOREIGN KEY (process_id) REFERENCES process(process_id) ON DELETE CASCADE;

CREATE TABLE worker_process_skill (
    worker_id       UUID NOT NULL REFERENCES worker(worker_id) ON DELETE CASCADE,
    process_id      UUID NOT NULL REFERENCES process(process_id) ON DELETE CASCADE,
    current_skill_level_id SMALLINT REFERENCES skill_level_definition(skill_level_id),
    attained_at     TIMESTAMPTZ,
    source_outcome_id UUID,
    PRIMARY KEY (worker_id, process_id)
);
CREATE INDEX ix_wps_process_level ON worker_process_skill(process_id, current_skill_level_id);

-- ----------------------------------------------------------------------------
-- MODULE 2 — Competency Journey & Learning Paths
-- ----------------------------------------------------------------------------

CREATE TABLE learning_activity_catalog (
    learning_activity_catalog_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    process_id      UUID NOT NULL REFERENCES process(process_id) ON DELETE CASCADE,
    skill_level_id  SMALLINT NOT NULL REFERENCES skill_level_definition(skill_level_id),
    activity_type   VARCHAR(30) NOT NULL CHECK (activity_type IN (
        'SOP_READING','CLASSROOM_TRAINING','ONLINE_ELEARNING','OJT',
        'BUDDY_MENTOR_SHADOWING','PRACTICAL_DEMONSTRATION','WORKSHOP_HANDS_ON',
        'TOOLBOX_TALK','COACHING_GUIDANCE','SELF_LEARNING_VIDEO')),
    title           VARCHAR(300) NOT NULL,
    description     TEXT,
    content_ref     TEXT,
    evidence_type_required VARCHAR(20) NOT NULL DEFAULT 'digital_signoff'
        CHECK (evidence_type_required IN ('photo','video','digital_signoff','document','none')),
    is_mandatory_default BOOLEAN NOT NULL DEFAULT TRUE,
    min_completion_pct NUMERIC(5,2) NOT NULL DEFAULT 100.00
        CHECK (min_completion_pct > 0 AND min_completion_pct <= 100),  -- e.g. an OJT activity scored/tracked as a % (hours logged, repetitions done) rather than a binary tick
    requires_assessment BOOLEAN NOT NULL DEFAULT FALSE,   -- this activity's completion is itself verified via a scored mini-assessment (e.g. a Trainer-evaluated Practical Demonstration), not just an evidence sign-off
    linked_assessment_template_id UUID,    -- FK added below once assessment_template exists; required when requires_assessment = TRUE
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_requires_assessment_has_template CHECK (NOT requires_assessment OR linked_assessment_template_id IS NOT NULL)
);
CREATE INDEX ix_activity_catalog_process_level ON learning_activity_catalog(process_id, skill_level_id);

CREATE TABLE learning_path (
    learning_path_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id       UUID NOT NULL REFERENCES worker(worker_id) ON DELETE CASCADE,
    process_id      UUID NOT NULL REFERENCES process(process_id),
    from_skill_level_id SMALLINT REFERENCES skill_level_definition(skill_level_id),
    target_skill_level_id SMALLINT NOT NULL REFERENCES skill_level_definition(skill_level_id),
    generation_source VARCHAR(20) NOT NULL DEFAULT 'manual'
        CHECK (generation_source IN ('manual','auto_progression','gap_remediation','ai_suggested')),
    status          VARCHAR(20) NOT NULL DEFAULT 'in_progress'
        CHECK (status IN ('in_progress','eligible_for_assessment','completed','abandoned')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_learning_path_worker ON learning_path(worker_id, status);

CREATE TABLE learning_path_activity (
    learning_path_activity_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    learning_path_id UUID NOT NULL REFERENCES learning_path(learning_path_id) ON DELETE CASCADE,
    learning_activity_catalog_id UUID NOT NULL REFERENCES learning_activity_catalog(learning_activity_catalog_id),
    sequence_no     SMALLINT NOT NULL,
    is_mandatory    BOOLEAN NOT NULL DEFAULT TRUE,
    min_completion_pct_override NUMERIC(5,2)
        CHECK (min_completion_pct_override IS NULL OR (min_completion_pct_override > 0 AND min_completion_pct_override <= 100)),  -- NULL = inherit learning_activity_catalog.min_completion_pct
    added_reason    VARCHAR(20) NOT NULL DEFAULT 'framework'
        CHECK (added_reason IN ('framework','gap_remediation','ai_suggested')),
    UNIQUE (learning_path_id, learning_activity_catalog_id)
);

CREATE TABLE activity_completion (
    activity_completion_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    learning_path_activity_id UUID NOT NULL REFERENCES learning_path_activity(learning_path_activity_id) ON DELETE CASCADE,
    completed_by_worker_id UUID NOT NULL REFERENCES worker(worker_id),
    signed_off_by_user_id UUID REFERENCES app_user(user_id),
    completion_pct  NUMERIC(5,2) NOT NULL DEFAULT 100.00
        CHECK (completion_pct > 0 AND completion_pct <= 100),  -- compared against the activity's min_completion_pct (or override) to decide if this activity now counts as satisfied
    linked_assessment_attempt_id UUID,     -- FK added below once assessment_attempt exists; set when this activity's completion was verified via its linked_assessment_template_id mini-assessment rather than a plain sign-off
    evidence_file_id UUID REFERENCES evidence_file(evidence_file_id),
    completion_notes TEXT,
    completed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_activity_completion_path_activity ON activity_completion(learning_path_activity_id);

-- ----------------------------------------------------------------------------
-- MODULE 3 — Assessment Master Engine
-- ----------------------------------------------------------------------------

CREATE TABLE assessment_weightage_config (
    assessment_weightage_config_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    process_id      UUID NOT NULL REFERENCES process(process_id) ON DELETE CASCADE,
    skill_level_id  SMALLINT NOT NULL REFERENCES skill_level_definition(skill_level_id),
    theory_weight_pct     NUMERIC(5,2) NOT NULL DEFAULT 20.00,
    practical_weight_pct  NUMERIC(5,2) NOT NULL DEFAULT 70.00,
    behaviour_weight_pct  NUMERIC(5,2) NOT NULL DEFAULT 10.00,
    passing_score_pct     NUMERIC(5,2) NOT NULL DEFAULT 70.00,
    UNIQUE (process_id, skill_level_id),
    CONSTRAINT ck_weights_sum_100 CHECK (theory_weight_pct + practical_weight_pct + behaviour_weight_pct = 100.00)
);

CREATE TABLE assessment_template (
    assessment_template_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    process_id      UUID NOT NULL REFERENCES process(process_id) ON DELETE CASCADE,
    skill_level_id  SMALLINT NOT NULL REFERENCES skill_level_definition(skill_level_id),
    name            VARCHAR(200) NOT NULL,
    -- Which "type" of assessment this is (Self / Supervisor / Trainer): who is expected to TAKE
    -- it and, by default, evaluate it. SELF = worker self-rates against criteria, auto-scored,
    -- used as a readiness check ahead of the gating assessment rather than a certifying event on
    -- its own. SUPERVISOR = the formal Supervisor/Assessor-scored assessment that can issue a
    -- certificate. TRAINER = classroom/theory/skill-demonstration assessment, typically for
    -- L3/L4 "Trainer track" workers (feeds Module 6 TTT).
    assessment_category VARCHAR(20) NOT NULL DEFAULT 'SUPERVISOR'
        CHECK (assessment_category IN ('SELF','SUPERVISOR','TRAINER')),
    is_readiness_check_only BOOLEAN NOT NULL DEFAULT FALSE,   -- TRUE only ever valid alongside assessment_category='SELF': a passing result here does NOT itself trigger certification (Module 4)
    theory_question_count SMALLINT NOT NULL DEFAULT 10,
    version         SMALLINT NOT NULL DEFAULT 1,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (process_id, skill_level_id, assessment_category, version),
    CONSTRAINT ck_readiness_check_is_self CHECK (NOT is_readiness_check_only OR assessment_category = 'SELF')
);

-- Which roles may take (CAN_TAKE) and which may evaluate (CAN_EVALUATE) a given assessment
-- template, kept data-driven rather than inferred from assessment_category so a tenant can, e.g.,
-- let a Manager evaluate a Trainer-track assessment without a schema change.
CREATE TABLE assessment_template_role_scope (
    assessment_template_id UUID NOT NULL REFERENCES assessment_template(assessment_template_id) ON DELETE CASCADE,
    role_id         SMALLINT NOT NULL REFERENCES role(role_id),
    capacity        VARCHAR(20) NOT NULL CHECK (capacity IN ('CAN_TAKE','CAN_EVALUATE')),
    PRIMARY KEY (assessment_template_id, role_id, capacity)
);

ALTER TABLE learning_activity_catalog ADD CONSTRAINT fk_activity_linked_template FOREIGN KEY (linked_assessment_template_id) REFERENCES assessment_template(assessment_template_id);

CREATE TABLE question_bank (
    question_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_template_id UUID NOT NULL REFERENCES assessment_template(assessment_template_id) ON DELETE CASCADE,
    question_text   TEXT NOT NULL,
    question_type   VARCHAR(20) NOT NULL DEFAULT 'MCQ_SINGLE' CHECK (question_type IN ('MCQ_SINGLE','MCQ_MULTI','TRUE_FALSE')),
    options_json    JSONB NOT NULL,
    correct_answer_json JSONB NOT NULL,
    difficulty      VARCHAR(10) NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy','medium','hard')),
    tags            TEXT[],
    source           VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','ai_generated_approved')),
    source_document_ref TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX ix_question_bank_template ON question_bank(assessment_template_id);
CREATE INDEX ix_question_bank_tags ON question_bank USING GIN(tags);

CREATE TABLE practical_checklist_item (
    checklist_item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_template_id UUID NOT NULL REFERENCES assessment_template(assessment_template_id) ON DELETE CASCADE,
    category        VARCHAR(20) NOT NULL CHECK (category IN ('safety','quality','productivity','standard_work','observation')),
    criterion_text  TEXT NOT NULL,
    max_score       NUMERIC(5,2) NOT NULL DEFAULT 5.00,
    is_critical     BOOLEAN NOT NULL DEFAULT FALSE,
    evaluator_capacity VARCHAR(20) NOT NULL DEFAULT 'SUPERVISOR_ASSESSOR'
        CHECK (evaluator_capacity IN ('SELF','SUPERVISOR_ASSESSOR','TRAINER')),   -- which evaluator type this individual criterion is scored by — a template can mix Self- and Supervisor-scored rows (e.g. "Process Knowledge" = Self, "Work Quality" = Supervisor)
    sequence_no     SMALLINT NOT NULL,
    source          VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','ai_generated_approved')),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE behaviour_criterion (
    behaviour_criterion_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_template_id UUID NOT NULL REFERENCES assessment_template(assessment_template_id) ON DELETE CASCADE,
    criterion_code  VARCHAR(30) NOT NULL,
    criterion_label VARCHAR(100) NOT NULL,
    max_score       NUMERIC(5,2) NOT NULL DEFAULT 5.00,
    evaluator_capacity VARCHAR(20) NOT NULL DEFAULT 'SUPERVISOR_ASSESSOR'
        CHECK (evaluator_capacity IN ('SELF','SUPERVISOR_ASSESSOR','TRAINER')),
    sequence_no     SMALLINT NOT NULL
);

CREATE TABLE assessment_attempt (
    assessment_attempt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id       UUID NOT NULL REFERENCES worker(worker_id),
    assessment_template_id UUID NOT NULL REFERENCES assessment_template(assessment_template_id),
    learning_path_id UUID REFERENCES learning_path(learning_path_id),
    retest_cycle_id UUID,
    attempt_no      SMALLINT NOT NULL DEFAULT 1,
    assessor_user_id UUID REFERENCES app_user(user_id),
    scheduled_at    TIMESTAMPTZ,
    started_at      TIMESTAMPTZ,
    submitted_at    TIMESTAMPTZ,
    status          VARCHAR(20) NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled','in_progress','submitted','scored','cancelled')),
    client_idempotency_key UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (client_idempotency_key)
);
CREATE INDEX ix_attempt_worker ON assessment_attempt(worker_id, status);

CREATE TABLE assessment_score_component (
    assessment_score_component_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_attempt_id UUID NOT NULL REFERENCES assessment_attempt(assessment_attempt_id) ON DELETE CASCADE,
    component_type  VARCHAR(20) NOT NULL CHECK (component_type IN ('theory','practical','behaviour')),
    raw_score       NUMERIC(6,2) NOT NULL,
    max_possible_score NUMERIC(6,2) NOT NULL,
    weighted_pct    NUMERIC(5,2) NOT NULL,
    detail_json     JSONB,
    evaluator_capacity VARCHAR(20) NOT NULL DEFAULT 'SYSTEM'
        CHECK (evaluator_capacity IN ('SELF','SUPERVISOR_ASSESSOR','TRAINER','SYSTEM')),  -- snapshot of who actually scored this component (SYSTEM = auto-evaluated theory)
    scored_by_user_id UUID REFERENCES app_user(user_id),
    scored_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (assessment_attempt_id, component_type)
);

-- ----------------------------------------------------------------------------
-- MODULE 4 — Assessment Outcome & Certification
-- ----------------------------------------------------------------------------

CREATE TABLE assessment_outcome (
    assessment_outcome_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_attempt_id UUID NOT NULL UNIQUE REFERENCES assessment_attempt(assessment_attempt_id),
    worker_id       UUID NOT NULL REFERENCES worker(worker_id),
    process_id      UUID NOT NULL REFERENCES process(process_id),
    skill_level_id  SMALLINT NOT NULL REFERENCES skill_level_definition(skill_level_id),
    composite_score_pct NUMERIC(5,2) NOT NULL,
    passing_score_pct_snapshot NUMERIC(5,2) NOT NULL,
    result          VARCHAR(10) NOT NULL CHECK (result IN ('PASS','FAIL')),
    decided_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    decision_engine_version VARCHAR(20) NOT NULL DEFAULT 'rules-v1'
);
CREATE INDEX ix_outcome_worker_process ON assessment_outcome(worker_id, process_id, decided_at DESC);

ALTER TABLE worker_process_skill ADD CONSTRAINT fk_wps_outcome FOREIGN KEY (source_outcome_id) REFERENCES assessment_outcome(assessment_outcome_id);

CREATE TABLE certificate_template (
    certificate_template_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    certificate_type VARCHAR(30) NOT NULL CHECK (certificate_type IN ('COMPETENCY_CARD','PROCESS_AUTHORIZATION','TEMP_DEPLOYMENT_CARD')),
    layout_json     JSONB NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE certificate (
    certificate_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_outcome_id UUID NOT NULL REFERENCES assessment_outcome(assessment_outcome_id),
    worker_id       UUID NOT NULL REFERENCES worker(worker_id),
    process_id      UUID NOT NULL REFERENCES process(process_id),
    skill_level_id  SMALLINT NOT NULL REFERENCES skill_level_definition(skill_level_id),
    certificate_template_id UUID NOT NULL REFERENCES certificate_template(certificate_template_id),
    certificate_type VARCHAR(30) NOT NULL,
    certificate_number VARCHAR(50) NOT NULL UNIQUE,
    qr_verification_token VARCHAR(64) NOT NULL UNIQUE,
    issued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_from      DATE NOT NULL,
    valid_to        DATE,
    status          VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','revoked')),
    revoked_reason  TEXT,
    rendered_pdf_evidence_file_id UUID REFERENCES evidence_file(evidence_file_id)
);
CREATE INDEX ix_certificate_worker ON certificate(worker_id, status);
CREATE INDEX ix_certificate_qr_token ON certificate(qr_verification_token);

-- ----------------------------------------------------------------------------
-- MODULE 5 — Retest & Cooling Period Management
-- ----------------------------------------------------------------------------

CREATE TABLE retest_policy (
    retest_policy_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    process_id      UUID NOT NULL REFERENCES process(process_id) ON DELETE CASCADE,
    skill_level_id  SMALLINT NOT NULL REFERENCES skill_level_definition(skill_level_id),
    cooling_period_days SMALLINT NOT NULL DEFAULT 7,
    max_attempts    SMALLINT NOT NULL DEFAULT 3,
    escalation_role_code VARCHAR(30) NOT NULL DEFAULT 'SUPERVISOR',
    UNIQUE (process_id, skill_level_id)
);

CREATE TABLE retest_cycle (
    retest_cycle_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id       UUID NOT NULL REFERENCES worker(worker_id),
    process_id      UUID NOT NULL REFERENCES process(process_id),
    failed_outcome_id UUID NOT NULL REFERENCES assessment_outcome(assessment_outcome_id),
    retest_policy_id UUID NOT NULL REFERENCES retest_policy(retest_policy_id),
    attempt_no      SMALLINT NOT NULL,
    eligible_from_date DATE NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'cooling_period'
        CHECK (status IN ('cooling_period','eligible','attempt_scheduled','resolved_pass','resolved_escalated')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_retest_cycle_worker ON retest_cycle(worker_id, status);
CREATE INDEX ix_retest_eligible_from ON retest_cycle(eligible_from_date) WHERE status = 'cooling_period';

ALTER TABLE assessment_attempt ADD CONSTRAINT fk_attempt_retest_cycle FOREIGN KEY (retest_cycle_id) REFERENCES retest_cycle(retest_cycle_id);
ALTER TABLE activity_completion ADD CONSTRAINT fk_completion_assessment_attempt FOREIGN KEY (linked_assessment_attempt_id) REFERENCES assessment_attempt(assessment_attempt_id);

CREATE TABLE escalation_event (
    escalation_event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    retest_cycle_id UUID NOT NULL REFERENCES retest_cycle(retest_cycle_id),
    raised_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    raised_to_user_id UUID REFERENCES app_user(user_id),
    reason          TEXT NOT NULL DEFAULT 'max_attempts_exhausted',
    resolution      VARCHAR(30) CHECK (resolution IN ('extended_coaching','role_reassigned','terminated_track','other')),
    resolution_notes TEXT,
    resolved_at     TIMESTAMPTZ,
    resolved_by_user_id UUID REFERENCES app_user(user_id)
);

-- ----------------------------------------------------------------------------
-- MODULE 6 — Gap Analysis & Recommended Learning
-- ----------------------------------------------------------------------------

CREATE TABLE skill_gap (
    skill_gap_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_outcome_id UUID NOT NULL REFERENCES assessment_outcome(assessment_outcome_id) ON DELETE CASCADE,
    worker_id       UUID NOT NULL REFERENCES worker(worker_id),
    gap_type        VARCHAR(20) NOT NULL CHECK (gap_type IN ('practical','theory','behaviour')),
    gap_tag         VARCHAR(100),
    magnitude_pct   NUMERIC(5,2) NOT NULL,
    identified_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    status          VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','remediated','superseded'))
);
CREATE INDEX ix_skill_gap_worker ON skill_gap(worker_id, status);
CREATE INDEX ix_skill_gap_process_rollup ON skill_gap(gap_type, gap_tag);

CREATE TABLE gap_remediation_rule (
    gap_remediation_rule_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gap_type        VARCHAR(20) NOT NULL CHECK (gap_type IN ('practical','theory','behaviour')),
    gap_tag_pattern VARCHAR(100),
    learning_activity_catalog_id UUID NOT NULL REFERENCES learning_activity_catalog(learning_activity_catalog_id),
    priority        SMALLINT NOT NULL DEFAULT 1,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE recommended_activity (
    recommended_activity_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    skill_gap_id    UUID NOT NULL REFERENCES skill_gap(skill_gap_id) ON DELETE CASCADE,
    learning_path_activity_id UUID REFERENCES learning_path_activity(learning_path_activity_id),
    source          VARCHAR(20) NOT NULL DEFAULT 'rule' CHECK (source IN ('rule','ai_suggested')),
    ai_confidence   NUMERIC(4,3),
    approved_by_user_id UUID REFERENCES app_user(user_id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- Convenience view: current effective competency framework per process/level
-- ============================================================================

CREATE VIEW v_process_level_requirements AS
SELECT
    p.process_id, p.name AS process_name, p.org_unit_id, p.is_critical,
    sld.skill_level_id, sld.level_code,
    cf.competency_framework_id,
    awc.theory_weight_pct, awc.practical_weight_pct, awc.behaviour_weight_pct, awc.passing_score_pct,
    rp.cooling_period_days, rp.max_attempts
FROM process p
JOIN competency_framework cf ON cf.process_id = p.process_id
JOIN skill_level_definition sld ON sld.skill_level_id = cf.skill_level_id
LEFT JOIN assessment_weightage_config awc ON awc.process_id = p.process_id AND awc.skill_level_id = sld.skill_level_id
LEFT JOIN retest_policy rp ON rp.process_id = p.process_id AND rp.skill_level_id = sld.skill_level_id
WHERE cf.is_active AND p.is_active;
