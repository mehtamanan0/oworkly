-- ERD alignment (Oworkly_LMS_ERD_Review_COMMENT.docx): the assessment model
-- built in migrations 0005-0006 already matches the ERD's structure (a
-- template groups a flexible number of typed assessments, each with its own
-- weight + score condition, assigned to a process level). This migration
-- only renames the tables/columns to the ERD's vocabulary and retires the
-- superseded legacy assessment-authoring tables (whose names it needs to
-- take over). No behaviour change.
--
--   assessment_package             -> assessment_template
--   assessment_package_component   -> assessment_template_assessment   (the link row: weight/gate/critical/mandatory/sequence)
--   assessment_definition          -> assessment
--   assessment_item                -> question
--   assessment_item_response       -> question_response
--   assessment_component_attempt   -> assessment_attempt_section
--   component_type_reference       -> assessment_type_reference
--   assessment_role_scope          -> assessment_template_role_scope

-- ============================================================================
-- 1. Retire the legacy assessment-authoring module (migration 0001 baseline).
--    Fully superseded by the model above; also frees the names
--    `assessment_template` and `assessment_template_role_scope`.
-- ============================================================================
DROP TABLE IF EXISTS assessment_score_component     CASCADE;
DROP TABLE IF EXISTS legacy_assessment_attempt      CASCADE;
DROP TABLE IF EXISTS question_bank                  CASCADE;
DROP TABLE IF EXISTS practical_checklist_item       CASCADE;
DROP TABLE IF EXISTS behaviour_criterion            CASCADE;
DROP TABLE IF EXISTS assessment_weightage_config    CASCADE;
DROP TABLE IF EXISTS assessment_template_role_scope CASCADE;  -- legacy one
DROP TABLE IF EXISTS assessment_template            CASCADE;  -- legacy one

-- ============================================================================
-- 2. Rename tables + their id / FK columns to ERD terms.
--    Postgres preserves PK/FK/index/sequence identity across RENAME, and
--    rewrites CHECK-constraint expressions to follow renamed columns.
-- ============================================================================

-- lookup
ALTER TABLE component_type_reference RENAME TO assessment_type_reference;
ALTER TABLE assessment_type_reference RENAME COLUMN component_type_code TO assessment_type_code;

-- assessment (was assessment_definition)
ALTER TABLE assessment_definition RENAME TO assessment;
ALTER TABLE assessment RENAME COLUMN assessment_definition_id TO assessment_id;
ALTER TABLE assessment RENAME COLUMN component_type          TO assessment_type;

-- question (was assessment_item)
ALTER TABLE assessment_item RENAME TO question;
ALTER TABLE question RENAME COLUMN assessment_item_id       TO question_id;
ALTER TABLE question RENAME COLUMN assessment_definition_id TO assessment_id;
ALTER TABLE question RENAME COLUMN item_type                TO question_type;

-- template (was assessment_package)
ALTER TABLE assessment_package RENAME TO assessment_template;
ALTER TABLE assessment_template RENAME COLUMN assessment_package_id TO assessment_template_id;

-- template <-> assessment link (was assessment_package_component)
ALTER TABLE assessment_package_component RENAME TO assessment_template_assessment;
ALTER TABLE assessment_template_assessment RENAME COLUMN assessment_package_component_id TO assessment_template_assessment_id;
ALTER TABLE assessment_template_assessment RENAME COLUMN assessment_package_id           TO assessment_template_id;
ALTER TABLE assessment_template_assessment RENAME COLUMN assessment_definition_id        TO assessment_id;

-- role scope (was assessment_role_scope)
ALTER TABLE assessment_role_scope RENAME TO assessment_template_role_scope;
ALTER TABLE assessment_template_role_scope RENAME COLUMN assessment_package_id TO assessment_template_id;

-- attempt section (was assessment_component_attempt)
ALTER TABLE assessment_component_attempt RENAME TO assessment_attempt_section;
ALTER TABLE assessment_attempt_section RENAME COLUMN assessment_component_attempt_id TO assessment_attempt_section_id;
ALTER TABLE assessment_attempt_section RENAME COLUMN assessment_package_component_id TO assessment_template_assessment_id;

-- question response (was assessment_item_response)
ALTER TABLE assessment_item_response RENAME TO question_response;
ALTER TABLE question_response RENAME COLUMN assessment_item_response_id     TO question_response_id;
ALTER TABLE question_response RENAME COLUMN assessment_component_attempt_id TO assessment_attempt_section_id;
ALTER TABLE question_response RENAME COLUMN assessment_item_id             TO question_id;

-- trailing FK columns on tables that keep their own names
ALTER TABLE assessment_evidence            RENAME COLUMN assessment_item_response_id     TO question_response_id;
ALTER TABLE assessment_attempt             RENAME COLUMN assessment_package_id           TO assessment_template_id;
ALTER TABLE qualification_case             RENAME COLUMN assessment_package_id           TO assessment_template_id;
ALTER TABLE qualification_component_result RENAME COLUMN assessment_component_attempt_id TO assessment_attempt_section_id;

-- ============================================================================
-- 3. Rename the two constraints later migrations (0015 media types,
--    0016 critical flags) will ALTER by name, so those stay readable.
-- ============================================================================
ALTER TABLE question RENAME CONSTRAINT assessment_item_item_type_check TO question_question_type_check;
