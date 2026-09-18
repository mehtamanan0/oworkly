-- M7: level-to-level progression rules, generic and data-driven rather than
-- one-off code paths (mirrors the plan's stated intent to express every
-- listed rule type as configuration). Two rule types are actually evaluated
-- by qualificationCaseService.finalizeAttempt (MIN_TENURE_MONTHS,
-- REQUIRED_PRIOR_LEVEL) using data that already exists (worker.date_of_joining,
-- worker_process_enrollment.current_process_level_id); CUSTOM is a documented,
-- always-advisory placeholder for a rule this pass doesn't automate — it is
-- never allowed to be BLOCKING, so a configured-but-unenforced rule can never
-- silently fail to gate anything.
--
-- The pre-existing process_level.prerequisite_process_level_id /
-- min_months_at_prev_level columns (migration 0014) stay as dead, harmless
-- columns -- this table is the real mechanism; duplicating their intent as
-- code-level special cases was avoided on purpose (see plan decision 7).
CREATE TABLE process_level_progression_rule (
    process_level_progression_rule_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id       UUID NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
    process_level_id UUID NOT NULL REFERENCES process_level(process_level_id) ON DELETE CASCADE,
    rule_type        VARCHAR(40) NOT NULL
        CHECK (rule_type IN ('MIN_TENURE_MONTHS','REQUIRED_PRIOR_LEVEL','CUSTOM')),
    label            TEXT NOT NULL,
    params_json      JSONB NOT NULL DEFAULT '{}',
    severity         VARCHAR(10) NOT NULL DEFAULT 'BLOCKING' CHECK (severity IN ('BLOCKING','ADVISORY')),
    sequence         SMALLINT NOT NULL DEFAULT 1,
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- CUSTOM rules are never evaluated -- they may never be marked BLOCKING.
    CHECK (rule_type <> 'CUSTOM' OR severity = 'ADVISORY')
);
CREATE INDEX ix_process_level_progression_rule_level ON process_level_progression_rule(process_level_id);
