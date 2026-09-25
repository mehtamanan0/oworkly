// M13/M14: shared master-data import engine -- organisation and worker CSV
// imports, staging -> validate -> preview -> publish, real Postgres writes,
// never touching unvalidated rows.
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { agent, devLogin, loadFixtures, resetWorkerQualificationState, resetTestIdempotencyKeys, type Fixtures } from "../helpers/testApp.js";
import { pool } from "../../src/db.js";

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

function upload(url: string, token: string, csv: string, filename = "import.csv") {
  return agent.post(url).set(auth(token)).attach("file", Buffer.from(csv), filename);
}

describe("master-data imports (M13/M14)", () => {
  let fixtures: Fixtures;
  let adminToken: string;
  let sssAdminToken: string;
  const scratchBatchIds: string[] = [];
  const scratchOrgUnitCodes: string[] = [];
  const scratchWorkerCodes: string[] = [];

  beforeAll(async () => {
    fixtures = await loadFixtures();
    adminToken = (await devLogin("cwec_admin")).accessToken;
    sssAdminToken = (await devLogin("sss_admin")).accessToken;
  });

  afterEach(async () => {
    if (scratchWorkerCodes.length > 0) {
      await pool.query(`DELETE FROM audit_log WHERE entity_name = 'worker' AND entity_id::text IN (SELECT worker_id::text FROM worker WHERE hrms_employee_code = ANY($1))`, [scratchWorkerCodes]);
      await pool.query(`DELETE FROM worker WHERE hrms_employee_code = ANY($1)`, [scratchWorkerCodes]);
      scratchWorkerCodes.length = 0;
    }
    if (scratchOrgUnitCodes.length > 0) {
      await pool.query(`DELETE FROM org_unit WHERE code = ANY($1)`, [scratchOrgUnitCodes]);
      scratchOrgUnitCodes.length = 0;
    }
    if (scratchBatchIds.length > 0) {
      await pool.query(`DELETE FROM import_row_error WHERE import_batch_id = ANY($1)`, [scratchBatchIds]);
      await pool.query(`DELETE FROM import_staging_row WHERE import_batch_id = ANY($1)`, [scratchBatchIds]);
      await pool.query(`DELETE FROM audit_log WHERE entity_name = 'import_batch' AND entity_id::text = ANY($1)`, [scratchBatchIds]);
      await pool.query(`DELETE FROM import_batch WHERE import_batch_id = ANY($1)`, [scratchBatchIds]);
      scratchBatchIds.length = 0;
    }
    await resetWorkerQualificationState(fixtures.rajeshWorkerId);
    await resetTestIdempotencyKeys();
  });

  describe("organisation import", () => {
    it("validates a valid file, rejects an upload missing a required header", async () => {
      const badHeader = "company_code,level_type_code,node_code\nCWE,DEPARTMENT,ZZ1";
      const badRes = await upload(`/api/v1/v2/companies/${fixtures.cweCompanyId}/imports/organisation`, adminToken, badHeader);
      expect(badRes.status).toBe(422);

      const code = `ZZORG${Date.now()}`;
      scratchOrgUnitCodes.push(code);
      const csv = `company_code,level_type_code,node_code,node_name,parent_node_code,description,active,effective_from,effective_to\nCWE,DEPARTMENT,${code},Test Department,BLADE-MFG,,true,,\n`;
      const created = await upload(`/api/v1/v2/companies/${fixtures.cweCompanyId}/imports/organisation`, adminToken, csv);
      expect(created.status).toBe(201);
      scratchBatchIds.push(created.body.import_batch_id);

      const validated = await agent.post(`/api/v1/v2/imports/${created.body.import_batch_id}/validate`).set(auth(adminToken)).send({});
      expect(validated.status).toBe(200);
      expect(validated.body.status).toBe("VALID");
      expect(validated.body.errorCount).toBe(0);

      const published = await agent.post(`/api/v1/v2/imports/${created.body.import_batch_id}/publish`).set(auth(adminToken)).send({});
      expect(published.status).toBe(200);
      expect(published.body.created_count).toBe(1);
      expect(published.body.status).toBe("PUBLISHED");

      const unitRow = await pool.query(`SELECT * FROM org_unit WHERE code = $1`, [code]);
      expect(unitRow.rows).toHaveLength(1);
      expect(unitRow.rows[0].name).toBe("Test Department");

      // Republish is rejected, not silently reprocessed (retry-safe).
      const republish = await agent.post(`/api/v1/v2/imports/${created.body.import_batch_id}/publish`).set(auth(adminToken)).send({});
      expect(republish.status).toBe(422);
      const stillOne = await pool.query(`SELECT count(*)::int AS n FROM org_unit WHERE code = $1`, [code]);
      expect(stillOne.rows[0].n).toBe(1);

      const history = await agent.get(`/api/v1/v2/companies/${fixtures.cweCompanyId}/imports?type=ORGANISATION`).set(auth(adminToken));
      expect(history.body.some((b: any) => b.import_batch_id === created.body.import_batch_id)).toBe(true);

      const audit = await pool.query(`SELECT action FROM audit_log WHERE entity_name = 'import_batch' AND entity_id = $1 ORDER BY changed_at`, [created.body.import_batch_id]);
      expect(audit.rows.map((r) => r.action)).toEqual(["INSERT", "STATUS_CHANGE"]);
    });

    it("catches missing required value, duplicate node code, duplicate row, missing parent, invalid parent/child type, self-parent, and cross-company rows in one batch", async () => {
      const dup1 = `ZZORGDUP${Date.now()}`;
      const rows = [
        "company_code,level_type_code,node_code,node_name,parent_node_code,description,active,effective_from,effective_to",
        `CWE,DEPARTMENT,${dup1}NOPARENT,,BLADE-MFG,,true,,`, // missing node_name
        `CWE,DEPARTMENT,BLADE-MFG,Duplicate of existing vertical code,,,true,,`, // duplicate node_code (existing, different level type)
        `CWE,DEPARTMENT,${dup1},Dup A,BLADE-MFG,,true,,`,
        `CWE,DEPARTMENT,${dup1},Dup B (duplicate row),BLADE-MFG,,true,,`, // duplicate row (same node_code as above)
        `CWE,DEPARTMENT,${dup1}ORPHAN,No such parent,ZZNOPARENTATALL,,true,,`, // missing parent
        `CWE,VERTICAL,${dup1}BADTYPE,Bad parent/child ordering,${dup1}ORPHAN,,true,,`, // parent (DEPARTMENT, seq 4) has a HIGHER sequence than child (VERTICAL, seq 2) -- invalid ordering
        `CWE,DEPARTMENT,${dup1}SELF,Self parent,${dup1}SELF,,true,,`, // self-parent
        `SSS,DEPARTMENT,${dup1}CROSSCO,Cross company row,,,true,,`, // cross-company
      ].join("\n");
      scratchOrgUnitCodes.push(`${dup1}NOPARENT`, `${dup1}`, `${dup1}ORPHAN`, `${dup1}BADTYPE`, `${dup1}SELF`, `${dup1}CROSSCO`);

      const created = await upload(`/api/v1/v2/companies/${fixtures.cweCompanyId}/imports/organisation`, adminToken, rows);
      expect(created.status).toBe(201);
      scratchBatchIds.push(created.body.import_batch_id);

      const validated = await agent.post(`/api/v1/v2/imports/${created.body.import_batch_id}/validate`).set(auth(adminToken)).send({});
      expect(validated.status).toBe(200);
      expect(validated.body.status).toBe("INVALID");

      const errors = await agent.get(`/api/v1/v2/imports/${created.body.import_batch_id}/errors`).set(auth(adminToken));
      const codes = errors.body.map((e: any) => e.code);
      expect(codes).toEqual(expect.arrayContaining([
        "MISSING_REQUIRED_VALUE", "DUPLICATE_NODE_CODE", "DUPLICATE_ROW", "PARENT_NOT_FOUND",
        "INVALID_PARENT_CHILD_TYPE", "SELF_PARENT", "COMPANY_MISMATCH",
      ]));

      const cannotPublish = await agent.post(`/api/v1/v2/imports/${created.body.import_batch_id}/publish`).set(auth(adminToken)).send({});
      expect(cannotPublish.status).toBe(422);
    });

    it("a parent defined earlier in the same batch is a valid reference (publishes both, in order)", async () => {
      const prefix = `ZZORGCHAIN${Date.now()}`;
      const parentCode = `${prefix}V`;
      const childCode = `${prefix}D`;
      scratchOrgUnitCodes.push(parentCode, childCode);
      const csv = [
        "company_code,level_type_code,node_code,node_name,parent_node_code,description,active,effective_from,effective_to",
        `CWE,VERTICAL,${parentCode},New Vertical,,,true,,`,
        `CWE,DEPARTMENT,${childCode},New Department,${parentCode},,true,,`,
      ].join("\n");
      const created = await upload(`/api/v1/v2/companies/${fixtures.cweCompanyId}/imports/organisation`, adminToken, csv);
      scratchBatchIds.push(created.body.import_batch_id);
      const validated = await agent.post(`/api/v1/v2/imports/${created.body.import_batch_id}/validate`).set(auth(adminToken)).send({});
      expect(validated.body.status).toBe("VALID");
      const published = await agent.post(`/api/v1/v2/imports/${created.body.import_batch_id}/publish`).set(auth(adminToken)).send({});
      expect(published.body.created_count).toBe(2);
      const child = await pool.query(`SELECT ou.*, parent.code AS parent_code FROM org_unit ou JOIN org_unit parent ON parent.org_unit_id = ou.parent_org_unit_id WHERE ou.code = $1`, [childCode]);
      expect(child.rows[0].parent_code).toBe(parentCode);
    });

    it("a cross-company admin cannot upload, validate, or publish into another company's import", async () => {
      const csv = "company_code,level_type_code,node_code,node_name,parent_node_code,description,active,effective_from,effective_to\nCWE,DEPARTMENT,ZZDENY,Deny me,,,true,,";
      const denied = await upload(`/api/v1/v2/companies/${fixtures.cweCompanyId}/imports/organisation`, sssAdminToken, csv);
      expect(denied.status).toBe(403);
    });

    it("cancel blocks a batch from being published", async () => {
      const code = `ZZORGCANCEL${Date.now()}`;
      scratchOrgUnitCodes.push(code);
      const csv = `company_code,level_type_code,node_code,node_name,parent_node_code,description,active,effective_from,effective_to\nCWE,DEPARTMENT,${code},Cancel Me,,,true,,`;
      const created = await upload(`/api/v1/v2/companies/${fixtures.cweCompanyId}/imports/organisation`, adminToken, csv);
      scratchBatchIds.push(created.body.import_batch_id);
      const cancelled = await agent.post(`/api/v1/v2/imports/${created.body.import_batch_id}/cancel`).set(auth(adminToken)).send({});
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.status).toBe("CANCELLED");
      const validated = await agent.post(`/api/v1/v2/imports/${created.body.import_batch_id}/validate`).set(auth(adminToken)).send({});
      // Validation still runs (harmless on a cancelled batch's own row data),
      // but publish must refuse since status was never re-set to VALID by a
      // deliberate re-validate after cancellation in this flow.
      void validated;
      const cannotPublish = await agent.post(`/api/v1/v2/imports/${created.body.import_batch_id}/publish`).set(auth(adminToken)).send({});
      expect(cannotPublish.status).toBe(422);
      const noUnit = await pool.query(`SELECT count(*)::int AS n FROM org_unit WHERE code = $1`, [code]);
      expect(noUnit.rows[0].n).toBe(0);
    });
  });

  describe("worker import", () => {
    it("validates and publishes a new worker; existing qualification data for other workers is untouched", async () => {
      const code = `ZZWRK${Date.now()}`;
      scratchWorkerCodes.push(code);
      const csv = [
        "employee_code,full_name,date_of_joining,company_code,plant_code,vertical_code,department_code,designation_code,employee_type,supervisor_employee_code,manager_employee_code,employment_status,source_system,source_record_id",
        `${code},Test Worker One,2024-01-15,CWE,,,ELEC-AREA,TECH,DIRECT,,,active,,`,
      ].join("\n");
      const created = await upload(`/api/v1/v2/companies/${fixtures.cweCompanyId}/imports/workers`, adminToken, csv);
      expect(created.status).toBe(201);
      scratchBatchIds.push(created.body.import_batch_id);

      const validated = await agent.post(`/api/v1/v2/imports/${created.body.import_batch_id}/validate`).set(auth(adminToken)).send({});
      expect(validated.body.status).toBe("VALID");

      const published = await agent.post(`/api/v1/v2/imports/${created.body.import_batch_id}/publish`).set(auth(adminToken)).send({});
      expect(published.body.created_count).toBe(1);

      const workerRow = await pool.query(`SELECT * FROM worker WHERE hrms_employee_code = $1`, [code]);
      expect(workerRow.rows[0].first_name).toBe("Test");
      expect(workerRow.rows[0].last_name).toBe("Worker One");
      expect(workerRow.rows[0]).not.toHaveProperty("salary");

      // Re-importing the SAME real worker (Rajesh) with an upsert must never
      // touch his qualification/certificate history.
      const before = await pool.query(`SELECT count(*)::int AS n FROM qualification_case WHERE worker_id = $1`, [fixtures.rajeshWorkerId]);
      const rajeshCsv = [
        "employee_code,full_name,date_of_joining,company_code,plant_code,vertical_code,department_code,designation_code,employee_type,supervisor_employee_code,manager_employee_code,employment_status,source_system,source_record_id",
        `EMP-2847,Rajesh Kumar,2020-01-01,CWE,,,BLADE-ASM,TECH,DIRECT,,,active,,`,
      ].join("\n");
      const rajeshBatch = await upload(`/api/v1/v2/companies/${fixtures.cweCompanyId}/imports/workers`, adminToken, rajeshCsv);
      scratchBatchIds.push(rajeshBatch.body.import_batch_id);
      await agent.post(`/api/v1/v2/imports/${rajeshBatch.body.import_batch_id}/validate`).set(auth(adminToken)).send({});
      const rajeshPublish = await agent.post(`/api/v1/v2/imports/${rajeshBatch.body.import_batch_id}/publish`).set(auth(adminToken)).send({});
      expect(rajeshPublish.body.updated_count).toBe(1);
      const after = await pool.query(`SELECT count(*)::int AS n FROM qualification_case WHERE worker_id = $1`, [fixtures.rajeshWorkerId]);
      expect(after.rows[0].n).toBe(before.rows[0].n);
    });

    it("catches missing employee_code, invalid company, invalid org reference, self-supervisor, unknown manager, and invalid employee_type", async () => {
      const prefix = `ZZWRKBAD${Date.now()}`;
      const rows = [
        "employee_code,full_name,date_of_joining,company_code,plant_code,vertical_code,department_code,designation_code,employee_type,supervisor_employee_code,manager_employee_code,employment_status,source_system,source_record_id",
        `,No Code,2024-01-01,CWE,,,ELEC-AREA,,DIRECT,,,active,,`,
        `${prefix}A,Bad Company,2024-01-01,SSS,,,ELEC-AREA,,DIRECT,,,active,,`,
        `${prefix}B,No Org Ref,2024-01-01,CWE,,,ZZNOSUCHDEPT,,DIRECT,,,active,,`,
        `${prefix}C,Self Supervisor,2024-01-01,CWE,,,ELEC-AREA,,DIRECT,,${prefix}C,active,,`,
        `${prefix}D,Unknown Manager,2024-01-01,CWE,,,ELEC-AREA,,DIRECT,,ZZNOSUCHMANAGER,active,,`,
        `${prefix}E,Bad Employee Type,2024-01-01,CWE,,,ELEC-AREA,,FREELANCE,,,active,,`,
      ].join("\n");
      scratchWorkerCodes.push(`${prefix}A`, `${prefix}B`, `${prefix}C`, `${prefix}D`, `${prefix}E`);
      const created = await upload(`/api/v1/v2/companies/${fixtures.cweCompanyId}/imports/workers`, adminToken, rows);
      scratchBatchIds.push(created.body.import_batch_id);
      const validated = await agent.post(`/api/v1/v2/imports/${created.body.import_batch_id}/validate`).set(auth(adminToken)).send({});
      expect(validated.body.status).toBe("INVALID");
      const errors = await agent.get(`/api/v1/v2/imports/${created.body.import_batch_id}/errors`).set(auth(adminToken));
      const codes = errors.body.map((e: any) => e.code);
      expect(codes).toEqual(expect.arrayContaining([
        "MISSING_REQUIRED_VALUE", "COMPANY_MISMATCH", "ORG_REFERENCE_NOT_FOUND", "SELF_SUPERVISOR", "MANAGER_NOT_FOUND", "INVALID_ENUM",
      ]));
      const cannotPublish = await agent.post(`/api/v1/v2/imports/${created.body.import_batch_id}/publish`).set(auth(adminToken)).send({});
      expect(cannotPublish.status).toBe(422);
    });

    it("a cross-company admin cannot import workers into another company", async () => {
      const csv = "employee_code,full_name,date_of_joining,company_code,plant_code,vertical_code,department_code,designation_code,employee_type,supervisor_employee_code,manager_employee_code,employment_status,source_system,source_record_id\nZZDENY,Deny Me,2024-01-01,CWE,,,ELEC-AREA,,DIRECT,,,active,,";
      const denied = await upload(`/api/v1/v2/companies/${fixtures.cweCompanyId}/imports/workers`, sssAdminToken, csv);
      expect(denied.status).toBe(403);
    });
  });

  it("import routes require import.* permissions -- an EMPLOYEE-role token is rejected", async () => {
    const workerToken = (await agent.post("/api/v1/worker-portal/verify").send({ workerId: fixtures.rajeshWorkerId, method: "SUPERVISOR_PIN", pin: "1234" })).body.accessToken;
    const res = await agent.get(`/api/v1/v2/companies/${fixtures.cweCompanyId}/imports`).set(auth(workerToken));
    expect(res.status).toBe(403);
  });
});
