---
name: Clerk login without packages
description: Google login via Clerk rebuilt IN-APP with no npm packages after a full login rip-out; server verifies Clerk JWTs itself; auto-JMK fallback only on plain-http localhost.
---

**Rule: login here is Google-via-Clerk rendered IN-APP (clerk-js v5 script tag from the
instance FAPI domain), with the server verifying the RS256 session JWT itself using
builtin crypto + the instance JWKS. Never add Clerk npm packages (package.json is
locked) and never redirect to Clerk's hosted accounts.*.dev portal.**

**Why:** (July 2026) Clerk first failed for this user (mismatched keys from two Clerk
apps, iframe cookie issues, VPN blocking Clerk JS), leading to a total login rip-out
("RIP OUT LOGIN"). The user then explicitly requested Google login back via Clerk with
their own keys, in-app only. Keys were verified to belong to the same instance via
matching JWKS kid before building.

**How to apply:**
- JWT verify must check alg=RS256, signature vs JWKS (cache + kid-miss refetch),
  exp/nbf/sub, iss === https://<fapi-domain>, and azp against the origin allowlist.
- Personal app: all verified sign-ins map to the single default JMK account; JMK's
  clerk_id is claimed by the first Clerk account and others get 403. Regenerate the
  session on login.
- Fail closed on https with no session (401 → login screen). Auto-JMK sessions exist
  ONLY on plain-http localhost — that's what keeps the R1 Playwright harness running
  with zero credentials.
- Google OAuth cannot complete inside the Replit preview iframe: show an
  "open in a new tab" button and poll /api/auth/me; SameSite=None; Secure cookies
  (trust proxy) make the new-tab session visible to the iframe.

**Iframe/preview session gotcha:** session cookies are invisible inside the Replit
preview iframe unless `SameSite=None; Secure` (needs `trust proxy`). Keep the
per-request cookie mutation (secure requests → None/Secure, plain http localhost → Lax)
plus the Origin-allowlist CSRF guard on non-GET `/api/*` — SameSite=None without that
guard is a CSRF hole.
