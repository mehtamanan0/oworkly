-- M10: real password authentication + revocable server-side sessions for
-- staff login. Dev-login (devLogin.ts) and the worker-portal PIN flow are
-- deliberately untouched by this migration and the code that reads it -- both
-- mint JWTs with no `sid` claim, so authenticate() skips the session-
-- revocation check for them entirely. Only tokens minted by the new
-- POST /auth/login carry `sid` and get a real, revocable session.
--
-- No separate hashed "session token" column is needed on user_session: the
-- session_id here is never itself a bearer credential (unlike a plain opaque
-- session cookie) -- it only becomes one when embedded inside a validly
-- *signed* JWT, which requires JWT_SECRET. A leaked session_id alone grants
-- no access, so storing it in plain form here is safe.

ALTER TABLE app_user
    ADD COLUMN password_hash TEXT,
    ADD COLUMN password_algo VARCHAR(20) NOT NULL DEFAULT 'argon2id',
    ADD COLUMN password_changed_at TIMESTAMPTZ,
    ADD COLUMN failed_login_count SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN last_failed_login_at TIMESTAMPTZ,
    ADD COLUMN last_success_login_at TIMESTAMPTZ,
    ADD COLUMN locked_until TIMESTAMPTZ,
    ADD COLUMN deactivated_at TIMESTAMPTZ,
    ADD COLUMN deactivated_by_user_id UUID REFERENCES app_user(user_id),
    ADD COLUMN deactivation_reason TEXT;

CREATE TABLE user_session (
    session_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL,
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at      TIMESTAMPTZ,
    revoked_reason  TEXT
);
CREATE INDEX ix_user_session_user ON user_session(user_id);
CREATE INDEX ix_user_session_expiry ON user_session(expires_at) WHERE revoked_at IS NULL;
