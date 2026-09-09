-- migration 0008 added qualification-case-model columns to `certificate`
-- (qualification_case_id, certified_process_level_id, etc.) but left the
-- ORIGINAL baseline's assessment_outcome_id and skill_level_id columns as
-- NOT NULL. Those two columns only make sense for a legacy-model
-- certificate (issued off the old assessment_outcome table); a new-model
-- certificate is issued off a qualification_case instead and has no
-- assessment_outcome_id to populate. Without this fix, certificationService's
-- issueCertificate() insert fails outright with a NOT NULL violation.
--
-- Rather than just dropping NOT NULL and leaving the column meaningless, add
-- an explicit CHECK so every row is unambiguously either a legacy-model cert
-- (assessment_outcome_id set, qualification_case_id null) or a new-model cert
-- (the reverse) — never both, never neither. This keeps the "no mutable,
-- untyped compliance records" intent: the shape of a row still says which
-- model produced it.
ALTER TABLE certificate ALTER COLUMN assessment_outcome_id DROP NOT NULL;
ALTER TABLE certificate ALTER COLUMN skill_level_id DROP NOT NULL;

ALTER TABLE certificate ADD CONSTRAINT certificate_legacy_xor_new_model_chk CHECK (
  (assessment_outcome_id IS NOT NULL AND qualification_case_id IS NULL)
  OR
  (assessment_outcome_id IS NULL AND qualification_case_id IS NOT NULL)
);
