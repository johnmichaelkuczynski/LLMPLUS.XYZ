---
name: Server ESM & admin-route gotchas
description: server/index.js is ESM; require() throws at runtime, and /api/admin/* bypasses the global auth middleware.
---
- server/index.js LOOKS like CommonJS (var, function-style) but is ESM (it uses `import { setupAuth }`). `require('x')` inside handlers throws ReferenceError at runtime — silently, if inside a try/catch. Use imports or globals (e.g. `globalThis.crypto.randomUUID()`). `node --check` will NOT catch this.
- The global `/api` auth middleware skips `/api/auth/*` and `/api/admin/*`, so admin routes never get `req.userId`; gate them with `req.isAuthenticated() && req.user.email === owner` (see /api/admin/visits in server/auth.js).
**Why:** a visitor-tracking middleware silently no-oped and an admin endpoint always 401'd because of these two traps.
**How to apply:** any new server middleware/route — never use require(), and check auth-middleware coverage for the path prefix.

**Session↔project binding (Aug 2026):** chat routes originally verified project ownership and session ownership SEPARATELY, so a stale sessionId from another project was accepted → wrong project's chat shown/used under a selected project. Rule: any route taking both projectId and sessionId must verify `sessions.project_id = projectId` in one joined query (verifySessionInProject). Client side: project switches need a token guard (drop out-of-order /sessions responses), clear currentSession immediately on switch, and async flows (ensureSession, coherence popup) must capture session/project at start, never read mutable state.* at request time.
