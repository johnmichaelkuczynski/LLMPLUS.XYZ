---
name: No login in this app
description: ALL login (Clerk, Replit OIDC, and the username/password screen) was permanently removed at the user's demand — app auto-starts as default JMK user. Do not re-add any login.
---

**Rule: this app has NO login at all. The user escalated from removing Google login to
removing the entire login screen ("RIP OUT LOGIN"). The app auto-starts a session as the
default JMK user (auto-created if missing). Never re-add Clerk, Replit OIDC, any
Google/OAuth/social login, or a username/password screen, unless the user explicitly
requests login again.**

**Why:** (July 2026) Clerk failed repeatedly for this user (mismatched key pairs from
different Clerk apps, iframe cookie issues, VPN blocking clerk.accounts.dev JS) and was
ripped out on demand. A server-side Replit OIDC replacement was built and the user
immediately ordered that removed too ("TOTAL FAILURE. RIP IT OUT. DO NOT FIX. DO NOT
REBUILD."). Rebuilding any social login uninvited would directly violate an explicit,
repeated user demand.

**How to apply:** There is no login to fix — "login is broken" reports mean the app
failed to auto-start its JMK session, not that auth UI is missing. If login is ever
explicitly requested again, prefer a server-side flow with no new packages (VPNs can
block third-party browser JS like Clerk's), and note Replit OIDC forces users onto
Replit accounts via a Replit consent screen.

**Iframe/preview session gotcha (still applies even without login):** session cookies
are invisible inside the Replit preview iframe unless `SameSite=None; Secure` (needs
`trust proxy`). Keep the per-request cookie mutation (secure requests → None/Secure,
plain http localhost → Lax for the R1 Playwright harness) plus the Origin-allowlist
CSRF guard on non-GET `/api/*` — SameSite=None without that guard is a CSRF hole.
