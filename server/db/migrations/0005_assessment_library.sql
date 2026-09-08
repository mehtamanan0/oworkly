-- Replaces the old process/level-bound assessment_template with a proper
-- library model: reusable assessment_definition rows (each with typed
-- assessment_item rows — one polymorphic table replacing question_bank /
-- practical_checklist_item / behaviour_criterion), linked to a process_level
-- via assessment_package/assessment_package_component with weight, gate,
-- mandatory, and self-assess configuration. Old assessment_template and its
-- child tables are left in place (not dropped) as historical/legacy data for
-- the original MVP demo.
--
-- Versioning is flattened onto a `version` + `is_active` column pair rather
-- than separate *_version child tables, as a stated scope reduction for this
-- pass — an edit creates a new row and supersedes the old one, which gives
-- real history without doubling the table count.

CREATE TABLE component_type_reference (
    component_type_code VARCHAR(20) PRIMARY KEY,
    label           VARCHAR(100) NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO component_type_reference (component_type_code, label) VALUES
    ('THEORY', 'Theory'), ('PRACTICAL', 'Practical'), ('BEHAVIOURAL', 'Behavioural'),
    ('SELF_ASSESSMENT', 'Self-Assessment'), ('ADD_ON', 'Add-On');

CREATE TABLE assessment_definition (
    assessment_definition_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
    name            VARCHAR(200) NOT NULL,
    description     TEXT,
    component_type  VARCHAR(20) NOT NULL REFERENCES component_type_reference(component_type_code),
    add_on_subtype  VARCHAR(30),
    version         SMALLINT NOT NULL DEFAULT 1,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_addon_subtype CHECK (component_type = 'ADD_ON' OR add_on_subtype IS NULL)
);

CREATE TABLE assessment_item (
    assessment_item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_definition_id UUID NOT NULL REFERENCES assessment_definition(assessment_definition_id) ON DELETE CASCADE,
    item_type       VARCHAR(30) NOT NULL CHECK (item_type IN
        ('MCQ_SINGLE','MCQ_MULTI','TRUE_FALSE','RATING_1_5','CHECKLIST_PASS_FAIL','EVIDENCE_OBSERVATION','FREE_TEXT_REMARK')),
    prompt          TEXT NOT NULL,
    options_json    JSONB,
    correct_answer_json JSONB,
    explanation     TEXT,
    max_score       NUMERIC(6,2) NOT NULL DEFAULT 1,
    rating_scale_max SMALLINT,
    is_mandatory    BOOLEAN NOT NULL DEFAULT TRUE,
    is_critical     BOOLEAN NOT NULL DEFAULT FALSE,
    requires_assessor_remark BOOLEAN NOT NULL DEFAULT FALSE,
    evaluator_capacity VARCHAR(20) NOT NULL DEFAULT 'SUPERVISOR_ASSESSOR'
        CHECK (evaluator_capacity IN ('SELF','SUPERVISOR_ASSESSOR','TRAINER','SYSTEM')),
    sequence_no     SMALLINT NOT NULL,
    source          VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','ai_generated_approved')),
    source_document_ref TEXT,
    review_status   VARCHAR(20) NOT NULL DEFAULT 'approved' CHECK (review_status IN ('pending_review','approved','rejected')),
    version         SMALLINT NOT NULL DEFAULT 1,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_assessment_item_definition ON assessment_item(assessment_definition_id);

CREATE TABLE assessment_package (
    assessment_package_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
    process_level_id UUID NOT NULL REFERENCES process_level(process_level_id) ON DELETE CASCADE,
    version         SMALLINT NOT NULL DEFAULT 1,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    effective_from  DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to    DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (process_level_id, version)
);

CREATE TABLE assessment_package_component (
    assessment_package_component_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_package_id UUID NOT NULL REFERENCES assessment_package(assessment_package_id) ON DELETE CASCADE,
    assessment_definition_id UUID NOT NULL REFERENCES assessment_definition(assessment_definition_id),
    sequence_no     SMALLINT NOT NULL,
    weight_pct      NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (weight_pct >= 0 AND weight_pct <= 100),
    min_gate_pct    NUMERIC(5,2),
    is_mandatory    BOOLEAN NOT NULL DEFAULT TRUE,
    self_assessment_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    evaluator_policy VARCHAR(30),
    UNIQUE (assessment_package_id, assessment_definition_id)
);

-- Which roles may take / evaluate a given package (data-driven, not inferred
-- from component_type alone).
CREATE TABLE assessment_role_scope (
    assessment_package_id UUID NOT NULL REFERENCES assessment_package(assessment_package_id) ON DELETE CASCADE,
    role_id         SMALLINT NOT NULL REFERENCES role(role_id),
    capacity        VARCHAR(20) NOT NULL CHECK (capacity IN ('CAN_TAKE','CAN_EVALUATE')),
    PRIMARY KEY (assessment_package_id, role_id, capacity)
);
