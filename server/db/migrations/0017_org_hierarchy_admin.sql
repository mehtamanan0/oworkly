-- M6: Org Hierarchy configuration.
--   * org_unit_head_assignment had PRIMARY KEY (org_unit_id) -- one row per
--     unit, no history; a reassignment overwrote in place. Redesigned as a
--     real history table: surrogate PK, effective_from/effective_to, and a
--     partial unique index enforcing exactly one *current* head per unit
--     (effective_to IS NULL). Existing rows backfill as still-current.
--   * org_unit.unit_type (the deprecated fixed PLANT/PROJECT/DEPARTMENT/
--     FUNCTION/AREA enum, kept only for the legacy /api/v1/org-units router)
--     is made nullable so new v2 node creation never has to fabricate a
--     value for a column the v2 stack doesn't use.
--   * A code is only guaranteed unique among literal siblings today
--     (UNIQUE(parent_org_unit_id, code)) -- and Postgres treats every NULL
--     parent as distinct, so two root nodes could silently share a code.
--     Add a real company+level-type uniqueness constraint.

-- ============================================================================
-- 1. org_unit_head_assignment -> history table.
-- ============================================================================
ALTER TABLE org_unit_head_assignment ADD COLUMN org_unit_head_assignment_id UUID DEFAULT gen_random_uuid();
ALTER TABLE org_unit_head_assignment ADD COLUMN effective_from TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE org_unit_head_assignment ADD COLUMN effective_to TIMESTAMPTZ;
ALTER TABLE org_unit_head_assignment ADD COLUMN ended_by_user_id UUID REFERENCES app_user(user_id);
ALTER TABLE org_unit_head_assignment ADD COLUMN end_reason TEXT;

-- existing single row per unit becomes that unit's current (still-open) entry
UPDATE org_unit_head_assignment SET effective_from = assigned_at;

ALTER TABLE org_unit_head_assignment DROP CONSTRAINT org_unit_head_assignment_pkey;
ALTER TABLE org_unit_head_assignment ALTER COLUMN org_unit_head_assignment_id SET NOT NULL;
ALTER TABLE org_unit_head_assignment ADD PRIMARY KEY (org_unit_head_assignment_id);
-- one current (effective_to IS NULL) head per unit; history rows (effective_to set) are unrestricted
CREATE UNIQUE INDEX ux_org_unit_head_assignment_current ON org_unit_head_assignment(org_unit_id) WHERE effective_to IS NULL;
CREATE INDEX ix_org_unit_head_assignment_unit ON org_unit_head_assignment(org_unit_id, effective_from DESC);

-- ============================================================================
-- 2. Legacy unit_type column: made optional for v2 node creation.
-- ============================================================================
ALTER TABLE org_unit ALTER COLUMN unit_type DROP NOT NULL;

-- ============================================================================
-- 3. Real code uniqueness within a company + level type (in addition to the
--    existing per-parent uniqueness, which stays for the legacy router).
-- ============================================================================
ALTER TABLE org_unit ADD CONSTRAINT ux_org_unit_company_level_code UNIQUE (company_id, org_level_type_id, code);

-- ============================================================================
-- 4. org_level_type gains activate/deactivate + a short purpose description,
--    so a level type in use can be deactivated (blocked if any org_unit still
--    references it) rather than only ever hard-deleted.
-- ============================================================================
ALTER TABLE org_level_type ADD COLUMN description TEXT;
ALTER TABLE org_level_type ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;
