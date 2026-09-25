-- M11: a genuine permission layer on top of the existing role-code checks.
-- requireRole("ADMIN","LND_TEAM") etc. are kept exactly as they are
-- everywhere they're already used -- this adds a second, additive
-- dimension (requirePermission(...)) that new and existing routes can layer
-- on top, without removing any existing role-based gate.

CREATE TABLE permission (
    permission_id SMALLSERIAL PRIMARY KEY,
    code          VARCHAR(60) NOT NULL UNIQUE,
    description   TEXT NOT NULL
);

CREATE TABLE role_permission (
    role_id       SMALLINT NOT NULL REFERENCES role(role_id) ON DELETE CASCADE,
    permission_id SMALLINT NOT NULL REFERENCES permission(permission_id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- HOD was previously only ever created at runtime by the demo seed script
-- (ingestion/seed_figma_demo.mjs, used by the approval-policy workflow) --
-- role definitions belong in a migration like the other 8 seeded in
-- 0001_baseline.sql, so it's added here properly. Idempotent against the
-- seed script's own ON CONFLICT DO NOTHING insert of the same row.
INSERT INTO role (role_code, role_name) VALUES ('HOD', 'Head of Department') ON CONFLICT (role_code) DO NOTHING;

INSERT INTO permission (code, description) VALUES
    ('session.read', 'View your own current session'),
    ('company.read', 'View company details'),
    ('company.create', 'Create a new company (tenant)'),
    ('company.update', 'Edit company details'),
    ('company.activate', 'Activate a company'),
    ('company.deactivate', 'Deactivate/suspend a company'),
    ('user.read', 'View user accounts'),
    ('user.create', 'Create a user account'),
    ('user.update', 'Edit a user account'),
    ('user.deactivate', 'Deactivate a user account'),
    ('user.reactivate', 'Reactivate a user account'),
    ('role.read', 'View roles and permissions'),
    ('role.create', 'Create a role'),
    ('role.update', 'Edit a role''s permissions'),
    ('role.assign', 'Assign a role to a user'),
    ('organisation.read', 'View organisation hierarchy'),
    ('organisation.create', 'Create an organisation node'),
    ('organisation.update', 'Edit an organisation node'),
    ('organisation.archive', 'Archive an organisation node'),
    ('organisation.assign_head', 'Assign a head to an organisation node'),
    ('worker.read', 'View worker records'),
    ('worker.create', 'Create a worker record'),
    ('worker.update', 'Edit a worker record'),
    ('worker.deactivate', 'Deactivate a worker record'),
    ('worker.import', 'Import worker master data'),
    ('salary.read', 'View salary data'),
    ('process.read', 'View processes'),
    ('process.create', 'Create a process'),
    ('process.update', 'Edit a process'),
    ('process.archive', 'Archive a process'),
    ('process_level.read', 'View process levels'),
    ('process_level.create', 'Create a process level'),
    ('process_level.update', 'Edit a process level'),
    ('process_level.archive', 'Archive a process level'),
    ('assessment.read', 'View assessment templates and questions'),
    ('assessment.create', 'Create assessment templates and questions'),
    ('assessment.update', 'Edit assessment templates and questions'),
    ('assessment.archive', 'Archive assessment templates and questions'),
    ('assessment.attempt', 'Take an assessment attempt'),
    ('assessment.evaluate', 'Score/evaluate an assessment attempt'),
    ('qualification.read', 'View qualification cases'),
    ('qualification.submit', 'Submit a qualification case for approval'),
    ('qualification.approve', 'Approve a qualification case'),
    ('qualification.return', 'Return a qualification case for review'),
    ('certificate.read', 'View certificates'),
    ('certificate.issue', 'Issue a certificate'),
    ('certificate.revoke', 'Revoke a certificate'),
    ('skill_matrix.read', 'View the skill matrix'),
    ('report.read', 'View reports'),
    ('import.read', 'View master-data import batches'),
    ('import.create', 'Upload a master-data import'),
    ('import.validate', 'Validate a master-data import'),
    ('import.publish', 'Publish a master-data import'),
    ('audit.read', 'View audit history')
ON CONFLICT (code) DO NOTHING;

-- ADMIN: full permission set. This role_code covers BOTH Platform Admin and
-- Company Admin from the brief -- the distinction is companyId IS NULL vs
-- set, already enforced by requirePlatformAdmin/requireRole at the route
-- layer, not by this coarse permission grant.
INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM role r CROSS JOIN permission p WHERE r.role_code = 'ADMIN'
ON CONFLICT DO NOTHING;

-- LND_TEAM (L&D Admin): everything ADMIN has within its own company, except
-- platform/company lifecycle (create/activate/deactivate a company) and
-- role definition changes (role.create/role.update stay ADMIN-only).
INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM role r JOIN permission p ON p.code = ANY(ARRAY[
    'session.read','company.read','company.update',
    'user.read','user.create','user.update','user.deactivate','user.reactivate','role.read','role.assign',
    'organisation.read','organisation.create','organisation.update','organisation.archive','organisation.assign_head',
    'worker.read','worker.create','worker.update','worker.deactivate','worker.import',
    'process.read','process.create','process.update','process.archive',
    'process_level.read','process_level.create','process_level.update','process_level.archive',
    'assessment.read','assessment.create','assessment.update','assessment.archive','assessment.evaluate',
    'qualification.read','qualification.approve','qualification.return',
    'certificate.read','certificate.issue','certificate.revoke',
    'skill_matrix.read','report.read',
    'import.read','import.create','import.validate','import.publish',
    'audit.read'
]::varchar[]) WHERE r.role_code = 'LND_TEAM' ON CONFLICT DO NOTHING;

-- TRAINER / ASSESSOR: scoped read + assigned evaluation capacity.
INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM role r JOIN permission p ON p.code = ANY(ARRAY[
    'session.read','organisation.read','worker.read','worker.update',
    'process.read','process_level.read','assessment.read','assessment.evaluate',
    'qualification.read','certificate.read','skill_matrix.read','report.read','audit.read'
]::varchar[]) WHERE r.role_code IN ('TRAINER','ASSESSOR') ON CONFLICT DO NOTHING;

-- SUPERVISOR / MANAGER / HOD: scoped read + approval capacity.
INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM role r JOIN permission p ON p.code = ANY(ARRAY[
    'session.read','organisation.read','worker.read',
    'process.read','process_level.read','assessment.read',
    'qualification.read','qualification.approve','qualification.return',
    'certificate.read','skill_matrix.read','report.read','audit.read'
]::varchar[]) WHERE r.role_code IN ('SUPERVISOR','MANAGER','HOD') ON CONFLICT DO NOTHING;

-- EMPLOYEE: self-service only.
INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM role r JOIN permission p ON p.code = ANY(ARRAY[
    'session.read','worker.read','assessment.attempt','qualification.read','certificate.read','skill_matrix.read'
]::varchar[]) WHERE r.role_code = 'EMPLOYEE' ON CONFLICT DO NOTHING;

-- AUDITOR (an existing seeded role not named in the brief's role list) --
-- read-only across everything, matching its name.
INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM role r JOIN permission p ON p.code LIKE '%.read'
WHERE r.role_code = 'AUDITOR' ON CONFLICT DO NOTHING;
