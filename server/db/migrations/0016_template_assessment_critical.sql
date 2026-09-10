-- M4 (assessment authoring): per-link criticality knobs on
-- assessment_template_assessment, so the authoring UI can say "a gate miss on
-- THIS assessment fails the whole qualification" independently of the weighted
-- total.
--
--   auto_fail_on_gate_miss — default TRUE, which is exactly today's behaviour
--     (finalizeAttempt already force-fails on any component gate miss). An
--     admin can now turn it off to make a gate advisory.
--   is_critical — default FALSE. A critical assessment force-fails on a gate
--     miss even when auto_fail_on_gate_miss is off, and is badged as critical
--     in the UI. (Distinct from the per-question question.is_critical, which
--     already force-fails via assessment_attempt_section.forced_fail.)

ALTER TABLE assessment_template_assessment ADD COLUMN auto_fail_on_gate_miss BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE assessment_template_assessment ADD COLUMN is_critical BOOLEAN NOT NULL DEFAULT FALSE;
