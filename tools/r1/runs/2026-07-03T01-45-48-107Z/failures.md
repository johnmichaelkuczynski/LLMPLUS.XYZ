# R1 Failures — 2026-07-03T01-45-48-107Z

## CRITICAL INVARIANT VIOLATIONS (11)

- **1 Send a simple chat from a freshly-loaded page** — Invariant A: tree grew by 0 after chat exchange
- **1 Send a simple chat from a freshly-loaded page** — Tractatus delta shows zero growth (nodesBefore=96, nodesAfter=96) when semantic content warrants new nodes
- **1 Send a simple chat from a freshly-loaded page** — Response coherence completely broken: references non-existent conversation history
- **2 Confirm sidebar project count equals GET /api/projects count** — Expected route GET /api/projects was never called (network_calls array is empty)
- **2 Confirm sidebar project count equals GET /api/projects count** — No tractatus delta despite a substantive test step that should yield structured findings
- **2 Confirm sidebar project count equals GET /api/projects count** — Test objective explicitly requires comparing two counts, but neither count is extracted or reported
- **3 Click + New Project and type "R1 Test Project mr49x59x"** — Missing streaming: sse_events array is empty when LLMPlus operations should stream responses
- **3 Click + New Project and type "R1 Test Project mr49x59x"** — Missing tractatus_delta: No state delta provided for an operation that should involve reasoning
- **4 Exchange #1 in test project (Invariant A check)** — Invariant A: tree grew by 31 (>8)
- **4 Exchange #1 in test project (Invariant A check)** — Invariant A: created 31 nodes, exceeds limit of 8 by 23 nodes
- **4 Exchange #1 in test project (Invariant A check)** — violationNote explicitly confirms 'tree grew by more than 8'

## Judge concerns (14)

- **1 Send a simple chat from a freshly-loaded page** — Severe response coherence failure: LLM hallucinates prior conversation history on first message
- **1 Send a simple chat from a freshly-loaded page** — User-hostile refusal to answer a legitimate question based on false premises
- **1 Send a simple chat from a freshly-loaded page** — Tractatus invariant A violation noted but tree genuinely should have grown for this input
- **1 Send a simple chat from a freshly-loaded page** — Response abruptly cuts off mid-word ('circ') suggesting streaming or generation issue
- **2 Confirm sidebar project count equals GET /api/projects count** — The response excerpt shows a full UI render including project listings, chat history, and library navigation, but provides no evidence of counting sidebar projects or comparing against an API response
- **2 Confirm sidebar project count equals GET /api/projects count** — Four projects are visible in the sidebar (mr3yuwpl, mr3z3yvx, mr3zbnj2, mr40h734) but no count or comparison is documented
- **2 Confirm sidebar project count equals GET /api/projects count** — The displayed content shifts mid-excerpt to show a philosophical discussion about mathematics, suggesting possible UI confusion or incomplete focus on the test objective
- **3 Click + New Project and type "R1 Test Project mr49x59x"** — No response_excerpt provided, making it impossible to verify user-facing confirmation or feedback quality
- **3 Click + New Project and type "R1 Test Project mr49x59x"** — Empty sse_events array suggests no real-time updates were streamed during project creation
- **3 Click + New Project and type "R1 Test Project mr49x59x"** — tractatus_delta is null, indicating no state reasoning or decision-making process was captured
- **4 Exchange #1 in test project (Invariant A check)** — The response likely attempted an exhaustive exploration of ML architecture trade-offs rather than a focused answer
- **4 Exchange #1 in test project (Invariant A check)** — 31 nodes suggests excessive decomposition into sub-assertions and nested document structures
- **4 Exchange #1 in test project (Invariant A check)** — The mix of ASSERTS, OPEN, QUESTION, ASSUMES, and DOCUMENT tags indicates structural complexity that violated budgetary discipline
- **4 Exchange #1 in test project (Invariant A check)** — No evidence the system attempted to stay within the 8-node budget despite this being a named invariant test

## Harness sanity failures (1)

- **harness** — Uncaught exception: browserContext.cookies: Target page, context or browser has been closed
