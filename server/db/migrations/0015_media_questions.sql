-- ERD ask #5: question types must also cover VIDEO, VOICE/AUDIO and IMAGE
-- capture, backed by real object storage (Cloudflare R2 / any S3-compatible
-- bucket; a `local` driver is used in dev and CI).
--
-- No new media table: evidence_file already carries storage_key / file_type /
-- mime_type / file_size_bytes / sha256_checksum / uploaded_by. This migration
-- only:
--   * extends the question_type CHECK with the three media types;
--   * lets a question_response point directly at one evidence_file (the common
--     single-artifact case; the assessment_evidence join stays for multi-file);
--   * adds evidence_file.company_id for tenant-scoped listing, and a
--     pending/ready lifecycle so a row can be created before its bytes land.

-- ============================================================================
-- 1. Media question types.
-- ============================================================================
ALTER TABLE question DROP CONSTRAINT question_question_type_check;
ALTER TABLE question ADD CONSTRAINT question_question_type_check CHECK (
  question_type::text = ANY (ARRAY[
    'MCQ_SINGLE','MCQ_MULTI','TRUE_FALSE','RATING_1_5',
    'CHECKLIST_PASS_FAIL','EVIDENCE_OBSERVATION','FREE_TEXT_REMARK',
    'VIDEO','AUDIO','IMAGE'
  ]::text[])
);

-- ============================================================================
-- 2. evidence_file: tenant scope + upload lifecycle.
-- ============================================================================
ALTER TABLE evidence_file ADD COLUMN company_id UUID REFERENCES company(company_id) ON DELETE CASCADE;
ALTER TABLE evidence_file ADD COLUMN status VARCHAR(10) NOT NULL DEFAULT 'ready'
  CHECK (status IN ('pending','ready'));
ALTER TABLE evidence_file ADD COLUMN original_filename TEXT;
-- a row is now created at presign time, before its checksum is known
ALTER TABLE evidence_file ALTER COLUMN sha256_checksum DROP NOT NULL;

-- ============================================================================
-- 3. Direct response -> evidence_file link.
-- ============================================================================
ALTER TABLE question_response ADD COLUMN evidence_file_id UUID REFERENCES evidence_file(evidence_file_id);
