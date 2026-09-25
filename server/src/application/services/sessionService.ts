// Postgres-backed, revocable server-side sessions for staff login (M10). A
// session_id is embedded as the `sid` claim inside the signed access JWT
// (see jwt.ts) -- it is never a bearer credential on its own, only real
// authorization data once wrapped in a validly-signed token, so it is stored
// here in plain form (no hashing needed).
import { query, queryOne } from "../../db.js";
import { config } from "../../config/index.js";

export async function createSession(userId: string): Promise<{ sessionId: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + config.JWT_ACCESS_TTL_SECONDS * 1000);
  const row = await queryOne<{ session_id: string }>(
    `INSERT INTO user_session (user_id, expires_at) VALUES ($1, $2) RETURNING session_id`,
    [userId, expiresAt]
  );
  return { sessionId: row!.session_id, expiresAt };
}

// Confirms the session is neither revoked nor past its expiry, and bumps
// last_seen_at -- called on every authenticated request whose JWT carries a
// `sid` claim (i.e. every real-login token; dev-login/worker-portal tokens
// carry no `sid` and skip this entirely).
export async function validateSession(sessionId: string): Promise<boolean> {
  const row = await queryOne<{ session_id: string }>(
    `UPDATE user_session SET last_seen_at = now()
     WHERE session_id = $1 AND revoked_at IS NULL AND expires_at > now()
     RETURNING session_id`,
    [sessionId]
  );
  return !!row;
}

export async function getSession(sessionId: string) {
  return queryOne<{ session_id: string; expires_at: string; created_at: string }>(
    `SELECT session_id, expires_at, created_at FROM user_session WHERE session_id = $1`,
    [sessionId]
  );
}

export async function revokeSession(sessionId: string, reason: string): Promise<void> {
  await query(`UPDATE user_session SET revoked_at = now(), revoked_reason = $2 WHERE session_id = $1 AND revoked_at IS NULL`, [sessionId, reason]);
}

export async function revokeAllSessionsForUser(userId: string, reason: string): Promise<void> {
  await query(`UPDATE user_session SET revoked_at = now(), revoked_reason = $2 WHERE user_id = $1 AND revoked_at IS NULL`, [userId, reason]);
}
