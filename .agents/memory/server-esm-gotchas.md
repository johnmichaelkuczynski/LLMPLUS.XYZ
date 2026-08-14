---
name: Server ESM & admin-route gotchas
description: server/index.js is ESM; require() throws at runtime, and /api/admin/* bypasses the global auth middleware.
---
- server/index.js LOOKS like CommonJS (var, function-style) but is ESM (it uses `import { setupAuth }`). `require('x')` inside handlers throws ReferenceError at runtime — silently, if inside a try/catch. Use imports or globals (e.g. `globalThis.crypto.randomUUID()`). `node --check` will NOT catch this.
- The global `/api` auth middleware skips `/api/auth/*` and `/api/admin/*`, so admin routes never get `req.userId`; gate them with `req.isAuthenticated() && req.user.email === owner` (see /api/admin/visits in server/auth.js).
**Why:** a visitor-tracking middleware silently no-oped and an admin endpoint always 401'd because of these two traps.
**How to apply:** any new server middleware/route — never use require(), and check auth-middleware coverage for the path prefix.
