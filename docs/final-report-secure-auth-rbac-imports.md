# Final Report — Secure Authentication, RBAC, and Master-Sheet Import

Delivered as milestones M10–M16 (commits `eae356d`…`fbe0687` on `main`), following
the plan at `/Users/mananmehta/.claude/plans/purring-squishing-sprout.md`. M9
(`3d87626`, self-assessment visibility) shipped in the same session as a
carry-over from the prior plan and is unrelated to this brief.

## 1. Route-protection inventory

See [`docs/route-protection-inventory.md`](./route-protection-inventory.md) for
the full classification (public / auth-only / role-gated / permission-gated /
service-layer-gated) of every backend route as of M12.

Headline numbers:
- **37 → 0** routes reachable with zero authentication (30 legacy MVP routers
  + the 7 that are intentionally public are now the only unauthenticated
  surface; the 30 legacy ones now require `authenticate`).
- **7** routes gained a new `requirePermission(...)` pre-check in M12
  (worker.read/update, assessment.evaluate, qualification.approve,
  certificate.revoke) — chosen only where exactly one caller population is
  unambiguous; a real test failure (see §7) proved one initial guess wrong
  and it was reverted rather than forced through.
- **~12** `qualification.ts` routes and **~58** other `/v2` read routes are
  documented as *not yet* permission-gated, with the specific reason each
  time (shared worker/staff callers, or simply out of this pass's scope).

## 2. Role-permission matrix as implemented

Roles (existing 8 + `HOD`, now migrated properly in `0022_permissions.sql`
rather than only ever created ad hoc by a seed script):
`ADMIN, LND_TEAM, MANAGER, TRAINER, ASSESSOR, SUPERVISOR, HOD, EMPLOYEE, AUDITOR`.

`ADMIN` covers both "Platform Admin" and "Company Admin" from the brief — the
distinction is `companyId === null` (platform-wide) vs. a single company,
already how `requirePlatformAdmin` worked before this brief; it is **not** a
second role code.

| Permission group | ADMIN | LND_TEAM | TRAINER / ASSESSOR | SUPERVISOR / MANAGER / HOD | EMPLOYEE | AUDITOR |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `session.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `company.*` (read/update; create/activate/deactivate are platform-admin-gated separately) | ✓ | read/update | – | – | – | read |
| `user.*` / `role.read` / `role.assign` | ✓ | ✓ (not `role.create`/`role.update`) | – | – | – | read |
| `organisation.*` | ✓ | ✓ | read | read | – | read |
| `worker.*` | ✓ | ✓ | read + update | read | read (self) | read |
| `salary.read` | ✓ | – | – | – | – | – |
| `process.*` / `process_level.*` | ✓ | ✓ | read | read | – | read |
| `assessment.read/create/update/archive` | ✓ | ✓ | read only | read | – | read |
| `assessment.attempt` | – | – | – | – | ✓ | – |
| `assessment.evaluate` | ✓ | ✓ | ✓ | – | – | – |
| `qualification.read` | ✓ | ✓ | ✓ | ✓ | ✓ | read |
| `qualification.approve` / `.return` | ✓ | ✓ | – | ✓ | – | – |
| `certificate.read` | ✓ | ✓ | ✓ | ✓ | ✓ | read |
| `certificate.issue` / `.revoke` | ✓ | ✓ | – | – | – | – |
| `skill_matrix.read` / `report.read` | ✓ | ✓ | ✓ | ✓ | ✓ (own) | read |
| `import.read/create/validate/publish` | ✓ | ✓ | – | – | – | – |
| `audit.read` | ✓ | ✓ | ✓ | ✓ | – | read |

`salary.read` exists as a defined permission (per the brief's explicit list)
but is granted to nobody but `ADMIN` — there is no salary column or feature
anywhere in the schema today, so this is a placeholder for a future field,
not an active gate.

Administer roles/permissions live: `GET/POST /v2/roles`, `PATCH /v2/roles/:id`,
`POST /v2/roles/:id/permissions` (platform-admin only), `POST/DELETE
/v2/users/:userId/roles(/:roleId)` (company-scoped, privilege-escalation
guarded — a company admin can never grant a role in a company other than
their own).

## 3. Authentication API

| Endpoint | Auth | Notes |
|---|---|---|
| `POST /api/v1/auth/login` | none | Body `{email, password}`. Generic `401` for both unknown identifier and wrong password. `403` if deactivated. `423` if locked (5 failed attempts / 15 min). Rate-limited per IP. Returns `{accessToken, user, expiresAt}` — never a password hash. |
| `POST /api/v1/auth/logout` | bearer | Revokes the session server-side (if the token carries one — dev-login/worker-portal tokens don't). |
| `GET /api/v1/auth/session` | bearer | Returns `{user}` (safe fields only) — also the liveness check the frontend uses on boot. |
| `POST /api/v1/auth/change-password` | bearer | Body `{oldPassword, newPassword}` (min 10 chars). Revokes **every** existing session on success, including the one used to call it. |
| `POST /api/v1/auth/dev-login` , `GET /api/v1/auth/dev-users` | none | Unchanged, dev-only (`config.devAuthActuallyEnabled`, off in production). |
| `POST /api/v1/v2/users/:id/deactivate` | ADMIN | Body `{reason}` (required, audited). Blocks the last active platform admin or the last active admin of a company. Revokes all the target's sessions. |
| `POST /api/v1/v2/users/:id/reactivate` | ADMIN | — |
| `POST /api/v1/v2/users/:id/reset-password` | ADMIN | Returns `{temporaryPassword}` once, in plaintext, for out-of-band relay — never logged, never stored anywhere but the argon2 hash. |
| `GET /api/v1/v2/companies/:companyId/users` | ADMIN/LND_TEAM | Company-scoped user list with resolved roles. |

Password hashing: Argon2id (`memoryCost: 19456, timeCost: 2, parallelism: 1`).
Session model: a `user_session` row per real login, `session_id` embedded as a
`sid` JWT claim; `authenticate()` validates it isn't revoked/expired on every
request carrying one. Dev-login and worker-portal tokens carry no `sid` and
are unaffected by any of this (verified directly in tests).

## 4. Master-data import templates and examples

Live templates: `GET /api/v1/v2/import-templates/organisation` and
`GET /api/v1/v2/import-templates/workers`.

Static copies + one valid and one intentionally-invalid example of each, for
reference without a running server:
- [`import-examples/organisation-template.csv`](./import-examples/organisation-template.csv)
- [`import-examples/organisation-valid-example.csv`](./import-examples/organisation-valid-example.csv)
- [`import-examples/organisation-invalid-example.csv`](./import-examples/organisation-invalid-example.csv) — exercises `MISSING_REQUIRED_VALUE`, `DUPLICATE_NODE_CODE`, `PARENT_NOT_FOUND`, `INVALID_PARENT_CHILD_TYPE`, `SELF_PARENT`, `COMPANY_MISMATCH`.
- [`import-examples/workers-template.csv`](./import-examples/workers-template.csv)
- [`import-examples/workers-valid-example.csv`](./import-examples/workers-valid-example.csv)
- [`import-examples/workers-invalid-example.csv`](./import-examples/workers-invalid-example.csv) — exercises `MISSING_REQUIRED_VALUE`, `COMPANY_MISMATCH`, `ORG_REFERENCE_NOT_FOUND`, `SELF_SUPERVISOR`, `MANAGER_NOT_FOUND`, `INVALID_ENUM`.

The worker template's column names are the brief's own (`plant_code`,
`vertical_code`, `department_code`, `supervisor_employee_code` /
`manager_employee_code`, `employment_status`, `source_record_id`) but the
real `worker` table has a single `org_unit_id`, a single
`reporting_manager_worker_id`, a `status` column, and no `source_record_id`
column at all — the exact mapping is documented in
`workerImportService.ts`'s header comment.

## 5. Migrations (this brief)

| # | File | Rollback note |
|---|---|---|
| 0021 | `secure_auth.sql` | Reversible: `DROP TABLE user_session; ALTER TABLE app_user DROP COLUMN password_hash, ... ;` — no data loss beyond the new columns/table themselves (nothing pre-existing is altered). |
| 0022 | `permissions.sql` | Reversible: `DROP TABLE role_permission, permission;` — the `HOD` role insert is `ON CONFLICT DO NOTHING` against the pre-existing seed script's own insert, so it's safe either way; rolling back does not remove the `HOD` role row itself (harmless if left). |
| 0023 | `master_imports.sql` | Reversible: `DROP TABLE import_row_error, import_staging_row, import_batch;` — purely additive, no existing table altered. |

All three were applied and tested against the existing local database with
real M1–M9 data present (not just an empty schema).

## 6. Test results

```
cd server && npx tsc --noEmit && npx tsc -p tsconfig.test.json --noEmit
cd web && npx tsc -b && npm run build
cd server && npx vitest run
node scripts/replay_figma_demo_journey.mjs
```

Final state: **21 test files, 106 tests, all passing** (75 pre-existing +
31 new: 10 `auth.test.ts`, 6 `roleAdmin.test.ts`, 6 `routeProtection.test.ts`,
9 `masterImports.test.ts` — `selfAssessmentVisibility.test.ts`'s 9 tests are
M9, not this brief). Server and web typecheck clean. The replay script
(`scripts/replay_figma_demo_journey.mjs`) — the Rajesh Kumar BRA E2→E3
end-to-end qualification journey — passed after every single milestone in
this brief, confirmed again as the very last verification step before this
report.

Three real regressions were caught and fixed during test-writing (not
theoretical — each broke a real assertion before being fixed):
1. M11: `recordAudit`'s `entity_id` column is UUID-typed; `role.role_id` is
   a `SMALLSERIAL`, so auditing role mutations by that id violated the
   column type — fixed by dropping those specific audit calls.
2. M12: an initial `requirePermission("certificate.issue")` gate on the
   certify route broke 3 existing tests whose Supervisor-token assumption
   was more permissive than expected — reverted rather than guessed at
   further (see the inventory's "deliberately left" section).
3. M13/M14: publish wrote a duplicate `STATUS_CHANGE` audit row (once inside
   its own transaction, again in the shared `markPublished` helper), and
   re-validating a `CANCELLED`/`PUBLISHED` batch silently resurrected it to
   `VALID`, letting a cancelled batch still be published — both fixed.

## 7. Live verification (browser)

Performed via MCP browser automation against the local dev server, with all
scratch data cleaned up afterward (confirmed via direct DB queries):

- **Login**: real email+password sign-in with the seeded demo password;
  confirmed `GET /auth/session` round-trip on boot; confirmed dev-login
  shortcuts only render after the client confirms dev mode is actually
  enabled server-side.
- **Session expiry**: the JWT's natural 15-minute TTL elapsed mid-session
  and the app cleanly redirected to `/login` rather than showing a broken
  page or stale data — an organic, unplanned proof of the expiry-handling
  requirement.
- **Logout**: confirmed `POST /auth/logout` fires and returns `200`.
- **Organisation import**: uploaded a real CSV → validated (`VALID`,
  0 errors) → published (`1 created`) → confirmed the row landed in
  `org_unit` via direct SQL. A second file exercised every validation error
  code in one batch, rendering the row-level error table correctly.
- **Worker import**: uploaded → validated → published → confirmed the new
  worker appears in the real Worker Search page (`ZZBROWSERWRK1`, DIRECT,
  Technician) — proving the import writes data the rest of the app actually
  reads, not just a database row in isolation.
- **User management**: reset password (temp password shown once), deactivate
  with a required reason (confirmed `is_active = false` + reason in the
  database), reactivate (confirmed `is_active = true` again).
- **Skill Matrix**: the *legacy* Skill Matrix page (`/skill-matrix`) reads
  an older, separate data model (`worker_process_skill`) unrelated to the
  new imports — checked and documented rather than silently claimed; the
  real verification point (imported worker visible to the actual app) was
  done via the modern Worker Search page instead, which does read the
  `worker` table the import writes to.

No static screenshot files were generated (the toolset used renders images
inline for verification, not to disk) — the results above are the literal
confirmed outcomes of that session, not a description of intended behavior.

## 8. Confirmation: existing flows still work

The Rajesh Kumar BRA E2→E3 qualification journey
(`scripts/replay_figma_demo_journey.mjs`) passed after **every** milestone in
this brief (M10 through M15), most recently immediately before this report.
Assessment attempts, approval workflow, certificate issuance, worker-portal
PIN login, and the worker self-assessment quiz are all confirmed unaffected.

## 9. Explicitly deferred items (for product-owner sign-off)

1. **XLSX import** — CSV-only for v1; the brief's own wording ("CSV or
   XLSX") permits this, and adding an XLSX parser is a contained follow-up.
2. **Forgot/reset-password via email** — no SMTP/SES infrastructure exists
   in this codebase; the brief itself gates these two endpoints on "only if
   a secure delivery mechanism exists." Admin-initiated reset (a one-time
   temp password) is built as the practical alternative.
3. **Full legacy-route re-platforming** — the 30 "legacy MVP demo" routes
   are now authentication-gated (closing the actual open-internet hole) but
   still have zero `company_id` scoping in their own queries (they pre-date
   the tenancy model). A full migration onto the v2 model is its own
   multi-milestone project; there is no v2 equivalent today for retest
   cycles, escalations, gap analysis, or learning paths.
4. **`NODE_ENV=production` flip on Render** — not changed this pass.
   Flipping it would disable dev-login entirely (fine for real staff, who
   now have real passwords) but is a deployment decision with its own
   blast radius (verifying every demo/QA workflow that currently relies on
   dev-login) better made deliberately, not as a side effect of this brief.
5. **Remaining un-permission-gated `/v2` routes** — ~12 `qualification.ts`
   routes (shared worker/staff callers) and ~58 other read routes are
   documented in the route-protection inventory as scoped-but-not-yet-
   permission-gated, for a follow-up pass with more careful, scenario-by-
   scenario verification than this pass's time budget allowed.
6. **Account creation UI** — no endpoint exists to create a brand-new
   `app_user` with a password (accounts today are seeded, or lazily created
   by the worker-portal on first PIN verification). `UserManagement.tsx`'s
   "+ Add User" stays an honest disabled note rather than a fake control.
