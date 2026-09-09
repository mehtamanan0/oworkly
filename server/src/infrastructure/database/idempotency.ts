// Generic idempotency wrapper used by every write endpoint the spec lists
// (attempt creation, submissions, approvals, certificate issuance, ingestion/
// AI job creation, activity completion). The same request repeated after a
// timeout replays the original stored result instead of creating a
// duplicate. Sequential retry-after-failure and retry-after-success are
// covered in tests/integration/idempotencyKey.test.ts; true concurrent
// double-submission (two requests racing the same key at once) is not
// separately load-tested in this pass — the atomic claim-via-INSERT and the
// poll-for-in-flight-response loop below are what that scenario relies on.
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { pool } from "../../db.js";

export function withIdempotency(endpoint: string, handler: RequestHandler): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = (req.headers["idempotency-key"] as string) || (req.body?.clientIdempotencyKey as string);
    if (!key) return handler(req, res, next); // idempotency is opt-in per-call, not mandatory

    const client = await pool.connect();
    // Tracks whatever persist/release query res.json below kicks off on
    // `client`, so this function can await it before releasing that same
    // client back to the pool — releasing while a query is still in flight
    // on it is unsafe (the pool could hand that connection to an unrelated
    // request while our query is still running on the wire).
    let persisted: Promise<unknown> = Promise.resolve();
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

      // Awaited (not fire-and-forget) so the claim is durably resolved — either
      // stored or released — before the HTTP response actually completes.
      // Fire-and-forget here would mean a process crash right after sending
      // the response could leave the key claimed with no stored response
      // forever, permanently 409-ing every future retry.
      const originalJson = res.json.bind(res);
      res.json = (((body: unknown) => {
        persisted =
          res.statusCode < 400
            ? client
                .query(`UPDATE idempotency_key SET response_status = $1, response_body = $2 WHERE idempotency_key = $3 AND endpoint = $4`, [
                  res.statusCode,
                  JSON.stringify(body),
                  key,
                  endpoint,
                ])
                .catch((err) => console.error("idempotency store failed", err))
            : // A failed attempt (validation error, transient DB error, etc.)
              // must never become the durable "idempotent result" for this key
              // — the global error handler calls this same res.json, and
              // without this branch a client's retry after a bug fix or a
              // transient outage would replay the stale error forever instead
              // of getting a real chance to succeed. Release the claim so the
              // key is retryable.
              client
                .query(`DELETE FROM idempotency_key WHERE idempotency_key = $1 AND endpoint = $2 AND response_status IS NULL`, [key, endpoint])
                .catch((err) => console.error("idempotency claim release failed", err));
        // The actual HTTP response is gated behind the persist/release
        // completing — a client must never observe "done" before the
        // idempotency key's terminal state is durably written, or a
        // same-key retry sent immediately after seeing this response could
        // race the write and re-execute the operation.
        return persisted.then(() => originalJson(body));
      }) as unknown) as typeof res.json;

      await handler(req, res, next);
      await persisted;
    } finally {
      client.release();
    }
  };
}
