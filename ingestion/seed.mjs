// Loads the real WTG Skill Matrix workbook (parsed by parse_wtg_skill_matrix.py,
// exported in full by export_full.py) into the Module 1-6 schema, following the
// field mapping in `05_Data_Migration_Ingestion_Strategy.md` §2.4, then seeds
// enough Module 2-6 config on two real processes so the Learning Path /
// Assessment / Certification / Retest / Gap Analysis flows are demoable end to
// end against live data instead of just Module 1 master data.
import { readFileSync } from "node:fs";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://oworkly:oworkly_dev_pw@localhost:5433/oworkly_lms";
const client = new pg.Client({ connectionString: DATABASE_URL });

// Fixed by migration 0002/0003 — the real WTG ingestion lives entirely under
// Chennai Wind Energy Co., re-rooted under the "WTG Daman Operations"
// Vertical node so it sits in one coherent tree alongside the Figma demo's
// Blade/Nacelle/Tower branches.
const CWE_COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const WTG_DAMAN_OPS_VERTICAL_ID = "c0000000-0000-0000-0000-000000000002";
const ORG_LEVEL_TYPE_BY_LEGACY_UNIT_TYPE = { PLANT: "LOCATION", AREA: "DEPARTMENT" };

const LEGEND_PATTERNS = [
  /% skill gap/i, /y - yes, n - no/i, /company level gap/i, /sum of line skill gap/i,
  /number of permanent/i, /number of contractual/i, /contractual percentage/i,
  /no\. of people below required level/i, /^example/i, /#div\/0!/i,
];
const VALID_EMP_CODE = /^(SC)?\d+$/i;

function cleanName(raw) {
  return String(raw || "").replace(/\s+/g, " ").trim();
}
function isLegend(text) {
  return LEGEND_PATTERNS.some((re) => re.test(text));
}
function splitName(full) {
  const parts = cleanName(full).split(" ");
  return { first: parts[0] || "Unknown", last: parts.slice(1).join(" ") || null };
}
// Process names drift between the definition-band header (rows 6-7, e.g.
// "Nacelle Testing") and the per-worker data rows (col 6, e.g. "Nacelle
// Testing ( Elect.)") in the real workbook — normalize away parenthetical
// qualifiers and punctuation so both sides key-match.
function normalizeProcessName(raw) {
  return cleanName(raw)
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function upsertOrgUnit({ parentId, unitType, code, name }) {
  const existing = await client.query(
    `SELECT org_unit_id FROM org_unit WHERE code = $1 AND parent_org_unit_id IS NOT DISTINCT FROM $2`,
    [code, parentId ?? null]
  );
  if (existing.rows[0]) return existing.rows[0].org_unit_id;
  const levelTypeCode = ORG_LEVEL_TYPE_BY_LEGACY_UNIT_TYPE[unitType] ?? "DEPARTMENT";
  const levelType = await queryOneRow(
    `SELECT org_level_type_id FROM org_level_type WHERE company_id = $1 AND code = $2`,
    [CWE_COMPANY_ID, levelTypeCode]
  );
  const res = await client.query(
    `INSERT INTO org_unit (parent_org_unit_id, company_id, unit_type, org_level_type_id, code, name)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING org_unit_id`,
    [parentId ?? null, CWE_COMPANY_ID, unitType, levelType.org_level_type_id, code, name]
  );
  return res.rows[0].org_unit_id;
}

async function queryOneRow(sql, params) {
  const res = await client.query(sql, params);
  return res.rows[0];
}

async function loadSkillLevelMap() {
  const res = await client.query(`SELECT skill_level_id, level_code FROM skill_level_definition`);
  const map = {};
  for (const row of res.rows) map[row.level_code] = row.skill_level_id;
  return map;
}

async function loadPrimaryLevelMap() {
  const res = await client.query(`SELECT primary_level_id, code FROM primary_level_definition WHERE company_id = $1`, [CWE_COMPANY_ID]);
  const map = {};
  for (const row of res.rows) map[row.code] = row.primary_level_id;
  return map;
}

async function loadRoleMap() {
  const res = await client.query(`SELECT role_id, role_code FROM role`);
  return Object.fromEntries(res.rows.map((r) => [r.role_code, r.role_id]));
}

async function upsertAssessmentTemplate(processId, levelId, name, category, isReadinessCheck) {
  const res = await client.query(
    `INSERT INTO assessment_template (process_id, skill_level_id, name, assessment_category, is_readiness_check_only, theory_question_count)
     VALUES ($1,$2,$3,$4,$5,5)
     ON CONFLICT (process_id, skill_level_id, assessment_category, version) DO UPDATE SET name = EXCLUDED.name
     RETURNING assessment_template_id`,
    [processId, levelId, name, category, isReadinessCheck]
  );
  return res.rows[0].assessment_template_id;
}

async function seedRoleScope(templateId, entries, roleIdByCode) {
  for (const [roleCode, capacity] of entries) {
    await client.query(
      `INSERT INTO assessment_template_role_scope (assessment_template_id, role_id, capacity) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [templateId, roleIdByCode[roleCode], capacity]
    );
  }
}

// Same underlying criteria for both templates on a process/level — mirrors the
// reviewed criteria table (Process Knowledge = Self-rated, the rest Supervisor-
// rated) for the SUPERVISOR template; the SELF template scores every item as SELF
// since the whole point is the worker rating themselves against the same bar.
async function seedTemplateContent(templateId, category) {
  const existingQ = await client.query(`SELECT 1 FROM question_bank WHERE assessment_template_id = $1 LIMIT 1`, [templateId]);
  if (existingQ.rows[0]) return;

  const questions = [
    ["What is the correct torque sequence before energizing the control panel?", [["A","Center-out, star pattern"],["B","Left to right"],["C","Any order"],["D","Reverse of assembly order"]], ["A"], "safety"],
    ["Which PPE is mandatory before opening the slipring housing?", [["A","Safety glasses only"],["B","Insulated gloves + safety glasses"],["C","None, it is de-energized"],["D","Ear protection only"]], ["B"], "safety"],
    ["A control panel wiring diagram revision mismatch should be resolved by:", [["A","Proceeding and noting it later"],["B","Escalating to the SOP owner before continuing"],["C","Using the older revision"],["D","Skipping that sub-assembly"]], ["B"], "quality"],
    ["Standard work time for this sub-assembly is exceeded — first action?", [["A","Rush remaining steps"],["B","Flag to supervisor and check for a blocking issue"],["C","Skip the quality check"],["D","Nothing, it is within tolerance"]], ["B"], "productivity"],
    ["Which of these is a critical safety checkpoint (not just quality)?", [["A","Label orientation"],["B","Cable tie spacing"],["C","Torque on the earthing bolt"],["D","Paint finish"]], ["C"], "safety"],
  ];
  for (const [text, opts, correct, tag] of questions) {
    await client.query(
      `INSERT INTO question_bank (assessment_template_id, question_text, options_json, correct_answer_json, tags)
       VALUES ($1,$2,$3,$4,$5)`,
      [templateId, text, JSON.stringify(opts.map(([k, t]) => ({ key: k, text: t }))), JSON.stringify(correct), [tag]]
    );
  }

  const checklist = [
    ["standard_work", "Process Knowledge — can explain the process steps and parameters unprompted", false, "SELF"],
    ["safety", "Correct PPE worn throughout", true, "SUPERVISOR_ASSESSOR"],
    ["quality", "Torque values within spec on all fasteners", false, "SUPERVISOR_ASSESSOR"],
    ["standard_work", "Sequence followed per SOP without skipped steps", false, "SUPERVISOR_ASSESSOR"],
    ["productivity", "Completed within standard time", false, "SUPERVISOR_ASSESSOR"],
  ];
  let seq = 1;
  for (const [cat, text, critical, defaultCapacity] of checklist) {
    const capacity = category === "SELF" ? "SELF" : defaultCapacity;
    await client.query(
      `INSERT INTO practical_checklist_item (assessment_template_id, category, criterion_text, is_critical, evaluator_capacity, sequence_no)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [templateId, cat, text, critical, capacity, seq++]
    );
  }

  const behaviours = [["ATTENDANCE", "Attendance & Punctuality"], ["COMMUNICATION", "Communication"], ["TEAMWORK", "Teamwork"], ["DISCIPLINE", "Discipline"]];
  seq = 1;
  for (const [code, label] of behaviours) {
    const capacity = category === "SELF" ? "SELF" : "SUPERVISOR_ASSESSOR";
    await client.query(
      `INSERT INTO behaviour_criterion (assessment_template_id, criterion_code, criterion_label, evaluator_capacity, sequence_no) VALUES ($1,$2,$3,$4,$5)`,
      [templateId, code, label, capacity, seq++]
    );
  }
}

async function main() {
  await client.connect();
  const data = JSON.parse(readFileSync(new URL("./parsed_wtg_full.json", import.meta.url)));
  const levelIdByCode = await loadSkillLevelMap();
  const roleIdByCode = await loadRoleMap();
  const primaryLevelIdByCode = await loadPrimaryLevelMap();

  const plantId = await upsertOrgUnit({ parentId: WTG_DAMAN_OPS_VERTICAL_ID, unitType: "PLANT", code: "WTG-DAMAN", name: "WTG Daman" });
  console.log(`Plant: WTG Daman (${plantId})`);

  const sheetConfig = [
    { match: /elec/i, areaCode: "ELEC-AREA", areaName: "Electrical Assembly", procPrefix: "ELEC" },
    { match: /mech/i, areaCode: "MECH-AREA", areaName: "Mechanical Assembly", procPrefix: "MECH" },
  ];

  const stats = { orgUnits: 1, processes: 0, workers: 0, workerProcessSkills: 0, skippedGarbageRows: 0, skippedNoMatch: 0 };
  const demoProcessIds = {}; // name -> process_id, for the two flagship processes we deepen below

  for (const sheet of data.sheets) {
    const cfg = sheetConfig.find((c) => c.match.test(sheet.sheet_name));
    if (!cfg) continue;
    const areaId = await upsertOrgUnit({ parentId: plantId, unitType: "AREA", code: cfg.areaCode, name: cfg.areaName });
    stats.orgUnits++;

    const validProcesses = sheet.processes.filter((p) => {
      const name = cleanName(p.process_name);
      return name && !name.startsWith("Unnamed process at col") && name !== "Total requirement Level Wise";
    });

    const processIdByName = new Map();
    let idx = 0;
    for (const p of validProcesses) {
      idx++;
      const name = cleanName(p.process_name);
      const code = `${cfg.procPrefix}-${String(idx).padStart(2, "0")}`;
      const isCritical = String(p.criticality).trim().toUpperCase() === "Y";
      const hc = p.headcount_required || {};
      const res = await client.query(
        `INSERT INTO process (org_unit_id, company_id, code, name, is_critical)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (org_unit_id, code) DO UPDATE SET name = EXCLUDED.name
         RETURNING process_id`,
        [areaId, CWE_COMPANY_ID, code, name, isCritical]
      );
      const processId = res.rows[0].process_id;
      processIdByName.set(normalizeProcessName(name), processId);
      stats.processes++;

      for (const levelCode of p.required_levels || []) {
        const levelId = levelIdByCode[levelCode];
        if (!levelId) continue;
        await client.query(
          `INSERT INTO competency_framework (process_id, skill_level_id) VALUES ($1,$2)
           ON CONFLICT (process_id, skill_level_id) DO NOTHING`,
          [processId, levelId]
        );
        // Real processes never defined their own E/S/T-style level codes, so
        // the process_level backfill reuses the global L-code as-is (matches
        // what migration 0004 does for pre-existing data — done here inline
        // since this data doesn't exist until this seed script creates it).
        const levelInfo = await queryOneRow(`SELECT label, ordinal FROM skill_level_definition WHERE skill_level_id = $1`, [levelId]);
        await client.query(
          `INSERT INTO process_level (company_id, process_id, code, name, ordinal, primary_level_id, budgeted_headcount)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (company_id, process_id, code) DO NOTHING`,
          [CWE_COMPANY_ID, processId, levelCode, levelInfo.label, levelInfo.ordinal, primaryLevelIdByCode[levelCode] ?? null, hc[levelCode] ?? null]
        );
      }

      if (name === "Nacelle Electical & Control panel Assembly") demoProcessIds.nacelle = processId;
      if (name === "Slipring Assembly") demoProcessIds.slipring = processId;
    }

    const validNames = new Set(processIdByName.keys());
    const workerIdByEmpCode = new Map();

    for (const row of sheet.workers) {
      const procName = cleanName(row.process_name);
      const normName = normalizeProcessName(row.process_name);
      const empCode = String(row.emp_code || "").trim();
      if (!procName || isLegend(procName) || isLegend(row.name || "") || !validNames.has(normName)) {
        stats.skippedGarbageRows++;
        continue;
      }
      if (!VALID_EMP_CODE.test(empCode)) {
        stats.skippedGarbageRows++;
        continue;
      }
      const processId = processIdByName.get(normName);
      if (!processId) {
        stats.skippedNoMatch++;
        continue;
      }

      let workerId = workerIdByEmpCode.get(empCode);
      if (!workerId) {
        const { first, last } = splitName(row.name);
        // Heuristic inferred for this demo (not stated in the source docs): Suzlon's
        // "SC"-prefixed codes read as contractor/vendor codes vs. plain-numeric
        // permanent employee codes — gives the permanent/contract split real signal.
        const employmentType = /^SC/i.test(empCode) ? "CONTRACT" : "DIRECT";
        const existing = await client.query(`SELECT worker_id FROM worker WHERE hrms_employee_code = $1`, [empCode]);
        if (existing.rows[0]) {
          workerId = existing.rows[0].worker_id;
        } else {
          const wres = await client.query(
            `INSERT INTO worker (hrms_employee_code, employment_type, first_name, last_name, org_unit_id, company_id)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING worker_id`,
            [empCode, employmentType, first, last, areaId, CWE_COMPANY_ID]
          );
          workerId = wres.rows[0].worker_id;
          stats.workers++;
        }
        workerIdByEmpCode.set(empCode, workerId);
      }

      let attainedLevelId = null;
      let attainedAt = null;
      let attainedProcessLevelId = null;
      if (row.attained_level_mark) {
        const levelCode = String(row.attained_level_mark).split("=")[0];
        attainedLevelId = levelIdByCode[levelCode] || null;
        attainedAt = attainedLevelId ? new Date() : null;
        if (levelCode) {
          const pl = await queryOneRow(`SELECT process_level_id FROM process_level WHERE process_id = $1 AND code = $2`, [processId, levelCode]);
          attainedProcessLevelId = pl?.process_level_id ?? null;
        }
      }
      await client.query(
        `INSERT INTO worker_process_skill (worker_id, process_id, current_skill_level_id, process_level_id, attained_at, source_outcome_id)
         VALUES ($1,$2,$3,$4,$5,NULL)
         ON CONFLICT (worker_id, process_id) DO UPDATE SET current_skill_level_id = EXCLUDED.current_skill_level_id, process_level_id = EXCLUDED.process_level_id, attained_at = EXCLUDED.attained_at`,
        [workerId, processId, attainedLevelId, attainedProcessLevelId, attainedAt]
      );
      await client.query(
        `INSERT INTO worker_process_enrollment (worker_id, process_id, current_process_level_id, source)
         VALUES ($1,$2,$3,'migration_batch') ON CONFLICT (worker_id, process_id) DO UPDATE SET current_process_level_id = EXCLUDED.current_process_level_id`,
        [workerId, processId, attainedProcessLevelId]
      );
      stats.workerProcessSkills++;
    }
    console.log(`Sheet '${sheet.sheet_name}': ${validProcesses.length} processes ingested, ${workerIdByEmpCode.size} distinct workers, ${stats.skippedGarbageRows} legend/garbage rows quarantined so far`);
  }

  // ---- Job roles (Module 1, lightweight) ----
  const jobRoles = [
    ["TECH", "Technician"],
    ["LSUP", "Line Supervisor"],
    ["LND", "L&D Coordinator"],
  ];
  const jobRoleIds = {};
  for (const [code, name] of jobRoles) {
    const res = await client.query(
      `INSERT INTO job_role (code, name) VALUES ($1,$2) ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING job_role_id`,
      [code, name]
    );
    jobRoleIds[code] = res.rows[0].job_role_id;
  }
  await client.query(`UPDATE worker SET primary_job_role_id = $1 WHERE primary_job_role_id IS NULL`, [jobRoleIds.TECH]);

  // ---- Deepen two real, critical, data-rich processes for the live Module 2-6 demo ----
  for (const [key, processId] of Object.entries(demoProcessIds)) {
    if (!processId) continue;
    const l2 = levelIdByCode.L2, l3 = levelIdByCode.L3;
    const processLabel = key === "nacelle" ? "Nacelle Electrical & Control Panel Assembly" : "Slipring Assembly";
    const supervisorTemplateIdByLevel = {};

    for (const levelId of [l2, l3]) {
      const levelCode = levelId === l2 ? "L2" : "L3";

      await client.query(
        `INSERT INTO assessment_weightage_config (process_id, skill_level_id, theory_weight_pct, practical_weight_pct, behaviour_weight_pct, passing_score_pct)
         VALUES ($1,$2,20,70,10,70) ON CONFLICT (process_id, skill_level_id) DO NOTHING`,
        [processId, levelId]
      );
      await client.query(
        `INSERT INTO retest_policy (process_id, skill_level_id, cooling_period_days, max_attempts, escalation_role_code)
         VALUES ($1,$2,7,3,'SUPERVISOR') ON CONFLICT (process_id, skill_level_id) DO NOTHING`,
        [processId, levelId]
      );

      // Two templates per process/level, per the reviewed Assessment Master design:
      // a certifying SUPERVISOR assessment, and a SELF readiness check the worker can
      // run beforehand — never itself certifying (enforced in the submit handler).
      const supervisorTemplateId = await upsertAssessmentTemplate(processId, levelId, `${processLabel} — ${levelCode} Assessment`, "SUPERVISOR", false);
      const selfTemplateId = await upsertAssessmentTemplate(processId, levelId, `${processLabel} — ${levelCode} Readiness Check (Self)`, "SELF", true);
      supervisorTemplateIdByLevel[levelCode] = supervisorTemplateId;

      await seedRoleScope(supervisorTemplateId, [["EMPLOYEE", "CAN_TAKE"], ["SUPERVISOR", "CAN_EVALUATE"], ["ASSESSOR", "CAN_EVALUATE"]], roleIdByCode);
      await seedRoleScope(selfTemplateId, [["EMPLOYEE", "CAN_TAKE"], ["EMPLOYEE", "CAN_EVALUATE"]], roleIdByCode);

      await seedTemplateContent(supervisorTemplateId, "SUPERVISOR");
      await seedTemplateContent(selfTemplateId, "SELF");
    }

    // requiresAssessment activities link back to the SUPERVISOR template for that
    // level (a Practical Demonstration is only "complete" once that mini-assessment
    // is passed, not just evidenced) — min_completion_pct varies per activity type
    // (e.g. OJT tracked as % of required hours/reps logged, not a binary tick).
    const activityDefs = [
      ["SOP_READING", "Read & acknowledge the process SOP", 100, false],
      ["OJT", "On-the-job training with a certified L3+ buddy", 80, false],
      ["TOOLBOX_TALK", "Safety toolbox talk for this process", 100, false],
      ["PRACTICAL_DEMONSTRATION", "Demonstrate the process unsupervised to a Trainer", 100, true],
    ];
    for (const levelId of [l2, l3]) {
      const levelCode = levelId === l2 ? "L2" : "L3";
      const activityIdByType = {};
      for (const [type, title, minCompletionPct, requiresAssessment] of activityDefs) {
        const evidenceType = type === "SOP_READING" ? "digital_signoff" : "photo";
        const linkedTemplateId = requiresAssessment ? supervisorTemplateIdByLevel[levelCode] : null;
        const ares = await client.query(
          `INSERT INTO learning_activity_catalog (process_id, skill_level_id, activity_type, title, evidence_type_required, min_completion_pct, requires_assessment, linked_assessment_template_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING learning_activity_catalog_id`,
          [processId, levelId, type, title, evidenceType, minCompletionPct, requiresAssessment, linkedTemplateId]
        );
        activityIdByType[type] = ares.rows[0].learning_activity_catalog_id;
      }
      // Module 6 deterministic base rules (§ AI Pipeline Architecture 04, Module 2):
      // "gap_remediation_rule table is always applied first — this alone must
      // produce a correct, complete remediation path with zero AI involvement."
      const ruleMap = [
        ["theory", activityIdByType.SOP_READING],
        ["practical", activityIdByType.OJT],
        ["behaviour", activityIdByType.TOOLBOX_TALK],
      ];
      for (const [gapType, activityId] of ruleMap) {
        await client.query(
          `INSERT INTO gap_remediation_rule (gap_type, learning_activity_catalog_id, priority) VALUES ($1,$2,1)`,
          [gapType, activityId]
        );
      }
    }

    const ctRes = await client.query(
      `INSERT INTO certificate_template (certificate_type, layout_json, company_id) VALUES ('COMPETENCY_CARD', $1, $2) RETURNING certificate_template_id`,
      [JSON.stringify({ brand: "Oworkly LMS — Demo", fields: ["worker_name", "process_name", "skill_level", "valid_to", "qr"] }), CWE_COMPANY_ID]
    );
    demoProcessIds[`${key}_cert_template`] = ctRes.rows[0].certificate_template_id;
  }

  // ---- Demo app users (role switcher in the UI — no real auth in MVP) ----
  const firstWorker = await client.query(`SELECT worker_id, first_name, last_name FROM worker WHERE hrms_employee_code = '37908'`);
  const demoWorkerId = firstWorker.rows[0]?.worker_id || null;

  const demoUsers = [
    ["admin@demo.oworkly.local", "Amit Admin", "ADMIN", null],
    ["lnd@demo.oworkly.local", "Lakshmi (L&D Team)", "LND_TEAM", null],
    ["manager@demo.oworkly.local", "Manoj Manager", "MANAGER", null],
    ["assessor@demo.oworkly.local", "Asha Assessor", "ASSESSOR", null],
    ["supervisor@demo.oworkly.local", "Suresh Supervisor", "SUPERVISOR", null],
    ["employee@demo.oworkly.local", "Bhavinkumar Patel (Employee)", "EMPLOYEE", demoWorkerId],
  ];
  for (const [email, displayName, roleCode, workerId] of demoUsers) {
    const ures = await client.query(
      `INSERT INTO app_user (email, display_name, worker_id) VALUES ($1,$2,$3)
       ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING user_id`,
      [email, displayName, workerId]
    );
    const userId = ures.rows[0].user_id;
    // org_unit_id is part of the composite PK, so it can't actually be NULL despite
    // the "NULL = whole tenant" intent in the spec comment; scope to the plant root
    // instead, which is equivalent in this single-plant demo.
    await client.query(
      `INSERT INTO user_role (user_id, role_id, org_unit_id, company_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [userId, roleIdByCode[roleCode], plantId, CWE_COMPANY_ID]
    );
    await client.query(
      `INSERT INTO company_user_membership (company_id, user_id, is_primary) VALUES ($1,$2,TRUE) ON CONFLICT DO NOTHING`,
      [CWE_COMPANY_ID, userId]
    );
  }

  console.log("\n=== Ingestion summary ===");
  console.log(stats);
  console.log("Demo process IDs (deepened with Module 2-6 config):", demoProcessIds);
  await client.end();
}

main().catch(async (err) => {
  console.error(err);
  await client.end();
  process.exit(1);
});
