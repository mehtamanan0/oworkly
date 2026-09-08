-- Introduces the company (tenant) concept. Every company-owned aggregate that
-- predates this migration gets a company_id column, backfilled to the single
-- "Chennai Wind Energy Co." company that owns all existing data (the real WTG
-- Daman ingestion). Sunrise Solar Systems is added as a second, empty,
-- in-setup company purely to prove tenant isolation.

CREATE TABLE company (
    company_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            VARCHAR(20) NOT NULL UNIQUE,
    name            VARCHAR(200) NOT NULL,
    industry        VARCHAR(100),
    logo_ref        TEXT,
    status          VARCHAR(20) NOT NULL DEFAULT 'IN_SETUP'
        CHECK (status IN ('IN_SETUP','ACTIVE','SUSPENDED','ARCHIVED')),
    deployment_mode VARCHAR(20) NOT NULL DEFAULT 'standalone'
        CHECK (deployment_mode IN ('standalone','saas','on_prem')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    activated_at    TIMESTAMPTZ
);

CREATE TABLE company_user_membership (
    company_id  UUID NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
    is_primary  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (company_id, user_id)
);

INSERT INTO company (company_id, code, name, industry, status, activated_at) VALUES
    ('11111111-1111-1111-1111-111111111111', 'CWE', 'Chennai Wind Energy Co.', 'Wind Energy', 'ACTIVE', now());
INSERT INTO company (company_id, code, name, industry, status) VALUES
    ('22222222-2222-2222-2222-222222222222', 'SSS', 'Sunrise Solar Systems', 'Solar Energy', 'IN_SETUP');

ALTER TABLE org_unit ADD COLUMN company_id UUID REFERENCES company(company_id);
UPDATE org_unit SET company_id = '11111111-1111-1111-1111-111111111111' WHERE company_id IS NULL;
ALTER TABLE org_unit ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX ix_org_unit_company ON org_unit(company_id);

ALTER TABLE process ADD COLUMN company_id UUID REFERENCES company(company_id);
UPDATE process p SET company_id = ou.company_id FROM org_unit ou WHERE ou.org_unit_id = p.org_unit_id;
ALTER TABLE process ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX ix_process_company ON process(company_id);

ALTER TABLE worker ADD COLUMN company_id UUID REFERENCES company(company_id);
UPDATE worker w SET company_id = ou.company_id FROM org_unit ou WHERE ou.org_unit_id = w.org_unit_id;
ALTER TABLE worker ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX ix_worker_company ON worker(company_id);

ALTER TABLE certificate_template ADD COLUMN company_id UUID REFERENCES company(company_id);
UPDATE certificate_template SET company_id = '11111111-1111-1111-1111-111111111111' WHERE company_id IS NULL;
ALTER TABLE certificate_template ALTER COLUMN company_id SET NOT NULL;

-- A user's role is scoped per-company from here on (a user can belong to more
-- than one company with different roles in each).
ALTER TABLE user_role ADD COLUMN company_id UUID REFERENCES company(company_id);
UPDATE user_role SET company_id = '11111111-1111-1111-1111-111111111111' WHERE company_id IS NULL;
ALTER TABLE user_role ALTER COLUMN company_id SET NOT NULL;

INSERT INTO company_user_membership (company_id, user_id, is_primary)
SELECT DISTINCT company_id, user_id, TRUE FROM user_role
ON CONFLICT DO NOTHING;
