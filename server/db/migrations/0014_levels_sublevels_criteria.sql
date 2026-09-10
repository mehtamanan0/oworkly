-- ERD ask #1 ("Process, Levels, Sub-levels and criteria").
--
-- The process_level path already existed (ordinal + per-level
-- min_qualification_score_pct + budgeted_headcount). This migration makes the
-- two half-built pieces real:
--   * process_sub_level (table existed, never used) gets scoring/gating
--     attributes so a level's sub-levels can actually be weighted, scored and
--     gated;
--   * "criteria" — until now only free text on the level — becomes a first
--     class list, categorised the way the ERD review groups competency
--     (KNOWLEDGE / PRACTICAL / BEHAVIOUR / EXPERIENCE);
--   * per-worker sub-level progress is tracked so sub-level completion can
--     gate a qualification (see qualificationCaseService.finalizeAttempt's new
--     ALL_MANDATORY_SUB_LEVELS_COMPLETE rule check).
-- Light level-to-level progression rules (prerequisite + minimum tenure at the
-- previous level) are added as columns; the full configurable eligibility
-- engine stays out of scope.

-- ============================================================================
-- 1. Named, categorised criteria per process level.
-- ============================================================================
CREATE TABLE process_level_criterion (
    process_level_criterion_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id       UUID NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
    process_level_id UUID NOT NULL REFERENCES process_level(process_level_id) ON DELETE CASCADE,
    category         VARCHAR(20) NOT NULL
        CHECK (category IN ('KNOWLEDGE','PRACTICAL','BEHAVIOUR','EXPERIENCE')),
    text             TEXT NOT NULL,
    sequence         SMALLINT NOT NULL DEFAULT 1,
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_process_level_criterion_level ON process_level_criterion(process_level_id);

-- ============================================================================
-- 2. Light progression rules on the level itself.
-- ============================================================================
ALTER TABLE process_level ADD COLUMN prerequisite_process_level_id UUID REFERENCES process_level(process_level_id);
ALTER TABLE process_level ADD COLUMN min_months_at_prev_level SMALLINT;

-- ============================================================================
-- 3. Sub-level scoring / gating attributes (table already existed from 0004
--    with only code/name/description/sequence/required_criteria).
-- ============================================================================
ALTER TABLE process_sub_level ADD COLUMN company_id UUID REFERENCES company(company_id) ON DELETE CASCADE;
ALTER TABLE process_sub_level ADD COLUMN min_score_pct NUMERIC(5,2);
ALTER TABLE process_sub_level ADD COLUMN weight_pct NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE process_sub_level ADD COLUMN is_mandatory BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE process_sub_level ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- backfill company_id from the parent level for any rows that already exist
UPDATE process_sub_level psl
   SET company_id = pl.company_id
  FROM process_level pl
 WHERE pl.process_level_id = psl.process_level_id
   AND psl.company_id IS NULL;

-- ============================================================================
-- 4. Per-worker sub-level progress.
-- ============================================================================
CREATE TABLE worker_process_sub_level_progress (
    worker_process_sub_level_progress_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id            UUID NOT NULL REFERENCES worker(worker_id) ON DELETE CASCADE,
    process_sub_level_id UUID NOT NULL REFERENCES process_sub_level(process_sub_level_id) ON DELETE CASCADE,
    status              VARCHAR(20) NOT NULL DEFAULT 'not_started'
        CHECK (status IN ('not_started','in_progress','completed')),
    percent_complete    SMALLINT NOT NULL DEFAULT 0
        CHECK (percent_complete BETWEEN 0 AND 100),
    completed_at        TIMESTAMPTZ,
    signed_off_by_user_id UUID REFERENCES app_user(user_id),
    evidence_file_id    UUID REFERENCES evidence_file(evidence_file_id),
    notes               TEXT,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (worker_id, process_sub_level_id)
);
CREATE INDEX ix_wpslp_worker ON worker_process_sub_level_progress(worker_id);
CREATE INDEX ix_wpslp_sub_level ON worker_process_sub_level_progress(process_sub_level_id);
