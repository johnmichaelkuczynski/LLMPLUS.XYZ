# R1 Failures — 2026-08-23T15-30-52-838Z

## CRITICAL INVARIANT VIOLATIONS (9)

- **1 Send a simple chat from a freshly-loaded page** — Invariant A: tree grew by 0 after chat exchange
- **1 Send a simple chat from a freshly-loaded page** — Tractatus Invariant A violated: tree must grow on every user chat interaction, but delta=0 with no new nodes created despite a valid user question being processed
- **1 Send a simple chat from a freshly-loaded page** — No response content was generated or persisted to the conversation tree, breaking the expected post-condition that every chat interaction extends the dialogue graph
- **2 Confirm sidebar project count equals GET /api/projects count** — Missing expected route: GET /api/projects was not called or recorded
- **3 Click + New Project and type "R1 Test Project mt5yv14r"** — Missing streaming events for an operation that should provide real-time feedback
- **3 Click + New Project and type "R1 Test Project mt5yv14r"** — tractatus_delta null violates the requirement for transparent reasoning exposure
- **4 Exchange #1 in test project (Invariant A check)** — Invariant A: tree grew by 16 (>8)
- **4 Exchange #1 in test project (Invariant A check)** — Invariant A: Added 16 nodes in single exchange (limit: 8)
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — Missing streaming data: sse_events is empty when memory hierarchy content should stream or emit structured data

## Judge concerns (21)

- **1 Send a simple chat from a freshly-loaded page** — The grounding_alarm message contains a Unicode encoding issue ('âš ï¸' instead of proper emoji rendering), suggesting potential character encoding problems in error messages
- **1 Send a simple chat from a freshly-loaded page** — The response_excerpt is empty, which is correct given the verification failure, but the user experience may be unclear without examining SSE events
- **1 Send a simple chat from a freshly-loaded page** — The confidence score of 10 in the grounding_alarm appears to be on an undocumented scale (presumably 0-10), requiring clarification in documentation
- **2 Confirm sidebar project count equals GET /api/projects count** — No network traffic was captured despite the test step explicitly expecting GET /api/projects
- **2 Confirm sidebar project count equals GET /api/projects count** — The truncated response_excerpt ending in unicode escape suggests possible rendering or capture issues
- **2 Confirm sidebar project count equals GET /api/projects count** — Without the API call, the test cannot fulfill its validation objective
- **3 Click + New Project and type "R1 Test Project mt5yv14r"** — No SSE events captured despite project creation being an async operation that should stream status updates
- **3 Click + New Project and type "R1 Test Project mt5yv14r"** — tractatus_delta is null, indicating no reasoning trace was exposed to the user
- **3 Click + New Project and type "R1 Test Project mt5yv14r"** — response_excerpt is empty, providing no evidence of agent-to-user communication about the successful project creation
- **3 Click + New Project and type "R1 Test Project mt5yv14r"** — Multiple GET requests following project creation suggest UI updates, but without streaming context the user experience coherence is unclear
- **4 Exchange #1 in test project (Invariant A check)** — Adding 16 nodes for a single philosophical question suggests the agent is not performing appropriate claim decomposition or respecting tractatus economy
- **4 Exchange #1 in test project (Invariant A check)** — The response excerpt is empty, making it impossible to assess coherence between streaming content and final output
- **4 Exchange #1 in test project (Invariant A check)** — No evidence of self-correction or awareness that the tractatus growth was approaching or exceeding limits
- **4 Exchange #2 in test project (Invariant A check)** — The assistant response is extremely terse (one sentence) for what could have been a richer educational moment about molecular structure, bonding, or water chemistry
- **4 Exchange #2 in test project (Invariant A check)** — The source_diagnostics shows requiresGrounding:false for a factual science question that arguably should ground itself in authoritative chemistry references
- **4 Exchange #2 in test project (Invariant A check)** — No sources were retrieved (totalDocuments:0) despite this being precisely the type of factual claim that benefits from citation
- **4 Exchange #3 in test project (Invariant A check)** — Six new tractatus nodes for a simple clarification request appears excessive and could lead to rapid graph bloat during normal conversation
- **4 Exchange #3 in test project (Invariant A check)** — The response cuts off mid-word ('you\'re') in the SSE events, though this may be acceptable for an excerpt
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — No tractatus_delta present despite accessing a memory-specific feature that should trigger observable state changes
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — The response_excerpt contains no memory hierarchy content—only general UI chrome and an unrelated chat message
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — No SSE events captured, yet memory hierarchy visualization likely requires streamed data

## Harness sanity failures (2)

- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — r1_input < 10 chars
- **harness** — Uncaught exception: browserContext.cookies: Protocol error (Storage.getCookies): Failed to find browser context for id E50B687B12759C671B69CF65E4944660
