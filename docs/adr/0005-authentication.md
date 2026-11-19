# ADR 0005 – Authentication: DB sessions, CSRF header, default-deny guard

- **Status:** accepted (M1, 2026-11-19)
- **Requirements:** FR-AUTH-01..07, AR-13, NFR-SEC-01

## Decision

- **Server-side sessions** in table `session`. The cookie `sim_session` holds 32 random bytes;
  the DB stores only `HMAC-SHA256(SESSION_SECRET, token)`. Logout, deactivation and password
  reset delete sessions immediately – no waiting for token expiry.
  Lifetime: 30 days with "stay logged in" (cookie with Max-Age), otherwise 12 h (browser-session
  cookie). Absolute expiry, no sliding renewal.
- **Cookie:** `HttpOnly`, `SameSite=Strict`, `Secure` when the request arrived via HTTPS
  (`X-Forwarded-Proto`), `Path` = ingress base path from `X-Ingress-Path` (or `/`).
- **CSRF:** every POST/PUT/PATCH/DELETE must send `X-CSRF-Token`. With a session it must equal
  the per-session token (returned by login and `GET /api/auth/session`); without a session any
  non-empty value is accepted – a custom header forces a CORS preflight, which is never granted.
- **Default-deny guard** (`registerAuthGuard`): every `/api` route requires a session unless it
  declares `config: { public: true }`; `config: { admin: true }` requires ADMIN. While
  `must_change_password` is set, only routes with `allowPendingPasswordChange` are reachable.
- **Passwords:** argon2id via `@node-rs/argon2` (prebuilt binaries for musl amd64/arm64, no
  compiler in the image), OWASP default parameters. Unknown usernames run a dummy verification
  so response times do not reveal which usernames exist.
- **Login throttling** in memory: 5 failures within 15 min lock the **username** for 1 min;
  the **client IP** is locked after 20 failures. The IP limit is higher on purpose: behind
  Home Assistant Ingress all users may arrive from the same proxy address.
- **Last admin rule** is enforced inside a transaction that row-locks all active admins
  (`SELECT … FOR UPDATE`), so two parallel demotions cannot both succeed.
- Usernames are case-insensitive (stored lowercase).

## Consequences

- One DB read per authenticated request (session + user); fine for the expected load.
- Rate-limit state is lost on restart – acceptable for a single-container app.
- A changed `SESSION_SECRET` logs everybody out.
