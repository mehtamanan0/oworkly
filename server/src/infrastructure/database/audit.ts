// Immutable audit trail. The runtime DB role (see migration 0010) has
// UPDATE/DELETE revoked on audit_log, so this table is genuinely
// append-only, not just "nothing in the code path updates it".
// Accepts anything query-shaped (a pg Pool or a checked-out PoolClient) so
// call sites outside an explicit transaction don't need to fake a PoolClient.
export interface Queryable {
  query: (text: string, params?: unknown[]) => Promise<unknown>;
}

export interface AuditParams {
  entityName: string;
  entityId: string;
  action: "INSERT" | "UPDATE" | "STATUS_CHANGE" | "DELETE";
  actorUserId: string | null;
  source?: "web" | "mobile" | "api_sync" | "system";
  before?: unknown;
  after?: unknown;
  reason?: string;
  correlationId?: string;
}

export async function recordAudit(db: Queryable, params: AuditParams) {
  await db.query(
    `INSERT INTO audit_log (entity_name, entity_id, action, changed_by, changed_via, before_json, after_json, reason, correlation_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      params.entityName,
      params.entityId,
      params.action,
      params.actorUserId,
      params.source ?? "web",
      params.before ? JSON.stringify(params.before) : null,
      params.after ? JSON.stringify(params.after) : null,
      params.reason ?? null,
      params.correlationId ?? null,
    ]
  );
}
