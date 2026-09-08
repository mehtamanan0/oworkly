-- Splits the single global L1-L4 skill_level_definition into two concepts:
-- primary_level_definition (company-scoped, cross-process reporting) and
-- process_level (company+process scoped, e.g. E1-E5 / S1-S4 / T1-T3).
--
-- Compatibility: for every (process, level) pair already in use by the real
-- WTG ingestion, a process_level row is generated re-using the old L-code as
-- its code (a process that hasn't defined its own scheme just uses "L2"/"L3"
-- as a process_level code, which is legal — only the new Figma-demo processes
-- get real E/S/T-style codes, seeded separately). worker_process_skill gets a
-- new process_level_id column alongside (not replacing) the old
-- current_skill_level_id column, so existing MVP routes keep working.
--
-- process.required_headcount_l2/l3/l4 are migrated into
-- process_level.budgeted_headcount and then dropped, per spec §10.

CREATE TABLE primary_level_definition (
    primary_level_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
    code            VARCHAR(10) NOT NULL,
    ordinal         SMALLINT NOT NULL,
    label           VARCHAR(100) NOT NULL,
    description     TEXT,
    background_hex  VARCHAR(7),
    accent_hex      VARCHAR(7),
    UNIQUE (company_id, code),
    UNIQUE (company_id, ordinal)
);

CREATE TABLE process_level (
    process_level_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
    process_id      UUID NOT NULL REFERENCES process(process_id) ON DELETE CASCADE,
    code            VARCHAR(10) NOT NULL,
    name            VARCHAR(150) NOT NULL,
    ordinal         SMALLINT NOT NULL,
    description     TEXT,
    primary_level_id UUID REFERENCES primary_level_definition(primary_level_id),
    min_qualification_score_pct NUMERIC(5,2),
    budgeted_headcount SMALLINT,
    self_assessment_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    effective_version SMALLINT NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, process_id, code)
);
CREATE INDEX ix_process_level_process ON process_level(process_id);

CREATE TABLE process_sub_level (
    process_sub_level_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    process_level_id UUID NOT NULL REFERENCES process_level(process_level_id) ON DELETE CASCADE,
    code            VARCHAR(20) NOT NULL,
    name            VARCHAR(200) NOT NULL,
    description     TEXT,
    sequence        SMALLINT NOT NULL,
    required_criteria TEXT,
    completion_status_behavior VARCHAR(20) NOT NULL DEFAULT 'binary'
        CHECK (completion_status_behavior IN ('binary','percentage')),
    requires_training BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (process_level_id, code)
);

INSERT INTO primary_level_definition (company_id, code, ordinal, label, description, background_hex, accent_hex) VALUES
    ('11111111-1111-1111-1111-111111111111', 'L1', 1, 'Foundational', 'Basic awareness; can assist under close supervision', '#F1F5F9', '#64748B'),
    ('11111111-1111-1111-1111-111111111111', 'L2', 2, 'Competent', 'Works independently on standard tasks; knows process requirements', '#DBEAFE', '#2563FF'),
    ('11111111-1111-1111-1111-111111111111', 'L3', 3, 'Advanced', 'Trains juniors, handles deviations, approved for complex tasks', '#DCFCE7', '#16A34A'),
    ('11111111-1111-1111-1111-111111111111', 'L4', 4, 'Expert', 'Subject matter expert; defines SOPs, audits quality, mentors trainers', '#EDE9FE', '#7C3AED');

-- Backfill: one process_level per (process, level) already exercised by the
-- real ingestion, reusing the global L-code since these processes never
-- defined their own scheme. Headcount comes from the MVP-only convenience
-- columns being retired below.
INSERT INTO process_level (company_id, process_id, code, name, ordinal, primary_level_id, budgeted_headcount)
SELECT DISTINCT
    p.company_id, p.process_id, sld.level_code, sld.label, sld.ordinal,
    pld.primary_level_id,
    CASE sld.level_code
        WHEN 'L2' THEN p.required_headcount_l2
        WHEN 'L3' THEN p.required_headcount_l3
        WHEN 'L4' THEN p.required_headcount_l4
        ELSE NULL
    END
FROM competency_framework cf
JOIN process p ON p.process_id = cf.process_id
JOIN skill_level_definition sld ON sld.skill_level_id = cf.skill_level_id
JOIN primary_level_definition pld ON pld.company_id = p.company_id AND pld.code = sld.level_code
ON CONFLICT (company_id, process_id, code) DO NOTHING;

ALTER TABLE worker_process_skill ADD COLUMN process_level_id UUID REFERENCES process_level(process_level_id);
UPDATE worker_process_skill wps
SET process_level_id = pl.process_level_id
FROM process_level pl, skill_level_definition sld
WHERE wps.current_skill_level_id = sld.skill_level_id
  AND pl.process_id = wps.process_id
  AND pl.code = sld.level_code;

ALTER TABLE process DROP COLUMN required_headcount_l2;
ALTER TABLE process DROP COLUMN required_headcount_l3;
ALTER TABLE process DROP COLUMN required_headcount_l4;
