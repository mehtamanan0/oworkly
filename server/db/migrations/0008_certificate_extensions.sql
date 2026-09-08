-- Extends certificate with the fields the Certification Issuance / Skill Card
-- screens require (previous/certified process level, primary-level mapping,
-- approver/trainer, framework version, weighted score, signature metadata),
-- links it to the owning qualification_case (UNIQUE -> idempotent issuance:
-- a second issuance attempt for the same case is a no-op, not a duplicate),
-- and adds certificate_policy to drive valid_to instead of hardcoding NULL.
-- certificate_template gains an optional process_id so a process-specific
-- template can be selected with a tenant-wide fallback, instead of "the
-- first row in the table".

ALTER TABLE certificate ADD COLUMN qualification_case_id UUID REFERENCES qualification_case(qualification_case_id);
ALTER TABLE certificate ADD CONSTRAINT uq_certificate_qualification_case UNIQUE (qualification_case_id);
ALTER TABLE certificate ADD COLUMN previous_process_level_id UUID REFERENCES process_level(process_level_id);
ALTER TABLE certificate ADD COLUMN certified_process_level_id UUID REFERENCES process_level(process_level_id);
ALTER TABLE certificate ADD COLUMN primary_level_id UUID REFERENCES primary_level_definition(primary_level_id);
ALTER TABLE certificate ADD COLUMN approver_user_id UUID REFERENCES app_user(user_id);
ALTER TABLE certificate ADD COLUMN trainer_user_id UUID REFERENCES app_user(user_id);
ALTER TABLE certificate ADD COLUMN framework_version VARCHAR(50);
ALTER TABLE certificate ADD COLUMN weighted_score_pct NUMERIC(5,2);
ALTER TABLE certificate ADD COLUMN signature_metadata JSONB;

ALTER TABLE certificate_template ADD COLUMN process_id UUID REFERENCES process(process_id);

CREATE TABLE certificate_policy (
    certificate_policy_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
    certificate_type VARCHAR(30) NOT NULL,
    process_id      UUID REFERENCES process(process_id),
    validity_months SMALLINT NOT NULL DEFAULT 24,
    UNIQUE (company_id, certificate_type, process_id)
);

INSERT INTO certificate_policy (company_id, certificate_type, process_id, validity_months)
VALUES ('11111111-1111-1111-1111-111111111111', 'COMPETENCY_CARD', NULL, 24);
