# R1 Failures — 2026-07-02T21-22-15-949Z

## CRITICAL INVARIANT VIOLATIONS (17)

- **2 Confirm sidebar project count equals GET /api/projects count** — Missing expected route: GET /api/projects is listed in expected_routes but absent from network_calls
- **2 Confirm sidebar project count equals GET /api/projects count** — tractatus_delta is null despite this being a verification step that should document comparison logic
- **3 Click + New Project and type "R1 Test Project mr40h734"** — Missing tractatus_delta for state-mutating POST operation
- **3 Click + New Project and type "R1 Test Project mr40h734"** — No server-sent events despite creation of new resource
- **4 Exchange #1 in test project (Invariant A check)** — Invariant A: tree grew by 32 (>8)
- **4 Exchange #1 in test project (Invariant A check)** — Invariant A: Generated 32 tractatus nodes when maximum allowed is 8 (violation explicitly noted in tractatus_delta.violationNote)
- **4 Exchange #2 in test project (Invariant A check)** — Invariant A: tree grew by 9 (>8)
- **4 Exchange #2 in test project (Invariant A check)** — Invariant A violated: tractatus grew by 9 nodes when maximum allowed is 8
- **6 Plant distinctive fact: "XQ-77-blue"** — Invariant A: tree grew by 0 after chat exchange
- **6 Plant distinctive fact: "XQ-77-blue"** — Missing expected route: POST /api/chat was never called
- **6 Plant distinctive fact: "XQ-77-blue"** — No SSE streaming occurred (empty sse_events array)
- **6 Plant distinctive fact: "XQ-77-blue"** — Invariant A violated: tractatus delta is 0 when user interaction demands knowledge graph update
- **6 Plant distinctive fact: "XQ-77-blue"** — No response provided to user acknowledgment request
- **6 In a brand-new session, recall the secret** — Invariant C VIOLATION: new session failed to recall "XQ-77-blue"
- **6 In a brand-new session, recall the secret** — Missing required POST /api/chat route call
- **6 In a brand-new session, recall the secret** — No SSE streaming events generated despite expected chat interaction
- **6 In a brand-new session, recall the secret** — Empty response_excerpt indicates no LLM output was produced

## Judge concerns (27)

- **1 Send a simple chat from a freshly-loaded page** — Response terminates mid-sentence without completion, suggesting stream interruption or premature closure
- **1 Send a simple chat from a freshly-loaded page** — No 'done' or final status event observed despite POST /api/chat returning 200
- **1 Send a simple chat from a freshly-loaded page** — Meta-commentary about repetition is appropriate but consumes the entire response without answering the actual question posed
- **2 Confirm sidebar project count equals GET /api/projects count** — No network call to GET /api/projects is present despite being listed as expected
- **2 Confirm sidebar project count equals GET /api/projects count** — Cannot verify sidebar count equals API count without the API response data
- **2 Confirm sidebar project count equals GET /api/projects count** — Test step involves numerical comparison but provides only a UI screenshot excerpt
- **2 Confirm sidebar project count equals GET /api/projects count** — The response_excerpt appears to be a page render mid-conversation rather than test output
- **3 Click + New Project and type "R1 Test Project mr40h734"** — No SSE events were captured during project creation, which may indicate streaming was not properly implemented or monitored
- **3 Click + New Project and type "R1 Test Project mr40h734"** — Multiple GET requests fired immediately after POST suggests eager fetching rather than relying on pushed state updates
- **3 Click + New Project and type "R1 Test Project mr40h734"** — Empty response_excerpt provides no visibility into what user feedback was displayed
- **4 Exchange #1 in test project (Invariant A check)** — Tractatus tree explosion: 32 nodes generated versus 8 allowed represents egregious budget violation
- **4 Exchange #1 in test project (Invariant A check)** — Response appears to have been truncated mid-word ('alist') suggesting the stream may have been interrupted, possibly due to the constraint violation
- **4 Exchange #1 in test project (Invariant A check)** — No evidence of self-correction or constraint awareness despite explicit Invariant A monitoring
- **4 Exchange #2 in test project (Invariant A check)** — The response appears to create excessive granularity in belief tracking for a straightforward factual question about water composition
- **4 Exchange #2 in test project (Invariant A check)** — Nine ASSERTS nodes for basic chemistry facts suggests potential over-fragmentation of knowledge representation
- **4 Exchange #3 in test project (Invariant A check)** — Stream terminated mid-word ('oblig') without completion marker, suggesting incomplete response transmission
- **4 Exchange #3 in test project (Invariant A check)** — Six tractatus nodes created for what appears to be a simple refusal, indicating possible over-documentation of the disagreement
- **4 Exchange #3 in test project (Invariant A check)** — No clear indication whether the user received the full rationale for the refusal before the stream cut off
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — Response excerpt contains no memory hierarchy content, tiers, or structured memory data despite successful API call
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — No verification that UI properly rendered the hierarchy information returned by the API
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — Unclear whether the button click actually navigated to a hierarchy view or remained on the chat interface
- **6 Plant distinctive fact: "XQ-77-blue"** — Complete absence of network activity despite clear user intent requiring LLM interaction
- **6 Plant distinctive fact: "XQ-77-blue"** — No response excerpt captured, indicating the user received no feedback whatsoever
- **6 Plant distinctive fact: "XQ-77-blue"** — Silent failure mode with no console errors makes debugging impossible
- **6 In a brand-new session, recall the secret** — Complete absence of network activity suggests the agent failed to initialize the chat flow
- **6 In a brand-new session, recall the secret** — Cross-session memory cannot be tested when no session interaction occurs
- **6 In a brand-new session, recall the secret** — The empty tractatus_delta (null) provides no insight into what the agent attempted or why it failed

## Harness sanity failures (4)

- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — r1_input < 10 chars
- **6 Plant distinctive fact: "XQ-77-blue"** — expected route not seen: POST /api/chat
- **6 In a brand-new session, recall the secret** — expected route not seen: POST /api/chat
- **harness** — Uncaught exception: fetch failed
