---
name: No social login in this app
description: All Google/social login (Clerk, then Replit OIDC) was permanently removed at the user's demand — username/password only. Do not re-add.
---

**Rule: this app is username/password auth ONLY. Never re-add Clerk, Replit OIDC, or any
Google/OAuth/social login, and never ask for auth keys, unless the user explicitly
requests social login again.**

**Why:** (July 2026) Clerk failed repeatedly for this user (mismatched key pairs from
different Clerk apps, iframe cookie issues, VPN blocking clerk.accounts.dev JS) and was
ripped out on demand. A server-side Replit OIDC replacement was built and the user
immediately ordered that removed too ("TOTAL FAILURE. RIP IT OUT. DO NOT FIX. DO NOT
REBUILD."). Rebuilding any social login uninvited would directly violate an explicit,
repeated user demand.

**How to apply:** Any "login is broken" work stays within username/password + session
cookies. If social login is ever explicitly requested again, prefer a server-side flow
with no new packages (VPNs can block third-party browser JS like Clerk's), and note
Replit OIDC forces users onto Replit accounts via a Replit consent screen.

**Iframe/preview login gotcha (still applies):** cookie-session login is invisible inside
the Replit preview iframe unless the session cookie is `SameSite=None; Secure` (needs
`trust proxy`). Keep the per-request cookie mutation (secure requests → None/Secure,
plain http localhost → Lax so the R1 Playwright harness, which fills `#auth-username`,
still works) plus the Origin-allowlist CSRF guard on non-GET `/api/*` — SameSite=None
without that guard is a CSRF hole.
