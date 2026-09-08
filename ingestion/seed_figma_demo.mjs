// Seeds the Figma reference pack's named demo scenario (Blade Root Assembly,
// Rajesh Kumar EMP-2847, etc.) as NEW data alongside the real WTG Daman
// ingestion (run `seed.mjs` first) — both live under Chennai Wind Energy Co.
// This script only seeds configuration/master data (companies, hierarchy,
// processes/levels, assessment library, approval policy, users, workers,
// data sources). The actual qualification-case journey (Rajesh Kumar's
// E2->E3 assessment, approvals, certificate) is driven through the real API
// by scripts/replay_figma_demo_journey.mjs once the backend services exist —
// never fabricated directly in SQL, per the project's own "prove it through
// enforcement" rule.
import { randomBytes, scryptSync } from "node:crypto";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://oworkly:oworkly_dev_pw@localhost:5433/oworkly_lms";
const client = new pg.Client({ connectionString: DATABASE_URL });

const CWE = "11111111-1111-1111-1111-111111111111";

function hashPin(pin) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pin, salt, 32).toString("hex");
  return { hash, salt };
}

async function upsertOrgUnit({ parentId, code, name, levelCode }) {
  const existing = await client.query(`SELECT org_unit_id FROM org_unit WHERE code = $1 AND company_id = $2`, [code, CWE]);
  if (existing.rows[0]) return existing.rows[0].org_unit_id;
  const levelType = await client.query(`SELECT org_level_type_id FROM org_level_type WHERE company_id = $1 AND code = $2`, [CWE, levelCode]);
  const res = await client.query(
    `INSERT INTO org_unit (parent_org_unit_id, company_id, unit_type, org_level_type_id, code, name)
     VALUES ($1,$2,'PLANT',$3,$4,$5) RETURNING org_unit_id`,
    [parentId, CWE, levelType.rows[0].org_level_type_id, code, name]
  );
  return res.rows[0].org_unit_id;
}

async function upsertOrgUnitForCompany(companyId, code, name, levelCode, parentId) {
  const existing = await client.query(`SELECT org_unit_id FROM org_unit WHERE code = $1 AND company_id = $2`, [code, companyId]);
  if (existing.rows[0]) return existing.rows[0].org_unit_id;
  const levelType = await client.query(`SELECT org_level_type_id FROM org_level_type WHERE company_id = $1 AND code = $2`, [companyId, levelCode]);
  const res = await client.query(
    `INSERT INTO org_unit (parent_org_unit_id, company_id, unit_type, org_level_type_id, code, name)
     VALUES ($1,$2,'PLANT',$3,$4,$5) RETURNING org_unit_id`,
    [parentId, companyId, levelType.rows[0].org_level_type_id, code, name]
  );
  return res.rows[0].org_unit_id;
}

async function upsertProcess({ orgUnitId, code, name, isCritical = false }) {
  const res = await client.query(
    `INSERT INTO process (org_unit_id, company_id, code, name, is_critical) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (org_unit_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING process_id`,
    [orgUnitId, CWE, code, name, isCritical]
  );
  return res.rows[0].process_id;
}

async function upsertProcessLevel({ processId, code, name, ordinal, primaryLevelCode, minPct, headcount, selfAssess = false }) {
  const primaryLevel = await client.query(`SELECT primary_level_id FROM primary_level_definition WHERE company_id = $1 AND code = $2`, [CWE, primaryLevelCode]);
  const res = await client.query(
    `INSERT INTO process_level (company_id, process_id, code, name, ordinal, primary_level_id, min_qualification_score_pct, budgeted_headcount, self_assessment_enabled)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (company_id, process_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING process_level_id`,
    [CWE, processId, code, name, ordinal, primaryLevel.rows[0].primary_level_id, minPct, headcount, selfAssess]
  );
  return res.rows[0].process_level_id;
}

async function upsertAssessmentDefinition({ name, description, componentType }) {
  const existing = await client.query(`SELECT assessment_definition_id FROM assessment_definition WHERE company_id = $1 AND name = $2`, [CWE, name]);
  if (existing.rows[0]) return existing.rows[0].assessment_definition_id;
  const res = await client.query(
    `INSERT INTO assessment_definition (company_id, name, description, component_type) VALUES ($1,$2,$3,$4) RETURNING assessment_definition_id`,
    [CWE, name, description, componentType]
  );
  return res.rows[0].assessment_definition_id;
}

async function addItems(definitionId, items) {
  const existing = await client.query(`SELECT 1 FROM assessment_item WHERE assessment_definition_id = $1 LIMIT 1`, [definitionId]);
  if (existing.rows[0]) return;
  let seq = 1;
  for (const item of items) {
    await client.query(
      `INSERT INTO assessment_item (assessment_definition_id, item_type, prompt, options_json, correct_answer_json, explanation, max_score, rating_scale_max, is_critical, evaluator_capacity, sequence_no)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        definitionId, item.type, item.prompt,
        item.options ? JSON.stringify(item.options) : null,
        item.correct ? JSON.stringify(item.correct) : null,
        item.explanation ?? null, item.maxScore ?? (item.type === "RATING_1_5" ? 5 : 1),
        item.type === "RATING_1_5" ? 5 : null, item.critical ?? false,
        item.evaluatorCapacity ?? "SUPERVISOR_ASSESSOR", seq++,
      ]
    );
  }
}

async function upsertPackage({ processLevelId, components }) {
  const existing = await client.query(`SELECT assessment_package_id FROM assessment_package WHERE process_level_id = $1 AND version = 1`, [processLevelId]);
  const packageId = existing.rows[0]
    ? existing.rows[0].assessment_package_id
    : (await client.query(
        `INSERT INTO assessment_package (company_id, process_level_id, version) VALUES ($1,$2,1) RETURNING assessment_package_id`,
        [CWE, processLevelId]
      )).rows[0].assessment_package_id;
  await client.query(`DELETE FROM assessment_package_component WHERE assessment_package_id = $1`, [packageId]);
  let seq = 1;
  for (const c of components) {
    await client.query(
      `INSERT INTO assessment_package_component (assessment_package_id, assessment_definition_id, sequence_no, weight_pct, min_gate_pct, is_mandatory, self_assessment_enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [packageId, c.definitionId, seq++, c.weightPct, c.gatePct ?? null, c.mandatory ?? true, c.selfAssess ?? false]
    );
  }
  return packageId;
}

async function upsertUser({ email, username, displayName, workerId = null }) {
  const res = await client.query(
    `INSERT INTO app_user (email, display_name, worker_id) VALUES ($1,$2,$3)
     ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING user_id`,
    [email, displayName, workerId]
  );
  await client.query(`UPDATE app_user SET external_idp_subject = $1 WHERE user_id = $2`, [username, res.rows[0].user_id]);
  return res.rows[0].user_id;
}

async function grantRole(userId, roleCode, companyId, orgUnitId) {
  const role = await client.query(`SELECT role_id FROM role WHERE role_code = $1`, [roleCode]);
  await client.query(
    `INSERT INTO user_role (user_id, role_id, org_unit_id, company_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
    [userId, role.rows[0].role_id, orgUnitId, companyId]
  );
  await client.query(`INSERT INTO company_user_membership (company_id, user_id, is_primary) VALUES ($1,$2,FALSE) ON CONFLICT DO NOTHING`, [companyId, userId]);
}

async function main() {
  await client.connect();

  await client.query(`INSERT INTO role (role_code, role_name) VALUES ('HOD','Head of Department') ON CONFLICT (role_code) DO NOTHING`);

  // ---- Org hierarchy: three new Verticals alongside the real WTG-Daman branch ----
  const cweRoot = "c0000000-0000-0000-0000-000000000001";
  const bladeVertical = await upsertOrgUnit({ parentId: cweRoot, code: "BLADE-MFG", name: "Blade Manufacturing", levelCode: "VERTICAL" });
  const bladeLocation = await upsertOrgUnit({ parentId: bladeVertical, code: "BLADE-CHN", name: "Chennai Plant", levelCode: "LOCATION" });
  const bladeAssemblyDept = await upsertOrgUnit({ parentId: bladeLocation, code: "BLADE-ASM", name: "Blade Assembly", levelCode: "DEPARTMENT" });
  const qualityDept = await upsertOrgUnit({ parentId: bladeLocation, code: "QUALITY", name: "Quality & Inspection", levelCode: "DEPARTMENT" });

  const nacelleVertical = await upsertOrgUnit({ parentId: cweRoot, code: "NACELLE-MFG", name: "Nacelle Manufacturing", levelCode: "VERTICAL" });
  const nacelleLocation = await upsertOrgUnit({ parentId: nacelleVertical, code: "NACELLE-CHN", name: "Chennai Plant", levelCode: "LOCATION" });
  const nacelleDept = await upsertOrgUnit({ parentId: nacelleLocation, code: "NACELLE-ASM", name: "Nacelle Assembly", levelCode: "DEPARTMENT" });

  const towerVertical = await upsertOrgUnit({ parentId: cweRoot, code: "TOWER-CIVIL", name: "Tower & Civil", levelCode: "VERTICAL" });
  const towerLocation = await upsertOrgUnit({ parentId: towerVertical, code: "TOWER-CHN", name: "Chennai Plant", levelCode: "LOCATION" });
  const towerDept = await upsertOrgUnit({ parentId: towerLocation, code: "TOWER-ERC", name: "Tower Erection", levelCode: "DEPARTMENT" });

  console.log("Org hierarchy: Blade/Nacelle/Tower verticals seeded under CWE");

  // ---- Processes & levels (matches screenshot 19 exactly) ----
  const bra = await upsertProcess({ orgUnitId: bladeAssemblyDept, code: "BRA", name: "Blade Root Assembly", isCritical: true });
  const bta = await upsertProcess({ orgUnitId: bladeAssemblyDept, code: "BTA", name: "Blade Tip Assembly" });
  const fqc = await upsertProcess({ orgUnitId: qualityDept, code: "FQC", name: "Final QC Inspection" });
  const nel = await upsertProcess({ orgUnitId: nacelleDept, code: "NEL", name: "Nacelle Electrical" });
  const nbm = await upsertProcess({ orgUnitId: nacelleDept, code: "NBM", name: "Nacelle Mechanical" });
  const twr = await upsertProcess({ orgUnitId: towerDept, code: "TWR", name: "Tower Erection" });

  const braLevels = {
    E1: await upsertProcessLevel({ processId: bra, code: "E1", name: "Entry", ordinal: 1, primaryLevelCode: "L1", minPct: 60, headcount: 8 }),
    E2: await upsertProcessLevel({ processId: bra, code: "E2", name: "Skilled", ordinal: 2, primaryLevelCode: "L2", minPct: 65, headcount: 6 }),
    E3: await upsertProcessLevel({ processId: bra, code: "E3", name: "Proficient", ordinal: 3, primaryLevelCode: "L3", minPct: 75, headcount: 4 }),
    E4: await upsertProcessLevel({ processId: bra, code: "E4", name: "Advanced", ordinal: 4, primaryLevelCode: "L3", minPct: 80, headcount: 2 }),
    E5: await upsertProcessLevel({ processId: bra, code: "E5", name: "Expert", ordinal: 5, primaryLevelCode: "L4", minPct: 85, headcount: 1 }),
  };
  for (const [code, ord] of [["E1", 1], ["E2", 2], ["E3", 3]]) {
    await upsertProcessLevel({ processId: bta, code, name: code === "E1" ? "Entry" : code === "E2" ? "Skilled" : "Proficient", ordinal: ord, primaryLevelCode: `L${ord}`, minPct: 60 + ord * 5, headcount: 3 });
  }
  const nelLevels = {};
  for (const [code, ord, label] of [["S1", 1, "Entry"], ["S2", 2, "Skilled"], ["S3", 3, "Proficient"], ["S4", 4, "Expert"]]) {
    nelLevels[code] = await upsertProcessLevel({ processId: nel, code, name: label, ordinal: ord, primaryLevelCode: `L${ord}`, minPct: 55 + ord * 5, headcount: 4 });
  }
  const twrLevels = {};
  for (const [code, ord, label] of [["T1", 1, "Entry"], ["T2", 2, "Skilled"], ["T3", 3, "Proficient"]]) {
    twrLevels[code] = await upsertProcessLevel({ processId: twr, code, name: label, ordinal: ord, primaryLevelCode: `L${ord}`, minPct: 60 + ord * 5, headcount: 3 });
  }
  console.log("Processes & levels seeded: BRA(5) BTA(3) FQC(0) NEL(4) NBM(0) TWR(3)");

  // ---- Assessment library for BRA (matches screenshots 20-22) ----
  const braPractical = await upsertAssessmentDefinition({ name: "BRA Practical Evaluation", description: "Hands-on trainer observation at BRA workstation", componentType: "PRACTICAL" });
  await addItems(braPractical, [
    { type: "RATING_1_5", prompt: "Standard Work Adherence — Follows process steps in defined sequence without deviation" },
    { type: "RATING_1_5", prompt: "Standard Time Compliance — Completes task within allowable cycle time" },
    { type: "RATING_1_5", prompt: "Quality Check Execution — Performs in-process and end-of-process quality checks per control plan" },
    { type: "RATING_1_5", prompt: "Safety Protocol Compliance — Correctly uses PPE and follows all safety procedures throughout", critical: true },
    { type: "RATING_1_5", prompt: "Procedure Execution Accuracy — Refers to and accurately follows work instructions and torque spec sheets" },
    { type: "RATING_1_5", prompt: "Tool Handling & Care — Correct tool selection, calibration verification, and storage after use" },
    { type: "RATING_1_5", prompt: "Documentation Accuracy — Completes traveller card, QC records, and sign-offs accurately" },
  ]);

  const braTheory = await upsertAssessmentDefinition({ name: "BRA Process Knowledge Test", description: "Written/oral knowledge test on BRA process standards", componentType: "THEORY" });
  await addItems(braTheory, [
    { type: "RATING_1_5", prompt: "Explains bond gap measurement and specification limits" },
    { type: "RATING_1_5", prompt: "Explains calibrated-tool verification procedure before use" },
    { type: "RATING_1_5", prompt: "Explains M24 root flange bolt torque sequence and stages" },
    { type: "RATING_1_5", prompt: "Explains NCR raising criteria for out-of-spec bond gap" },
    { type: "RATING_1_5", prompt: "Explains traveller card and QC record completion requirements" },
  ]);

  const braBehaviour = await upsertAssessmentDefinition({ name: "BRA Behavioural Rating", description: "Supervisor-rated workplace behaviour assessment", componentType: "BEHAVIOURAL" });
  await addItems(braBehaviour, [
    { type: "RATING_1_5", prompt: "Attendance & Punctuality" },
    { type: "RATING_1_5", prompt: "Communication" },
    { type: "RATING_1_5", prompt: "Teamwork" },
    { type: "RATING_1_5", prompt: "Discipline" },
    { type: "RATING_1_5", prompt: "Professionalism" },
  ]);

  const braSelfQuiz = await upsertAssessmentDefinition({ name: "BRA Self-Assessment Quiz", description: "MCQ quiz for worker self-assessment — blade root assembly knowledge", componentType: "THEORY" });
  await addItems(braSelfQuiz, [
    {
      type: "MCQ_SINGLE", prompt: "What must be verified before using a torque wrench on root flange bolts?",
      options: [{ key: "A", text: "The colour of the wrench handle" }, { key: "B", text: "The calibration sticker validity date" }, { key: "C", text: "The wrench brand and model number" }, { key: "D", text: "The shift supervisor's approval" }],
      correct: ["B"], explanation: "Calibrated tools must be checked for a valid calibration sticker before use. An out-of-calibration tool must be tagged and removed from service immediately.",
    },
    {
      type: "MCQ_SINGLE", prompt: "What is the specified final torque for M24 root flange bolts as per WI-BRA-003?",
      options: [{ key: "A", text: "450 Nm" }, { key: "B", text: "620 Nm" }, { key: "C", text: "780 Nm" }, { key: "D", text: "1050 Nm" }],
      correct: ["C"], explanation: "Per WI-BRA-003, M24 root flange bolts are torqued to 780 Nm in two stages using a calibrated torque wrench.",
    },
    {
      type: "MCQ_SINGLE", prompt: "If bond gap measurement exceeds specification during root insert placement, what is the correct immediate action?",
      options: [{ key: "A", text: "Continue assembly and flag it in the traveller card" }, { key: "B", text: "Add extra adhesive to compensate" }, { key: "C", text: "Stop the process and raise an NCR for disposition by the QE" }, { key: "D", text: "Consult a colleague and decide on the spot" }],
      correct: ["C"], explanation: "Out-of-spec bond gap is a stop-and-escalate condition — raise an NCR for Quality Engineering disposition.",
    },
    {
      type: "MCQ_SINGLE", prompt: "What PPE is mandatory when handling uncured adhesive during root insert bonding?",
      options: [{ key: "A", text: "Safety glasses only" }, { key: "B", text: "Chemical-resistant gloves and safety glasses" }, { key: "C", text: "No PPE required, adhesive is inert" }, { key: "D", text: "Ear protection only" }],
      correct: ["B"], explanation: "Uncured adhesive is a skin/eye irritant — chemical-resistant gloves and safety glasses are mandatory.",
    },
    {
      type: "MCQ_SINGLE", prompt: "How is the root insert alignment verified before final bonding?",
      options: [{ key: "A", text: "Visual estimate only" }, { key: "B", text: "Using the calibrated alignment jig per WI-BRA-001" }, { key: "C", text: "By comparing to the previous blade" }, { key: "D", text: "Alignment is not checked at this stage" }],
      correct: ["B"], explanation: "WI-BRA-001 requires the calibrated alignment jig to verify root insert position before bonding.",
    },
    {
      type: "MCQ_SINGLE", prompt: "What is recorded on the traveller card at each process step?",
      options: [{ key: "A", text: "Operator signature and timestamp only" }, { key: "B", text: "Nothing, it is completed at the end of the shift" }, { key: "C", text: "Operator ID, timestamp, and measured values per the control plan" }, { key: "D", text: "Only rework events" }],
      correct: ["C"], explanation: "The traveller card is a live process record — operator ID, timestamp, and control-plan measurements at each step.",
    },
    {
      type: "MCQ_SINGLE", prompt: "Who is authorized to approve a deviation from WI-BRA-003 torque values?",
      options: [{ key: "A", text: "Any Assembly Technician" }, { key: "B", text: "The Quality Engineer or Process Owner only" }, { key: "C", text: "The worker's buddy" }, { key: "D", text: "No deviation is ever permitted, under any authority" }],
      correct: ["B"], explanation: "Torque spec deviations require Quality Engineering or Process Owner sign-off, not floor-level judgment.",
    },
    {
      type: "MCQ_SINGLE", prompt: "What is the correct response to a tool found out of calibration mid-shift?",
      options: [{ key: "A", text: "Continue using it for the rest of the shift" }, { key: "B", text: "Tag it out of service and report to the supervisor immediately" }, { key: "C", text: "Recalibrate it yourself using a reference bolt" }, { key: "D", text: "Use it only for non-critical bolts" }],
      correct: ["B"], explanation: "An out-of-calibration tool must be tagged out of service immediately and reported — never self-recalibrated on the floor.",
    },
    {
      type: "MCQ_SINGLE", prompt: "What does an 'NCR' raised during BRA assembly represent?",
      options: [{ key: "A", text: "A non-conformance report requiring quality disposition" }, { key: "B", text: "A new component request" }, { key: "C", text: "A night-crew rotation notice" }, { key: "D", text: "A normal completion record" }],
      correct: ["A"], explanation: "NCR = Non-Conformance Report, routed to Quality Engineering for disposition.",
    },
    {
      type: "MCQ_SINGLE", prompt: "Standard work time for a BRA sub-assembly is being exceeded. What is the first action?",
      options: [{ key: "A", text: "Rush remaining steps to catch up" }, { key: "B", text: "Flag to the supervisor and check for a blocking issue" }, { key: "C", text: "Skip the documentation step" }, { key: "D", text: "Do nothing, it is within tolerance" }],
      correct: ["B"], explanation: "A cycle-time overrun should be flagged, not absorbed by skipping steps — check for a root cause first.",
    },
  ]);

  await upsertPackage({
    processLevelId: braLevels.E2,
    components: [
      { definitionId: braPractical, weightPct: 45, gatePct: 65, mandatory: true },
      { definitionId: braTheory, weightPct: 30, mandatory: true },
      { definitionId: braBehaviour, weightPct: 25, mandatory: true },
      { definitionId: braSelfQuiz, weightPct: 0, gatePct: 60, mandatory: false, selfAssess: true },
    ],
  });
  const braE3Package = await upsertPackage({
    processLevelId: braLevels.E3,
    components: [
      { definitionId: braPractical, weightPct: 40, gatePct: 70, mandatory: true },
      { definitionId: braTheory, weightPct: 35, mandatory: true },
      { definitionId: braBehaviour, weightPct: 25, mandatory: true },
      { definitionId: braSelfQuiz, weightPct: 0, gatePct: 60, mandatory: false, selfAssess: true },
    ],
  });
  console.log("BRA assessment library + E2/E3 package links seeded");

  // ---- Role scope: who can take / evaluate the E3 package ----
  const roleIds = Object.fromEntries((await client.query(`SELECT role_id, role_code FROM role`)).rows.map((r) => [r.role_code, r.role_id]));
  for (const [roleCode, capacity] of [["EMPLOYEE", "CAN_TAKE"], ["SUPERVISOR", "CAN_EVALUATE"], ["ASSESSOR", "CAN_EVALUATE"], ["TRAINER", "CAN_EVALUATE"]]) {
    await client.query(
      `INSERT INTO assessment_role_scope (assessment_package_id, role_id, capacity) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [braE3Package, roleIds[roleCode], capacity]
    );
  }

  // ---- Approval policy: Supervisor -> HOD -> L&D, matching screenshot 08 ----
  const existingPolicy = await client.query(
    `SELECT approval_policy_id FROM approval_policy WHERE company_id = $1 AND process_id = $2 AND name = 'Standard Blade Assembly Approval Chain'`,
    [CWE, bra]
  );
  let policyId = existingPolicy.rows[0]?.approval_policy_id;
  if (!policyId) {
    const policyRes = await client.query(
      `INSERT INTO approval_policy (company_id, process_id, name) VALUES ($1,$2,'Standard Blade Assembly Approval Chain') RETURNING approval_policy_id`,
      [CWE, bra]
    );
    policyId = policyRes.rows[0].approval_policy_id;
    for (const [seq, roleCode, label] of [[1, "SUPERVISOR", "Supervisor"], [2, "HOD", "Head of Department"], [3, "LND_TEAM", "Learning & Development"]]) {
      await client.query(
        `INSERT INTO approval_policy_stage (approval_policy_id, sequence_no, role_id, stage_label) VALUES ($1,$2,$3,$4)`,
        [policyId, seq, roleIds[roleCode], label]
      );
    }
  }
  console.log("Approval policy seeded: Supervisor -> HOD -> L&D");

  // ---- Data sources (screenshot 26) ----
  const sources = [
    ["SAP_HR", "SAP HR", "HRMS", "Connected", "Primary HRMS for direct employees. Syncs personnel master, org assignment, date of joining, and cost centre.", ["Worker ID", "Name", "Designation", "Org Unit", "Date of Joining", "Cost Centre", "Employment Status"]],
    ["ORACLE_HCM", "Oracle HCM", "HRMS", "Connected", "Secondary HRMS used for Nacelle Manufacturing vertical. Syncs worker records and position data.", ["Employee Number", "Full Name", "Job Title", "Department", "Location", "Date of Joining"]],
    ["WORKDAY", "Workday", "HRMS", "Degraded", "Used for supervisory staff records. Last sync degraded — partial data received. Investigating API timeout.", ["Worker ID", "Name", "Manager", "Cost Centre", "Employment Type"]],
    ["VENDOR_PORTAL", "Vendor Portal", "EXTERNAL", "Connected", "Aggregated feed from registered labour contractors and specialised vendors. Workers flagged with vendor ID and contract dates.", ["Contractor ID", "Name", "Vendor Name", "Vendor Code", "Deployment Site", "Contract Start", "Contract End"]],
  ];
  const sourceIds = {};
  for (const [type, name, category, status, description, fields] of sources) {
    const res = await client.query(
      `INSERT INTO data_source (company_id, source_type, name, category, status, description, mapped_fields, last_success_sync_at, last_attempt_sync_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now(), now()) RETURNING data_source_id`,
      [CWE, type, name, category, status, description, fields]
    );
    sourceIds[type] = res.rows[0].data_source_id;
  }

  // ---- Named workers (matches Worker Master screenshot 04 exactly) ----
  const workers = [
    ["EMP-2847", "Rajesh", "Kumar", "Assembly Technician", "DIRECT", bladeAssemblyDept, "SAP_HR", "2021-03-01", bra, "E2"],
    ["EMP-3102", "Suresh", "Babu", "Assembly Technician", "CONTRACT", bladeAssemblyDept, "VENDOR_PORTAL", "2022-09-01", bra, "E1"],
    ["EMP-2208", "Mohammed", "Aziz", "Lead Technician", "DIRECT", bladeAssemblyDept, "SAP_HR", "2019-06-01", bra, "E4"],
    ["EMP-1955", "Priya", "Sundaram", "Senior Trainer", "DIRECT", bladeAssemblyDept, "SAP_HR", "2017-11-01", bra, "E5"],
    ["EMP-3045", "Kiran", "Raj", "Electrical Technician", "DIRECT", nacelleDept, "ORACLE_HCM", "2022-01-01", nel, "S2"],
    ["EMP-2611", "Lakshmi", "Narayanan", "QC Inspector", "DIRECT", qualityDept, "SAP_HR", "2020-04-01", null, null],
    ["EMP-3312", "Deepak", "Varma", "Site Technician", "VENDOR", towerDept, "VENDOR_PORTAL", "2023-03-01", twr, "T1"],
    ["EMP-2790", "Anitha", "Selvam", "Electrical Technician", "VENDOR", nacelleDept, "VENDOR_PORTAL", "2021-08-01", nel, "S3"],
    ["EMP-1830", "Ramesh", "Pillai", "Shift Supervisor", "DIRECT", bladeAssemblyDept, "WORKDAY", "2016-07-01", bra, "E3"],
  ];
  const workerIds = {};
  for (const [code, first, last, designation, empType, orgUnitId, sourceKey, joined, processId, levelCode] of workers) {
    const res = await client.query(
      `INSERT INTO worker (hrms_employee_code, employment_type, first_name, last_name, org_unit_id, company_id, data_source_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (hrms_employee_code) DO UPDATE SET first_name = EXCLUDED.first_name RETURNING worker_id`,
      [code, empType, first, last, orgUnitId, CWE, sourceIds[sourceKey], joined]
    );
    workerIds[code] = res.rows[0].worker_id;
    if (processId && levelCode) {
      const pl = await client.query(`SELECT process_level_id FROM process_level WHERE process_id = $1 AND code = $2`, [processId, levelCode]);
      await client.query(
        `INSERT INTO worker_process_enrollment (worker_id, process_id, current_process_level_id, source) VALUES ($1,$2,$3,'manual')
         ON CONFLICT (worker_id, process_id) DO UPDATE SET current_process_level_id = EXCLUDED.current_process_level_id`,
        [workerIds[code], processId, pl.rows[0].process_level_id]
      );
      await client.query(
        `INSERT INTO worker_process_skill (worker_id, process_id, process_level_id) VALUES ($1,$2,$3)
         ON CONFLICT (worker_id, process_id) DO UPDATE SET process_level_id = EXCLUDED.process_level_id`,
        [workerIds[code], processId, pl.rows[0].process_level_id]
      );
    }
  }
  console.log("9 named workers seeded, matching Worker Master screenshot");

  // Rajesh Kumar's self-assessment PIN (salted hash, never plaintext) — 1234 is
  // documented in-app as a demo-mode-only credential (prompt §5, §27).
  const { hash, salt } = hashPin("1234");
  await client.query(
    `INSERT INTO worker_verification_credential (worker_id, pin_hash, pin_salt) VALUES ($1,$2,$3)
     ON CONFLICT (worker_id) DO UPDATE SET pin_hash = EXCLUDED.pin_hash, pin_salt = EXCLUDED.pin_salt`,
    [workerIds["EMP-2847"], hash, salt]
  );

  // ---- Named staff users (screenshots 01, 08, 09, 25) ----
  const preethi = await upsertUser({ email: "cwec_admin@demo.oworkly.local", username: "cwec_admin", displayName: "Preethi Krishnan" });
  await grantRole(preethi, "ADMIN", CWE, cweRoot);
  await grantRole(preethi, "LND_TEAM", CWE, cweRoot);

  // Sunrise Solar Systems is "in setup" — zero processes/workers is the point —
  // but a single root Company org_unit is still needed so its admin's role can
  // be scoped to something (the schema's org_unit_id is part of a composite
  // PK, so it can't be left NULL even for a company with no hierarchy yet).
  const SSS = "22222222-2222-2222-2222-222222222222";
  await client.query(
    `INSERT INTO org_level_type (company_id, code, name, sequence) VALUES ($1,'COMPANY','Company',1) ON CONFLICT DO NOTHING`,
    [SSS]
  );
  const sssRoot = await upsertOrgUnitForCompany(SSS, "SSS", "Sunrise Solar Systems", "COMPANY", null);
  const sssAdmin = await upsertUser({ email: "sss_admin@demo.oworkly.local", username: "sss_admin", displayName: "Sunrise Solar Admin" });
  await grantRole(sssAdmin, "ADMIN", SSS, sssRoot);

  const arjun = await upsertUser({ email: "arjun_trainer@demo.oworkly.local", username: "arjun_trainer", displayName: "Arjun Tiwari" });
  await grantRole(arjun, "TRAINER", CWE, bladeAssemblyDept);
  await client.query(`INSERT INTO assessor_process_scope (user_id, process_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [arjun, bra]);

  const sunil = await upsertUser({ email: "sunil_trainer@demo.oworkly.local", username: "sunil_trainer", displayName: "Sunil Mehta" });
  await grantRole(sunil, "TRAINER", CWE, nacelleDept);
  await grantRole(sunil, "SUPERVISOR", CWE, bladeAssemblyDept);
  await client.query(`INSERT INTO assessor_process_scope (user_id, process_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [sunil, nel]);
  await client.query(`INSERT INTO assessor_process_scope (user_id, process_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [sunil, bra]);

  const rajiv = await upsertUser({ email: "rajiv_hod@demo.oworkly.local", username: "rajiv_hod", displayName: "Rajiv Desai" });
  await grantRole(rajiv, "HOD", CWE, bladeAssemblyDept);

  console.log("Named staff users seeded: Preethi Krishnan, Sunrise Solar Admin, Arjun Tiwari, Sunil Mehta, Rajiv Desai");

  console.log("\n=== Figma demo seed complete ===");
  await client.end();
}

main().catch(async (err) => {
  console.error(err);
  await client.end();
  process.exit(1);
});
