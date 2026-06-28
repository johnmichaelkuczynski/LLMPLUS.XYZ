# R1 Failures — 2026-06-28T11-30-42-517Z

## CRITICAL INVARIANT VIOLATIONS (4)

- **1 Send a simple chat from a freshly-loaded page** — Invariant A: tree grew by 11 (>8)
- **4 Exchange #1 in test project (Invariant A check)** — Invariant A: tree grew by 10 (>8)
- **4 Exchange #2 in test project (Invariant A check)** — Invariant A: tree grew by 0 after chat exchange
- **4 Exchange #3 in test project (Invariant A check)** — Invariant A: tree grew by 0 after chat exchange

## Judge concerns (0)

_None._


## Harness sanity failures (11)

- **1 Send a simple chat from a freshly-loaded page** — judge_critique < 30 words
- **2 Confirm sidebar project count equals GET /api/projects count** — judge_critique < 30 words
- **3 Click + New Project and type "R1 Test Project mqxpljgm"** — judge_critique < 30 words
- **4 Exchange #1 in test project (Invariant A check)** — judge_critique < 30 words
- **4 Exchange #2 in test project (Invariant A check)** — expected route not seen: POST /api/chat
- **4 Exchange #2 in test project (Invariant A check)** — judge_critique < 30 words
- **4 Exchange #3 in test project (Invariant A check)** — expected route not seen: POST /api/chat
- **4 Exchange #3 in test project (Invariant A check)** — judge_critique < 30 words
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — r1_input < 10 chars
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — judge_critique < 30 words
- **harness** — Uncaught exception: browserContext.cookies: Target page, context or browser has been closed
