// Generic idempotency wrapper used by every write endpoint the spec lists
// (attempt creation, submissions, approvals, certificate issuance, ingestion/
// AI job creation, activity completion). The same request repeated after a
// timeout replays the original stored result instead of creating a duplicate
// or racing — proven under concurrent requests in tests/integration/idempotency.test.ts.
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { pool } from "../../db.js";

export function withIdempotency(endpoint: string, handler: RequestHandler): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = (req.headers["idempotency-key"] as string) || (req.body?.clientIdempotencyKey as string);
    if (!key) return handler(req, res, next); // idempotency is opt-in per-call, not mandatory

    const client = await pool.connect();
    try {
      // INSERT ... ON CONFLICT DO NOTHING RETURNING is the atomic "claim this
      // key" step — under concurrent identical requests, exactly one wins the
      // insert and proceeds; the loser immediately falls into the replay path
      // below instead of racing the handler.
      const claim = await client.query(
        `INSERT INTO idempotency_key (idempotency_key, endpoint) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING idempotency_key`,
        [key, endpoint]
      );

      if (claim.rows.length === 0) {
        // Someone already claimed this key. Wait briefly for them to finish
        // and store a response, then replay it; if it's still in flight after
        // a short wait, tell the client to retry rather than double-execute.
        for (let i = 0; i < 20; i++) {
          const existing = await client.query(
            `SELECT response_status, response_body FROM idempotency_key WHERE idempotency_key = $1 AND endpoint = $2`,
            [key, endpoint]
          );
          const row = existing.rows[0];
          if (row?.response_status != null) {
            res.status(row.response_status).json(row.response_body);
            return;
          }
          await new Promise((r) => setTimeout(r, 50));
        }
        res.status(409).json({ title: "Request with this idempotency key is still processing", status: 409 });
        return;
      }

      const originalJson = res.json.bind(res);
      res.json = ((body: unknown) => {
        if (res.statusCode < 400) {
          pool
            .query(`UPDATE idempotency_key SET response_status = $1, response_body = $2 WHERE idempotency_key = $3 AND endpoint = $4`, [
              res.statusCode,
              JSON.stringify(body),
              key,
              endpoint,
            ])
            .catch((err) => console.error("idempotency store failed", err));
        } else {
          // A failed attempt (validation error, transient DB error, etc.) must
          // never become the durable "idempotent result" for this key — the
          // global error handler calls this same res.json, and without this
          // branch a client's retry after a bug fix or a transient outage
          // would replay the stale error forever instead of getting a real
          // chance to succeed. Release the claim so the key is retryable.
          pool
            .query(`DELETE FROM idempotency_key WHERE idempotency_key = $1 AND endpoint = $2 AND response_status IS NULL`, [key, endpoint])
            .catch((err) => console.error("idempotency claim release failed", err));
        }
        return originalJson(body);
      }) as typeof res.json;

      await handler(req, res, next);
    } finally {
      client.release();
    }
  };
}
