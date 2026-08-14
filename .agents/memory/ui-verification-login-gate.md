---
name: UI verification behind the login gate
description: How to visually/behaviorally verify the app despite mandatory Google login; screenshot tool can't hold the session.
---
The screenshot tool hits http://127.0.0.1:5000 where secure session cookies are dropped, so it always shows the login gate — this is NOT a JS error. Verify UI instead with Playwright run from tools/r1 (its node_modules has playwright): visit /api/auth/dev-login first, then the page. API checks: curl -c jar https://$REPLIT_DEV_DOMAIN/api/auth/dev-login, then reuse the cookie jar.
**Why:** wasted repeated screenshots before finding the cookie issue; R1 harness fails at the same step.
**How to apply:** any time visual/behavioral verification of the chat UI is needed.

## Modal stacking over the artifact panel
Dynamic modals (`.modal-bg` at z-index ~600) render UNDER the artifact panel (z-index 1000), so any modal launched from content inside the artifact panel (e.g. memory hierarchy) silently swallows clicks. Give such modals `zIndex >= 1200`. Playwright surfaces this as "element intercepts pointer events" while a manual look appears fine.
