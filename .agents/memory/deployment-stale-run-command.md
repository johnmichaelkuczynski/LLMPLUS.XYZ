---
name: Stale deployment run-command overrides
description: Publish can use an old run command saved in the Publishing UI, not .replit; failed attempts may not appear in listDeploymentBuilds.
---

**Rule:** A failed publish can be caused by a stale run command saved in the deployment's Advanced configuration (Publishing pane), which overrides `.replit`'s `[deployment]` section. `deployConfig()` only updates `.replit` — it does not clear UI-side overrides. Also: some failed publish attempts never show up in `listDeploymentBuilds` or `fetchDeploymentLogs`, so "no new build in the list" does not mean the user didn't try.

**Why:** This project's publish crash-looped on `node ./dist/index.cjs` (MODULE_NOT_FOUND) even though `.replit` said `run = npm start`. The failed attempt produced no build entry and no deployment logs.

**How to apply:** When a publish fails but no new build/logs appear, ask what error the user sees (or check their screenshot) — the real run command may differ from `.replit`. Robust fix without user UI action: make the build step materialize whatever file the stale run command targets (e.g. a CJS shim at `dist/index.cjs` that dynamic-imports the ESM server), so both old and new run commands work.
