-- M9: configurable self-assessment visibility. Previously checkItem()
-- unconditionally returned correct_answer_json/explanation to whoever called
-- it -- including the worker taking their own self-assessment quiz, with no
-- role or policy gate at all. This table lets each company configure, per
-- scope (a company-wide default, or narrowed to one process / process_level
-- / assessment_template), what a worker/supervisor/trainer/admin may see
-- about a self-assessment result, and when the worker's own result releases.
-- Follows the same company-scope-plus-optional-narrowing convention as
-- process_level_progression_rule (0018): a mandatory company_id, nullable
-- narrowing FKs, is_active + created_at trailing columns.

CREATE TABLE self_assessment_visibility_policy (
    self_assessment_visibility_policy_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id       UUID NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
    process_id       UUID REFERENCES process(process_id) ON DELETE CASCADE,
    process_level_id UUID REFERENCES process_level(process_level_id) ON DELETE CASCADE,
    assessment_template_id UUID REFERENCES assessment_template(assessment_template_id) ON DELETE CASCADE,
    name             VARCHAR(150) NOT NULL,
    answers_visible_to_worker      BOOLEAN NOT NULL DEFAULT FALSE,
    answers_visible_to_supervisor  BOOLEAN NOT NULL DEFAULT TRUE,
    answers_visible_to_trainer     BOOLEAN NOT NULL DEFAULT TRUE,
    answers_visible_to_admin       BOOLEAN NOT NULL DEFAULT TRUE,
    show_correct_answers_to_worker BOOLEAN NOT NULL DEFAULT FALSE,
    show_score_to_worker           BOOLEAN NOT NULL DEFAULT TRUE,
    show_feedback_to_worker        BOOLEAN NOT NULL DEFAULT FALSE,
    release_policy   VARCHAR(30) NOT NULL DEFAULT 'ON_SUBMISSION'
        CHECK (release_policy IN ('ON_SUBMISSION','AFTER_SUPERVISOR_REVIEW','NEVER')),
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- A policy narrows to at most one dimension -- never a combination of
    -- process + level + template at once, which would make "most specific
    -- match" resolution ambiguous.
    CHECK (
        (process_id IS NOT NULL)::int + (process_level_id IS NOT NULL)::int + (assessment_template_id IS NOT NULL)::int <= 1
    )
);

-- One *active* policy per scope level, mirroring the partial-unique-index
-- convention used for org_unit_head_assignment's "current head" (0017).
CREATE UNIQUE INDEX ux_savp_company_default ON self_assessment_visibility_policy(company_id)
    WHERE is_active AND process_id IS NULL AND process_level_id IS NULL AND assessment_template_id IS NULL;
CREATE UNIQUE INDEX ux_savp_process ON self_assessment_visibility_policy(company_id, process_id)
    WHERE is_active AND process_id IS NOT NULL;
CREATE UNIQUE INDEX ux_savp_level ON self_assessment_visibility_policy(company_id, process_level_id)
    WHERE is_active AND process_level_id IS NOT NULL;
CREATE UNIQUE INDEX ux_savp_template ON self_assessment_visibility_policy(company_id, assessment_template_id)
    WHERE is_active AND assessment_template_id IS NOT NULL;

-- Store the computed self-assessment outcome at finalize time so a later
-- "view result" read doesn't need to recompute it, and so the
-- AFTER_SUPERVISOR_REVIEW release policy has something concrete to gate on.
ALTER TABLE self_assessment_review
    ADD COLUMN passed BOOLEAN,
    ADD COLUMN composite_pct NUMERIC(5,2);
