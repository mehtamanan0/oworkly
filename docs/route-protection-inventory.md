# Route Protection Inventory

Snapshot as of M12 (secure-auth/RBAC/import brief). Classifies every backend
route by how it is protected. "Permission gate" refers to `requirePermission`
(M11); "role gate" refers to the pre-existing `requireRole`/`requirePlatformAdmin`.

## Legend

- **Public** — intentionally reachable with no login.
- **Auth only** — requires a valid bearer token (`authenticate`), any role.
- **Role-gated** — `authenticate` + `requireRole(...)` / `requirePlatformAdmin`.
- **Permission-gated** — `authenticate` + `requirePermission(...)`, additive to any role gate.
- **Service-layer gated** — no route middleware beyond `authenticate`; authorization is enforced inside the service function itself (`assertEvaluatorCapacity`, approval stage-role match, `scopedCompanyId`, etc.) — this is deliberate, not a gap, where the check needs case-specific data a route-level gate can't see (e.g. "is this the worker's own record").

## Intentionally public (7 routes)

| Route | Why |
|---|---|
| `POST /auth/dev-login`, `GET /auth/dev-users` | Dev-only login adapter, gated in-handler by `config.devAuthActuallyEnabled` (forced off in production) |
| `POST /worker-portal/identify`, `POST /worker-portal/verify` | Worker self-service entry point — this *is* the login |
| `GET /public/verify/:qrToken` | Certificate QR verification, meant for anyone with the physical card |
| `PUT/GET /v2/media/local/:key` | Dev/CI local object-store stand-in; 404s under a real S3/R2 driver |

## Legacy MVP demo routes (16 routers, M12: now auth-only)

Previously mounted with **zero** middleware — fully open on the internet.
M12 added `authenticate` to every one of these 16 `v1.use(...)` lines in
`app.ts`. **Known limitation**: none of these routers' own queries filter by
`company_id` (they pre-date the tenancy model) — so while anonymous access
is now blocked, cross-tenant reads through these specific endpoints are not
yet isolated. A full re-platform onto the v2 model is the real fix, out of
scope for this pass (see "Deferred" in the M12 commit / final report).

`org-units`, `processes`, `skill-levels`, `job-roles`, `roles`, `users`,
`workers`, `skill-matrix`, `dashboard`, `learning-paths`,
`assessment-outcomes`, `certificates`, `retest-cycles`, `escalations`,
`skill-gaps`, `recommended-activities`.

## `/v2` — authenticated model

### Role-gated (unchanged from M5–M11, ~45 routes)
Every admin write route built in M5–M11 (`admin/companies.ts`,
`admin/orgHierarchy.ts`, `admin/processes.ts`, `admin/products.ts`,
`admin/selfAssessmentPolicies.ts`, `admin/users.ts`, `admin/roles.ts`) —
`requireRole("ADMIN","LND_TEAM")` or `requirePlatformAdmin` as appropriate.
`masterDataV2.ts`'s assessment-authoring writes — `requireAuthoringRole`.

### Permission-gated (M12, new)
| Route | Permission(s) | Why gated here |
|---|---|---|
| `GET /v2/workers/search` | `worker.read` | Unambiguous: every role that can list workers already holds it |
| `GET /v2/workers/:id/profile` | `worker.read` | Same — EMPLOYEE holds it for self-service too |
| `POST /v2/workers/:id/enroll` | `worker.update` | Staff-only action; EMPLOYEE correctly excluded |
| `POST /v2/media/uploads` | `assessment.evaluate` | Only whoever administers the assessment captures evidence |
| `POST /v2/assessment-attempts/:id/self-assessment-review` | `assessment.evaluate`, `qualification.approve` | Matches the service-layer's own role check (ADMIN/LND_TEAM/SUPERVISOR/TRAINER) |
| `POST /v2/qualification-cases/:id/approval/:stageSequence/act` | `qualification.approve` | Held by every approval-stage role (SUPERVISOR/HOD/LND_TEAM/ADMIN); the *specific* stage-role match stays a service-layer check |
| `POST /v2/certificates/:id/revoke` | `certificate.revoke` | ADMIN/LND_TEAM only |

### Deliberately left auth-only / service-layer-gated (not yet permission-gated)
`qualification.ts`'s remaining ~12 routes (create case, start attempt,
check-item, score, finalize, the various GET reads, and
`POST /qualification-cases/:id/certify`) — each is legitimately called by
**both** a worker (self-assessment) and staff (a real supervised assessment)
with different permission grants, or (for `certify`) real test coverage
proved the assumed caller set was wrong (a Supervisor token legitimately
reaches this route to hit its own state-machine guard). Getting an OR-list
wrong here risks a false-negative 403 on the flagship qualification journey,
so these stay on the existing, well-tested service-layer checks
(`assertEvaluatorCapacity`, `assertProcessScope`, the case status machine)
— flagged for a follow-up pass with more careful, scenario-by-scenario
verification.

`~58` other `/v2` authenticated-only routes (org hierarchy reads, process
reads, product reads, self-assessment-policy reads, company reads, etc.) —
read access, already company-scoped via `scopedCompanyId()`/inline checks;
not permission-gated this pass.
