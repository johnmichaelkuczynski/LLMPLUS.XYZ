# R1 Failures — 2026-06-28T12-38-59-177Z

## CRITICAL INVARIANT VIOLATIONS (8)

- **1 Send a simple chat from a freshly-loaded page** — Invariant A: tree grew by 89 (>8)
- **1 Send a simple chat from a freshly-loaded page** — Invariant A: at least one new node has invalid tag prefix
- **1 Send a simple chat from a freshly-loaded page** — Invariant A: at least one new node id is not decimal-formatted
- **4 Exchange #1 in test project (Invariant A check)** — Invariant A: tree grew by 18 (>8)
- **4 Exchange #2 in test project (Invariant A check)** — Invariant A: tree grew by 0 after chat exchange
- **4 Exchange #3 in test project (Invariant A check)** — Invariant A: tree grew by 16 (>8)
- **6 Plant distinctive fact: "XQ-77-blue"** — Invariant A: tree grew by 0 after chat exchange
- **6 In a brand-new session, recall the secret** — Invariant C VIOLATION: new session failed to recall "XQ-77-blue"

## Judge concerns (0)

_None._


## Harness sanity failures (13)

- **1 Send a simple chat from a freshly-loaded page** — judge_critique < 30 words
- **2 Confirm sidebar project count equals GET /api/projects count** — judge_critique < 30 words
- **3 Click + New Project and type "R1 Test Project mqxs0odv"** — judge_critique < 30 words
- **4 Exchange #1 in test project (Invariant A check)** — judge_critique < 30 words
- **4 Exchange #2 in test project (Invariant A check)** — judge_critique < 30 words
- **4 Exchange #3 in test project (Invariant A check)** — judge_critique < 30 words
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — r1_input < 10 chars
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — judge_critique < 30 words
- **6 Plant distinctive fact: "XQ-77-blue"** — expected route not seen: POST /api/chat
- **6 Plant distinctive fact: "XQ-77-blue"** — judge_critique < 30 words
- **6 In a brand-new session, recall the secret** — expected route not seen: POST /api/chat
- **6 In a brand-new session, recall the secret** — judge_critique < 30 words
- **harness** — Uncaught exception: fetch failed
