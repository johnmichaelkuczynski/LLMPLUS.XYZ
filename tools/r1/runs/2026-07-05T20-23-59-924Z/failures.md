# R1 Failures — 2026-07-05T20-23-59-924Z

## CRITICAL INVARIANT VIOLATIONS (24)

- **1 Send a simple chat from a freshly-loaded page** — Invariant A: tree grew by 0 after chat exchange
- **1 Send a simple chat from a freshly-loaded page** — Invariant A: at least one new node has invalid tag prefix
- **1 Send a simple chat from a freshly-loaded page** — Invariant A: at least one new node id is not decimal-formatted
- **1 Send a simple chat from a freshly-loaded page** — Tractatus invariant A violated: tree contracted instead of growing (102→99 nodes)
- **1 Send a simple chat from a freshly-loaded page** — allTagsValid=false indicates at least one invalid tag in the delta
- **1 Send a simple chat from a freshly-loaded page** — allIdsValid=false indicates at least one malformed node identifier
- **2 Confirm sidebar project count equals GET /api/projects count** — Missing expected route: GET /api/projects was never called
- **3 Click + New Project and type "R1 Test Project mr88qwj9"** — No streaming response: sse_events array is empty when user action should trigger at least one streamed acknowledgment
- **3 Click + New Project and type "R1 Test Project mr88qwj9"** — Missing tractatus_delta: state delta is null rather than showing the new project in the knowledge graph
- **4 Exchange #1 in test project (Invariant A check)** — Invariant A: tree grew by 0 after chat exchange
- **4 Exchange #1 in test project (Invariant A check)** — Invariant A violated: tree did not grow (0 nodes added)
- **4 Exchange #1 in test project (Invariant A check)** — No SSE streaming occurred despite POST /api/chat returning 200
- **4 Exchange #1 in test project (Invariant A check)** — Empty response body delivered to user
- **4 Exchange #2 in test project (Invariant A check)** — Invariant A: tree grew by 14 (>8)
- **4 Exchange #2 in test project (Invariant A check)** — Invariant A violated: tree grew by 14 nodes, exceeding the maximum allowed growth of 8 nodes per exchange
- **6 Plant distinctive fact: "XQ-77-blue"** — Invariant A: tree grew by 0 after chat exchange
- **6 Plant distinctive fact: "XQ-77-blue"** — Missing expected route: POST /api/chat was never called
- **6 Plant distinctive fact: "XQ-77-blue"** — No SSE stream initiated (violates streaming requirement)
- **6 Plant distinctive fact: "XQ-77-blue"** — Tractatus invariant A violated: tree must grow when novel information is presented for retention
- **6 Plant distinctive fact: "XQ-77-blue"** — No response generated (response_excerpt empty, suggesting complete agent failure)
- **6 In a brand-new session, recall the secret** — Invariant C VIOLATION: new session failed to recall "XQ-77-blue"
- **6 In a brand-new session, recall the secret** — Missing expected route POST /api/chat - no network call was made
- **6 In a brand-new session, recall the secret** — No streaming response provided - violates the fundamental SSE requirement
- **6 In a brand-new session, recall the secret** — Empty response_excerpt prevents any evaluation of LLM output

## Judge concerns (32)

- **1 Send a simple chat from a freshly-loaded page** — The LLM's refusal response suggests poor session/context isolation between test runs—it 'remembers' prior iterations that should be independent
- **1 Send a simple chat from a freshly-loaded page** — Node IDs like 'nodes.1.3' and 'metadata.note' appear suspicious; canonical format should be UUID-based or content-addressed
- **1 Send a simple chat from a freshly-loaded page** — Tree contraction (-3 nodes) contradicts the core knowledge accumulation model
- **2 Confirm sidebar project count equals GET /api/projects count** — The agent did not invoke GET /api/projects despite this being the sole expected route for the test step
- **2 Confirm sidebar project count equals GET /api/projects count** — No comparison or validation logic was executed between sidebar UI state and API response
- **2 Confirm sidebar project count equals GET /api/projects count** — The response excerpt appears to be a raw UI dump rather than a structured test result or confirmation
- **2 Confirm sidebar project count equals GET /api/projects count** — The displayed content about epistemology seems unrelated to the project-counting verification task
- **3 Click + New Project and type "R1 Test Project mr88qwj9"** — Zero SSE events captured despite successful API calls suggests streaming infrastructure failure or event listener not attached
- **3 Click + New Project and type "R1 Test Project mr88qwj9"** — Null tractatus_delta indicates no state synchronization occurred between backend and frontend after project creation
- **3 Click + New Project and type "R1 Test Project mr88qwj9"** — Empty response_excerpt provides no user-facing confirmation that the project was created
- **4 Exchange #1 in test project (Invariant A check)** — No streaming events were emitted despite a successful HTTP status, suggesting the SSE channel was never opened or immediately closed
- **4 Exchange #1 in test project (Invariant A check)** — The response excerpt is empty, meaning the user received no visible answer to a substantive quantum biology question
- **4 Exchange #1 in test project (Invariant A check)** — Complete absence of knowledge graph growth on the first exchange violates the core value proposition of LLMPlus
- **4 Exchange #2 in test project (Invariant A check)** — The 14-node expansion for a binary factual comparison indicates poor judgment in decomposition granularity
- **4 Exchange #2 in test project (Invariant A check)** — Multiple ASSERTS nodes appear redundant for what should be a simple two-fact comparison
- **4 Exchange #2 in test project (Invariant A check)** — The hierarchical structure (1.1.1-1.1.4, 1.2.1-1.2.4, etc.) suggests unnecessary nesting for straightforward facts
- **4 Exchange #3 in test project (Invariant A check)** — The agent's response contradicts Invariant A by expressing high confidence ('I don't see a contradiction') when challenged rather than exploring uncertainty
- **4 Exchange #3 in test project (Invariant A check)** — The RESOLVED tag appearing immediately after a contradiction challenge suggests the system is marking issues as resolved without adequate reflection
- **4 Exchange #3 in test project (Invariant A check)** — The response excerpt is empty, making it impossible to verify the full coherence and tone of the response
- **4 Exchange #3 in test project (Invariant A check)** — The agent misses an opportunity to model epistemic humility by defensively restating premises rather than genuinely considering the user's perspective
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — Response excerpt shows navigation UI and chat transcript instead of memory hierarchy structure (e.g., no tier labels, context scope, or retention metadata)
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — Step description requires reconciliation of 'UI tiers with API' but excerpt provides no evidence of structured memory data rendering
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — Unclear whether the memory hierarchy modal/panel failed to render or was simply omitted from the excerpt
- **6 Plant distinctive fact: "XQ-77-blue"** — Zero network activity when explicit memory storage was requested
- **6 Plant distinctive fact: "XQ-77-blue"** — No streaming response or user feedback of any kind
- **6 Plant distinctive fact: "XQ-77-blue"** — Knowledge graph failed to expand despite new factual information being introduced
- **6 Plant distinctive fact: "XQ-77-blue"** — The distinctive seed value 'XQ-77-blue' was neither acknowledged nor persisted
- **6 In a brand-new session, recall the secret** — Zero network calls despite expecting POST /api/chat - the agent may not have executed the request
- **6 In a brand-new session, recall the secret** — No SSE events indicate complete absence of streaming response
- **6 In a brand-new session, recall the secret** — Empty response_excerpt provides no evidence of LLM behavior or error handling
- **6 In a brand-new session, recall the secret** — Tractatus_delta is null when it should reflect the session state change
- **6 In a brand-new session, recall the secret** — Cannot assess if cross-session isolation is working correctly without any system output

## Harness sanity failures (4)

- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — r1_input < 10 chars
- **6 Plant distinctive fact: "XQ-77-blue"** — expected route not seen: POST /api/chat
- **6 In a brand-new session, recall the secret** — expected route not seen: POST /api/chat
- **harness** — Uncaught exception: fetch failed
