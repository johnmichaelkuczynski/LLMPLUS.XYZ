# R1 Failures — 2026-06-28T12-35-08-813Z

## CRITICAL INVARIANT VIOLATIONS (3)

- **1 Send a simple chat from a freshly-loaded page** — Invariant A: tree grew by 0 after chat exchange
- **1 Send a simple chat from a freshly-loaded page** — Invariant A: at least one new node has invalid tag prefix
- **1 Send a simple chat from a freshly-loaded page** — Invariant A: at least one new node id is not decimal-formatted

## Judge concerns (0)

_None._


## Harness sanity failures (6)

- **1 Send a simple chat from a freshly-loaded page** — judge_critique < 30 words
- **2 Confirm sidebar project count equals GET /api/projects count** — judge_critique < 30 words
- **3 Click + New Project and type "R1 Test Project mqxrwdva"** — judge_critique < 30 words
- **4 Exchange #1 in test project (Invariant A check)** — judge_critique < 30 words
- **4 Exchange #2 in test project (Invariant A check)** — judge_critique < 30 words
- **harness** — Uncaught exception: browserContext.cookies: Target page, context or browser has been closed
