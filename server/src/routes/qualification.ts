import { Router } from "express";
import { query, queryOne } from "../db.js";
import { asyncHandler, ApiError } from "../lib/asyncHandler.js";
import { withIdempotency } from "../infrastructure/database/idempotency.js";
import * as qualificationCaseService from "../application/services/qualificationCaseService.js";
import * as approvalService from "../application/services/approvalService.js";
import * as certificationService from "../application/services/certificationService.js";

export const qualificationRouter = Router();

function currentUserOrThrow(req: any) {
  if (!req.currentUser) throw new ApiError(401, "Not authenticated");
  return req.currentUser;
}

qualificationRouter.post(
  "/qualification-cases",
  withIdempotency("qualification-cases:create", asyncHandler(async (req, res) => {
    const user = currentUserOrThrow(req);
    const { workerId, processId, targetProcessLevelId } = req.body;
    const qcase = await qualificationCaseService.createOrGetCase(workerId, processId, targetProcessLevelId, user);
    res.status(201).json(qcase);
  }))
);

// Backs the Trainer Dashboard's "Certifications Expiring" table with real
// rows (the dashboard/trainer summary endpoint only returns a count).
qualificationRouter.get(
  "/certificates/expiring",
  asyncHandler(async (req, res) => {
    const user = currentUserOrThrow(req);
    const days = Number(req.query.days ?? 30);
    const params: any[] = [days];
    const clauses: string[] = [`c.status = 'active'`, `c.valid_to <= CURRENT_DATE + ($1 || ' days')::interval`];
    if (user.companyId) { params.push(user.companyId); clauses.push(`w.company_id = $${params.length}`); }
    const rows = await query<any>(
      `SELECT c.certificate_id, c.certificate_number, c.valid_to, w.worker_id, w.first_name, w.last_name, w.hrms_employee_code,
              p.name AS process_name, pl.code AS level_code
       FROM certificate c
       JOIN worker w ON w.worker_id = c.worker_id
       JOIN process p ON p.process_id = c.process_id
       LEFT JOIN process_level pl ON pl.process_level_id = c.certified_process_level_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY c.valid_to ASC LIMIT 50`,
      params
    );
    res.json(rows);
  })
);

// Backs the dashboard's Assessment Queue / Retests Due / Approvals Pending
// tiles and the Qualifications nav dropdown with a real, clickable list
// instead of a static count — company-scoped, optionally filtered by status
// (repeatable query param, e.g. ?status=PENDING_APPROVAL&status=RETURNED_FOR_REVIEW).
qualificationRouter.get(
  "/qualification-cases",
  asyncHandler(async (req, res) => {
    const user = currentUserOrThrow(req);
    const statuses = ([] as string[]).concat((req.query.status as string | string[]) ?? []);
    const params: any[] = [];
    const clauses: string[] = [];
    if (user.companyId) { params.push(user.companyId); clauses.push(`qc.company_id = $${params.length}`); }
    if (statuses.length) { params.push(statuses); clauses.push(`qc.status = ANY($${params.length})`); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await query<any>(
      `SELECT qc.qualification_case_id, qc.status, qc.qualification_number, qc.created_at, qc.updated_at,
              w.worker_id, w.first_name, w.last_name, w.hrms_employee_code,
              p.name AS process_name, p.code AS process_code,
              fl.code AS from_level_code, tl.code AS target_level_code
       FROM qualification_case qc
       JOIN worker w ON w.worker_id = qc.worker_id
       JOIN process p ON p.process_id = qc.process_id
       LEFT JOIN process_level fl ON fl.process_level_id = qc.from_process_level_id
       JOIN process_level tl ON tl.process_level_id = qc.target_process_level_id
       ${where} ORDER BY qc.updated_at DESC LIMIT 200`,
      params
    );
    res.json(rows);
  })
);

qualificationRouter.get(
  "/qualification-cases/:id",
  asyncHandler(async (req, res) => {
    const user = currentUserOrThrow(req);
    const qcase = await queryOne<any>(
      `SELECT qc.*, w.first_name, w.last_name, w.hrms_employee_code, p.name AS process_name,
              fl.code AS from_level_code, tl.code AS target_level_code, tl.name AS target_level_name,
              tl.min_qualification_score_pct AS target_min_qualification_score_pct
       FROM qualification_case qc
       JOIN worker w ON w.worker_id = qc.worker_id
       JOIN process p ON p.process_id = qc.process_id
       LEFT JOIN process_level fl ON fl.process_level_id = qc.from_process_level_id
       JOIN process_level tl ON tl.process_level_id = qc.target_process_level_id
       WHERE qc.qualification_case_id = $1`,
      [req.params.id]
    );
    if (!qcase) throw new ApiError(404, "Qualification case not found");
    if (user.companyId && user.companyId !== qcase.company_id) throw new ApiError(403, "Cross-company access is not permitted");

    const components = await query<any>(
      `SELECT apc.*, ad.name, ad.description, ad.assessment_type,
              (SELECT count(*) FROM question ai WHERE ai.assessment_id = apc.assessment_id AND ai.is_active AND ai.review_status = 'approved')::int AS item_count,
              (SELECT coalesce(sum(max_score),0) FROM question ai WHERE ai.assessment_id = apc.assessment_id AND ai.is_active AND ai.review_status = 'approved') AS max_total_score
       FROM assessment_template_assessment apc
       JOIN assessment ad ON ad.assessment_id = apc.assessment_id
       WHERE apc.assessment_template_id = $1 ORDER BY apc.sequence_no`,
      [qcase.assessment_template_id]
    );
    const attempts = await query<any>(`SELECT * FROM assessment_attempt WHERE qualification_case_id = $1 ORDER BY attempt_no DESC`, [req.params.id]);
    const result = await queryOne<any>(`SELECT * FROM qualification_result WHERE qualification_case_id = $1 ORDER BY decided_at DESC LIMIT 1`, [req.params.id]);
    let componentResults: any[] = [];
    let ruleChecks: any[] = [];
    if (result) {
      componentResults = await query<any>(
        `SELECT qcr.*, ad.name FROM qualification_component_result qcr
         JOIN assessment_attempt_section aca ON aca.assessment_attempt_section_id = qcr.assessment_attempt_section_id
         JOIN assessment_template_assessment apc ON apc.assessment_template_assessment_id = aca.assessment_template_assessment_id
         JOIN assessment ad ON ad.assessment_id = apc.assessment_id
         WHERE qcr.qualification_result_id = $1`,
        [result.qualification_result_id]
      );
      ruleChecks = await query<any>(`SELECT * FROM qualification_rule_check WHERE qualification_result_id = $1`, [result.qualification_result_id]);
    }
    const certificate = await queryOne<any>(`SELECT * FROM certificate WHERE qualification_case_id = $1`, [req.params.id]);
    if (certificate) {
      // The certificate screen (Figma 09) shows three distinct real people —
      // issuing authority, approver, and trainer — but the certificate row
      // itself only stores one approver_user_id (whoever called /certify).
      // Resolve the other two from data that actually exists rather than
      // reusing the same name three times or inventing one.
      const issuer = await queryOne<any>(`SELECT display_name FROM app_user WHERE user_id = $1`, [certificate.approver_user_id]);
      const hodApproval = await queryOne<any>(
        `SELECT u.display_name FROM qualification_approval_action qaa
         JOIN approval_policy_stage aps ON aps.approval_policy_stage_id = qaa.approval_policy_stage_id
         JOIN role r ON r.role_id = aps.role_id
         JOIN qualification_approval_instance qai ON qai.qualification_approval_instance_id = qaa.qualification_approval_instance_id
         JOIN app_user u ON u.user_id = qaa.resolved_approver_user_id
         WHERE qai.qualification_case_id = $1 AND r.role_code = 'HOD' AND qaa.action = 'approved'
         ORDER BY qaa.acted_at DESC LIMIT 1`,
        [req.params.id]
      );
      const trainer = await queryOne<any>(
        `SELECT u.display_name FROM assessment_attempt_section aca
         JOIN assessment_template_assessment apc ON apc.assessment_template_assessment_id = aca.assessment_template_assessment_id
         JOIN app_user u ON u.user_id = aca.evaluator_user_id
         WHERE aca.assessment_attempt_id IN (SELECT assessment_attempt_id FROM assessment_attempt WHERE qualification_case_id = $1)
           AND apc.self_assessment_enabled = false
         ORDER BY aca.scored_at DESC LIMIT 1`,
        [req.params.id]
      );
      certificate.issuingAuthorityName = issuer?.display_name ?? null;
      certificate.approvedByName = hodApproval?.display_name ?? null;
      certificate.trainerName = trainer?.display_name ?? null;
    }
    res.json({ ...qcase, components, attempts, result, componentResults, ruleChecks, certificate });
  })
);

qualificationRouter.post(
  "/qualification-cases/:id/attempts",
  withIdempotency("qualification-cases:start-attempt", asyncHandler(async (req, res) => {
    const user = currentUserOrThrow(req);
    const attempt = await qualificationCaseService.startAttempt(req.params.id, user, req.body?.clientIdempotencyKey);
    res.status(201).json(attempt);
  }))
);

qualificationRouter.get(
  "/assessment-attempts/:id",
  asyncHandler(async (req, res) => {
    const componentAttempts = await query<any>(
      `SELECT ca.*, apc.assessment_id, apc.weight_pct, apc.min_gate_pct, apc.is_mandatory, apc.self_assessment_enabled, ad.name, ad.assessment_type
       FROM assessment_attempt_section ca
       JOIN assessment_template_assessment apc ON apc.assessment_template_assessment_id = ca.assessment_template_assessment_id
       JOIN assessment ad ON ad.assessment_id = apc.assessment_id
       WHERE ca.assessment_attempt_id = $1 ORDER BY apc.sequence_no`,
      [req.params.id]
    );
    const attempt = await queryOne<any>(
      `SELECT aa.*, qc.process_id, qc.target_process_level_id
       FROM assessment_attempt aa JOIN qualification_case qc ON qc.qualification_case_id = aa.qualification_case_id
       WHERE aa.assessment_attempt_id = $1`,
      [req.params.id]
    );
    if (!attempt) throw new ApiError(404, "Attempt not found");
    res.json({ ...attempt, componentAttempts });
  })
);

qualificationRouter.get(
  "/assessment-attempt-sections/:id/items",
  asyncHandler(async (req, res) => {
    const componentAttempt = await queryOne<any>(
      `SELECT apc.assessment_id FROM assessment_attempt_section ca
       JOIN assessment_template_assessment apc ON apc.assessment_template_assessment_id = ca.assessment_template_assessment_id
       WHERE ca.assessment_attempt_section_id = $1`,
      [req.params.id]
    );
    if (!componentAttempt) throw new ApiError(404, "Component attempt not found");
    const items = await query<any>(
      `SELECT question_id, question_type, prompt, options_json, max_score, rating_scale_max, is_critical, evaluator_capacity, requires_assessor_remark, sequence_no
       FROM question WHERE assessment_id = $1 AND is_active AND review_status = 'approved' ORDER BY sequence_no`,
      [componentAttempt.assessment_id]
    );
    res.json(items);
  })
);

qualificationRouter.post(
  "/assessment-attempt-sections/:id/check-item",
  asyncHandler(async (req, res) => {
    const user = currentUserOrThrow(req);
    const { questionId, responseJson } = req.body as { questionId: string; responseJson: unknown };
    const result = await qualificationCaseService.checkItem(req.params.id, questionId, responseJson, user);
    res.json(result);
  })
);

qualificationRouter.post(
  "/assessment-attempt-sections/:id/score",
  withIdempotency("assessment-attempt-sections:score", asyncHandler(async (req, res) => {
    const user = currentUserOrThrow(req);
    const { responses } = req.body as { responses: { questionId: string; score: number; responseJson?: unknown; assessorRemark?: string; evidenceFileId?: string }[] };
    const result = await qualificationCaseService.scoreComponent(req.params.id, responses, user);
    res.json(result);
  }))
);

qualificationRouter.post(
  "/assessment-attempts/:id/finalize",
  withIdempotency("assessment-attempts:finalize", asyncHandler(async (req, res) => {
    const user = currentUserOrThrow(req);
    const result = await qualificationCaseService.finalizeAttempt(req.params.id, user);
    res.json(result);
  }))
);

qualificationRouter.get(
  "/qualification-cases/:id/approval",
  asyncHandler(async (req, res) => {
    const status = await approvalService.getApprovalStatus(req.params.id);
    res.json(status);
  })
);

qualificationRouter.post(
  "/qualification-cases/:id/approval/:stageSequence/act",
  withIdempotency("qualification-cases:approval-act", asyncHandler(async (req, res) => {
    const user = currentUserOrThrow(req);
    const { action, remarks, clientIdempotencyKey } = req.body as { action: "approved" | "returned"; remarks?: string; clientIdempotencyKey?: string };
    const result = await approvalService.actOnApproval(req.params.id, Number(req.params.stageSequence), action, user, remarks, clientIdempotencyKey);
    res.json(result);
  }))
);

qualificationRouter.post(
  "/qualification-cases/:id/certify",
  withIdempotency("qualification-cases:certify", asyncHandler(async (req, res) => {
    const user = currentUserOrThrow(req);
    const cert = await certificationService.issueCertificate(req.params.id, user);
    res.status(201).json(cert);
  }))
);

qualificationRouter.post(
  "/certificates/:id/revoke",
  asyncHandler(async (req, res) => {
    const user = currentUserOrThrow(req);
    await certificationService.revokeCertificate(req.params.id, req.body?.reason, user);
    res.json({ status: "revoked" });
  })
);
