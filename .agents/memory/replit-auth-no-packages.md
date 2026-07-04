---
name: First-party Replit Auth (OIDC) when third-party JS is blocked / packages locked
description: Why and how this app does Google login via server-side Replit OpenID Connect instead of Clerk
---

# Replit Auth (OIDC) instead of Clerk

Some users sit behind VPNs/firewalls that block third-party auth CDNs (e.g. Clerk's
`*.clerk.accounts.dev` browser JS). A client-side auth widget then silently never
renders — the "Continue with Google" button just stays hidden. Symptom: user insists
Google login "doesn't work" while username/password works fine.

**Decision:** do Google sign-in fully server-side via Replit's OpenID Connect, so no
third-party browser script is needed. The login button is just a first-party link to
`/api/auth/replit/login`.

**Why no `passport`/`openid-client`:** `package.json` is locked (no new packages). The
official Replit Auth blueprint is React/Drizzle/TS and incompatible with this plain
HTML/Express ESM app. So OIDC is implemented by hand with built-in `crypto` (PKCE S256
verifier/challenge + random state) and global `fetch` (token exchange + `/oidc/me`).

**Key facts about Replit OIDC** (verify via `https://replit.com/oidc/.well-known/openid-configuration`):
- It's a **public client**: token endpoint auth method `none`, so NO client secret —
  authenticate with `client_id = process.env.REPL_ID` + PKCE `code_verifier`.
- Endpoints: auth `/oidc/auth`, token `/oidc/token`, userinfo `/oidc/me`.
- `redirect_uri` is built from the request Host (`https://<host>/api/auth/replit/callback`)
  so it auto-matches whatever repl domain (dev or deployed) the user is on. Replit
  validates redirect_uri against the repl's own domains, so host-header abuse is rejected
  upstream. Login and callback MUST build redirect_uri identically.
- Identity claims come from decoding the `id_token` payload (received directly from the
  token endpoint over TLS), with `/oidc/me` Bearer fallback. Claims: `sub`, `email`,
  `first_name`, `last_name`, `profile_image_url`.

**Integration with existing auth:** upsert into the existing `users` table by `replit_id`
(added column), then by `email`; set `req.session.userId`/`username` exactly like the
password path. Username/password login is untouched. The `/api` guard already skips
`/api/auth/*`, so the login/callback routes are public. `req.session.save()` before
redirecting (PgSession persists async — redirect can outrun the write otherwise).

**CLERK IS PERMANENTLY REMOVED (July 2026, user demand: "rip it out").** After repeated
Clerk failures (mismatched key pairs from different Clerk apps, iframe cookie issues, VPN
blocking clerk.accounts.dev JS), the user ordered all Clerk code deleted. Do NOT re-add
Clerk or ask for Clerk keys. The "Continue with Google" button now points at the
server-side Replit OIDC flow (`/api/auth/replit/login`); username/password login is
visible again (also required by the R1 Playwright harness which fills `#auth-username`).
Caveat: Replit OIDC shows a Replit consent screen and requires a Replit account — the
user accepted this tradeoff. Only revisit if the user explicitly asks for
non-Replit Google sign-in (then: direct Google OAuth with their own client id/secret).

**Iframe/preview login gotcha:** any cookie-session login is invisible inside the Replit
preview iframe unless the session cookie is `SameSite=None; Secure` (needs
`trust proxy`). Keep the per-request cookie mutation (secure requests → None/Secure,
plain http localhost → Lax so the R1 harness still works) plus the Origin-allowlist CSRF
guard on non-GET `/api/*` — SameSite=None without that guard is a CSRF hole.

**Non-blocking hardening ideas (not done):** `req.session.regenerate()` on login to
prevent session fixation; canonical allowed-domain config instead of raw Host.
