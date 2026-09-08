# Oworkly LMS & Assessment Platform — MVP v1

A working slice of the Phase 1 architecture spec (`../Architecture Spec - Phase 1/`), built to demo: real PostgreSQL schema for Modules 1–6, a REST API, a React frontend, and the actual Suzlon WTG Skill Matrix workbook ingested as live data — not mock data.

## Run it (3 commands)

```bash
./scripts/start.sh
```

This boots Docker Desktop if needed, starts Postgres, and starts the API (`:4000`) and web app (`:5173`) in the background. Then open **http://localhost:5173**.

If the database is empty (first run on a new machine) or you want a clean demo dataset, run this first:

```bash
./scripts/reset-and-seed.sh
python3 scripts/replay_demo_scenarios.py
```

The first script wipes and re-ingests the real workbook; the second runs one live assessment to a PASS (certificate issued) and one to a FAIL (retest + gap analysis), so the app opens with a populated, working demo instead of an empty roster.

**Logs**: `/tmp/lms-server.log` and `/tmp/lms-web.log`. **Stop everything**: `docker compose down` plus `pkill -f "tsx watch"` and `pkill -f "vite --port 5173"`.

## What's real vs. simplified

Real:
- PostgreSQL schema is a direct, single-tenant subset of `02_Database_Schema.sql` (Modules 1–6 in full — org units, processes, competency framework, learning paths, assessment engine, outcomes/certificates, retest policy, gap analysis).
- The 120 workers, 27 processes, and skill levels are **ingested from the actual** `WTG - June - CQA_MBU_HR_FOR_001 … Skill Matrix - GAP analysis.xlsx` file in `L&D Details/NE & Tower Vertical/`, reusing the spec's own tested parser (`Architecture Spec - Phase 1/scripts/parse_wtg_skill_matrix.py`). See the **Ingestion Report** page in the app for what the pipeline caught and quarantined in the real file.
- The assessment engine is the real deterministic scoring policy from the spec: weighted theory/practical/behaviour composite, a failed critical safety checklist item forces a fail regardless of score, pass → certificate issuance + skill level update, fail → retest cycle (with escalation past max attempts) + per-component skill gaps + rule-matched recommended learning injected into a narrowed learning path.
- **Self / Supervisor / Trainer assessment model** (added after the Assessment Master Architecture review): every process/level has two templates — a certifying **Supervisor** assessment and a non-certifying **Self-Check** readiness check the worker can run first. Individual checklist/behaviour criteria carry their own `evaluator_capacity` (e.g. "Process Knowledge" = Self, "Correct PPE worn" = Supervisor/Assessor), visible as badges on the scoring screen. `assessment_template_role_scope` records who can take/evaluate each template. The domain rule is enforced in the API, not just the UI: a Self-Check attempt is scored the same way but never creates an `assessment_outcome`, certificate, retest cycle, or skill-level change — verified live (see the DB checks in this session).

Simplified for a one-day MVP (see inline comments in the code for exactly where):
- **Backend is Node/TypeScript + Express**, not .NET 8 — this machine has no dotnet SDK installed. Same schema, same REST resource shapes; a straight port to Clean Architecture/.NET is future work, not a redesign.
- **Single tenant**, no schema-per-tenant multi-tenancy — this is the spec's own documented "on-prem collapses to one schema" form (§7), just applied here for the MVP rather than only on-prem.
- **No real auth.** A "Viewing as" role switcher in the top bar swaps between six seeded demo users (Admin/L&D/Manager/Assessor/Supervisor/Employee) to show the RBAC-by-role idea; there's no JWT/OIDC and no password anywhere.
- **No AI/RAG.** Quiz questions, checklist items, and behaviour criteria for the two demo processes are hand-seeded, not generated. The spec itself treats the Excel ingestion path as deterministic/non-AI (§7 of `04_AI_Pipeline_Architecture.md`), so this doesn't weaken the ingestion story — it just means the AI quiz-generation and CV-audit features aren't built.
- **Skill Matrix page** computes required-vs-actual headcount from convenience columns added directly on `process`, as an MVP stand-in for the Phase 2 `headcount_requirement`/Module 7-8 engine described in the spec — flagged in the schema and on the page itself.
- One inferred heuristic: employment type (permanent/contract) is guessed from employee-code shape (numeric vs. "SC"-prefixed), since the workbook never states it. Called out on the Ingestion Report page.
- `learning_activity_catalog.requires_assessment` / `min_completion_pct` are modeled, seeded (e.g. the OJT activity needs 80% completion; "Demonstrate the process unsupervised to a Trainer" requires a passed linked assessment) and shown as badges on the Learning Path screen, but **not enforced** — marking an activity complete never actually blocks on the linked assessment or the completion threshold in this MVP. A real implementation would 422 the completion call per `03_NET_API_Architecture.md` §6's Module 2 endpoint spec.
- No Trainer-category template is seeded (Self + Supervisor only) — the schema/API support `assessment_category='TRAINER'` and `assessment_template_role_scope` for it, but there's no seeded TTT-track instance to click through.

## Suggested walkthrough for the demo

1. **Dashboard** — real counts, deployment mode, module coverage.
2. **Ingestion Report** — what happened running the real file through the pipeline, including the messy bits (a whole sheet with zero usable worker rows, a legend block sandwiched mid-data). This is the strongest "we actually did the work" evidence.
3. **Skill Matrix** — required vs. actual headcount per real process, straight from the workbook.
4. **Workers → pick anyone** — real name, real employee code, real process/skill assignments.
5. **Assessments → start a new attempt** — pick a worker + template (note the **Self-Check** vs **Supervisor** options per process/level), score theory/practical/behaviour live, finalize. Toggle the critical safety item to "Fail" to show the forced-fail rule, or answer everything correctly to show a PASS and the certificate that gets issued. Run a **Self-Check** attempt to show the "READY / NOT YET READY" result screen and that it never touches certification.
6. **Gap Analysis & Retest** — the FAIL you just ran (or the pre-loaded Mahesh Popat More example) shows the skill gap, the rule-matched recommended activity, and the retest cooling-period date.
7. **Certificates → Public verify** — the QR-style no-login verification page.
8. **Role switcher → Employee** — same data, worker's-eye view (My Journey / My Certificates).

## Project layout

```
mvp/
  docker-compose.yml       Postgres (localhost:5433)
  db/schema.sql            Modules 1-6 DDL, single-tenant
  ingestion/               parser (from the spec) + Node seeder loading the real workbook
  server/                  Express + TypeScript API (/api/v1/...)
  web/                     React + Vite + Tailwind frontend
  scripts/                 start.sh, reset-and-seed.sh, replay_demo_scenarios.py
```
