---
name: Login churn in this app (currently NO login)
description: Login has been built and ripped out repeatedly at user demand (Clerk twice, direct Google OAuth once). As of July 2026 there is NO login; every visitor gets the default JMK user. Patterns to reuse if login returns.
---

**Rule: as of July 5, 2026 this app has NO login system — the user demanded a full
rip-out ("I HAVE A PLAN"). Every visitor on every protocol gets the default JMK
workspace (`requireAuth` attaches `getDefaultUserId()`; `/api/auth/me` returns JMK
with isOwner:true). Do not re-add any auth unless the user explicitly asks; expect
his plan to specify the next design.**

**Why:** Login churned four times: Clerk built → ripped out (VPN blocked Clerk JS,
iframe cookies) → Clerk rebuilt in-app with no packages → rejected → direct Google
OAuth 2.0 (hand-rolled, builtin crypto+fetch, shared vault client) built and fully
verified → user hit redirect_uri_mismatch (needed to paste callback URLs into Google
Cloud Console himself) and instead demanded everything ripped out again.

**How to apply:**
- Keep removals clean but reversible: `login_events` table, `users.google_id`/`email`
  columns and historical rows were intentionally KEPT; GOOGLE_OAUTH_* secrets remain
  in the vault unused. Admin page fell back to password-gate-only (1234, user's choice).
- Removed API routes must 404 explicitly — an Express SPA fallback otherwise serves
  index.html with HTTP 200 for dead `/api/auth/*` paths and confuses testing.
- The R1 Playwright harness (tools/r1, http://localhost:5000) must always work with
  zero credentials; verify after any auth change.

**Patterns proven to work if login ever returns (direct Google OAuth, no packages):**
- Authorization-code flow with builtin crypto+fetch; verify ID token locally against
  Google JWKS (RS256 sig, exp, iss, aud=client_id); session-stored `state` for CSRF;
  `req.session.regenerate` on login; email-based owner binding gated on
  `email_verified === true`; anchor OAuth redirect_uri host to the origin allowlist.
- Google OAuth cannot complete inside the Replit preview iframe: open in a new tab and
  poll /api/auth/me; `SameSite=None; Secure` cookies (trust proxy) make the new-tab
  session visible to the iframe. Keep the Origin-allowlist CSRF guard on non-GET
  `/api/*` — SameSite=None without it is a CSRF hole.
- The one step only the user can do: paste dev + prod callback URLs into Google Cloud
  Console → Credentials → Authorized redirect URIs (and set consent screen to
  "In production"). His shared client is reused across apps — never assume URIs are
  already registered; redirect_uri_mismatch means they aren't.
