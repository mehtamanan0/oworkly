-- Replaces the hard-coded org_unit.unit_type enum with a company-scoped,
-- ordered org_level_type table. The old `unit_type` column is left in place
-- (deprecated, not dropped) so existing MVP routes that still read it keep
-- working during the transition — see README "known limitations".
--
-- CWE's level types are seeded to exactly match the reviewed Org Hierarchy
-- screenshot: Company > Vertical > Location > Department > Designation.
-- Existing real org_units (the WTG Daman ingestion: one PLANT + two AREA
-- nodes) are backfilled onto the closest-fitting new types (Location,
-- Department) and re-rooted under a new Company/Vertical pair so the tree has
-- one coherent root instead of an orphaned legacy branch. Sunrise Solar
-- Systems is left with zero level types and zero org_units — that IS its
-- "in setup" state, not an oversight.

CREATE TABLE org_level_type (
    org_level_type_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
    code            VARCHAR(30) NOT NULL,
    name            VARCHAR(100) NOT NULL,
    sequence        SMALLINT NOT NULL,
    is_leaf         BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (company_id, code),
    UNIQUE (company_id, sequence)
);

CREATE TABLE org_unit_head_assignment (
    org_unit_id     UUID NOT NULL REFERENCES org_unit(org_unit_id) ON DELETE CASCADE,
    worker_id       UUID REFERENCES worker(worker_id),
    assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    assigned_by_user_id UUID REFERENCES app_user(user_id),
    PRIMARY KEY (org_unit_id)
);

INSERT INTO org_level_type (company_id, code, name, sequence, is_leaf) VALUES
    ('11111111-1111-1111-1111-111111111111', 'COMPANY', 'Company', 1, FALSE),
    ('11111111-1111-1111-1111-111111111111', 'VERTICAL', 'Vertical', 2, FALSE),
    ('11111111-1111-1111-1111-111111111111', 'LOCATION', 'Location', 3, FALSE),
    ('11111111-1111-1111-1111-111111111111', 'DEPARTMENT', 'Department', 4, FALSE),
    ('11111111-1111-1111-1111-111111111111', 'DESIGNATION', 'Designation', 5, TRUE);

ALTER TABLE org_unit ADD COLUMN org_level_type_id UUID REFERENCES org_level_type(org_level_type_id);

UPDATE org_unit SET org_level_type_id = (
    SELECT org_level_type_id FROM org_level_type WHERE company_id = org_unit.company_id AND code = 'LOCATION'
) WHERE unit_type = 'PLANT';

UPDATE org_unit SET org_level_type_id = (
    SELECT org_level_type_id FROM org_level_type WHERE company_id = org_unit.company_id AND code = 'DEPARTMENT'
) WHERE unit_type = 'AREA';

-- Re-root the existing real WTG Daman branch under a proper Company/Vertical
-- pair so the Org Hierarchy tree has one coherent root for CWE.
INSERT INTO org_unit (org_unit_id, parent_org_unit_id, company_id, unit_type, org_level_type_id, code, name)
VALUES (
    'c0000000-0000-0000-0000-000000000001', NULL, '11111111-1111-1111-1111-111111111111', 'PLANT',
    (SELECT org_level_type_id FROM org_level_type WHERE company_id = '11111111-1111-1111-1111-111111111111' AND code = 'COMPANY'),
    'CWE', 'Chennai Wind Energy Co.'
);
INSERT INTO org_unit (org_unit_id, parent_org_unit_id, company_id, unit_type, org_level_type_id, code, name)
VALUES (
    'c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'PLANT',
    (SELECT org_level_type_id FROM org_level_type WHERE company_id = '11111111-1111-1111-1111-111111111111' AND code = 'VERTICAL'),
    'WTG-DAMAN-OPS', 'WTG Daman Operations'
);
UPDATE org_unit SET parent_org_unit_id = 'c0000000-0000-0000-0000-000000000002'
WHERE unit_type = 'PLANT' AND org_unit_id NOT IN ('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002');

ALTER TABLE org_unit ALTER COLUMN org_level_type_id SET NOT NULL;
