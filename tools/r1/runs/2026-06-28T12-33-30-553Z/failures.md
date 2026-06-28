# R1 Failures — 2026-06-28T12-33-30-553Z

## CRITICAL INVARIANT VIOLATIONS (3)

- **1 Send a simple chat from a freshly-loaded page** — Invariant A: tree grew by 82 (>8)
- **1 Send a simple chat from a freshly-loaded page** — Invariant A: at least one new node has invalid tag prefix
- **1 Send a simple chat from a freshly-loaded page** — Invariant A: at least one new node id is not decimal-formatted

## Judge concerns (0)

_None._


## Harness sanity failures (4)

- **1 Send a simple chat from a freshly-loaded page** — judge_critique < 30 words
- **2 Confirm sidebar project count equals GET /api/projects count** — judge_critique < 30 words
- **3 Click + New Project and type "R1 Test Project mqxrtsig"** — judge_critique < 30 words
- **harness** — Uncaught exception: browserContext.cookies: Target page, context or browser has been closed
