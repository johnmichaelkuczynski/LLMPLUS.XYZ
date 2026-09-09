# R1 Failures — 2026-09-09T19-57-51-407Z

## CRITICAL INVARIANT VIOLATIONS (20)

- **1 Send a simple chat from a freshly-loaded page** — Invariant A: tree grew by 9 (>8)
- **1 Send a simple chat from a freshly-loaded page** — Invariant A: at least one new node has invalid tag prefix
- **1 Send a simple chat from a freshly-loaded page** — Invariant A: at least one new node id is not decimal-formatted
- **1 Send a simple chat from a freshly-loaded page** — Invariant A violated: tree grew by 9 nodes (limit is 8)
- **1 Send a simple chat from a freshly-loaded page** — allTagsValid: false
- **1 Send a simple chat from a freshly-loaded page** — allIdsValid: false
- **1 Send a simple chat from a freshly-loaded page** — Tag-to-node mismatch: 25 node IDs vs 9 tags
- **2 Confirm sidebar project count equals GET /api/projects count** — Missing expected route: GET /api/projects was never called despite being listed in expected_routes
- **3 Click + New Project and type "R1 Test Project mtuiuuj8"** — Missing tractatus_delta for state-changing operation (project creation)
- **4 Exchange #1 in test project (Invariant A check)** — Invariant A: tree grew by 23 (>8)
- **4 Exchange #1 in test project (Invariant A check)** — Invariant A: tree grew by 23 nodes (limit: 8)
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — Missing tractatus_delta when the function being tested is explicitly memory hierarchy visualization — this should contain tier data or null with justification
- **6 Plant distinctive fact: "XQ-77-blue"** — Invariant A: tree grew by 0 after chat exchange
- **6 Plant distinctive fact: "XQ-77-blue"** — Missing expected route: POST /api/chat was never called
- **6 Plant distinctive fact: "XQ-77-blue"** — No SSE stream: zero events emitted when streaming is required for all LLM responses
- **6 Plant distinctive fact: "XQ-77-blue"** — Tractatus invariant A violated: tree must grow when new information is introduced but delta=0
- **6 In a brand-new session, recall the secret** — Invariant C VIOLATION: new session failed to recall "XQ-77-blue"
- **6 In a brand-new session, recall the secret** — Expected route POST /api/chat was never called (network_calls array is empty)
- **6 In a brand-new session, recall the secret** — No streaming occurred (sse_events array is empty, violating the streaming requirement)
- **6 In a brand-new session, recall the secret** — Empty response_excerpt indicates no output was delivered to user

## Judge concerns (28)

- **1 Send a simple chat from a freshly-loaded page** — Complete fabrication of user context (court filing, litigation, fee negotiation) with no basis in the actual query
- **1 Send a simple chat from a freshly-loaded page** — Inappropriate refusal to answer a straightforward academic question about reasoning methodologies
- **1 Send a simple chat from a freshly-loaded page** — Tractatus node count (25 new IDs) vastly exceeds tag count (9 tags), suggesting malformed graph structure
- **1 Send a simple chat from a freshly-loaded page** — Response tone is accusatory and inappropriate for a knowledge assistant
- **2 Confirm sidebar project count equals GET /api/projects count** — No network call was made despite the test step explicitly requiring validation against GET /api/projects
- **2 Confirm sidebar project count equals GET /api/projects count** — The agent appears to have only examined client-side rendered HTML rather than fetching and comparing server data
- **2 Confirm sidebar project count equals GET /api/projects count** — Impossible to verify the sidebar count accuracy without the API response payload
- **3 Click + New Project and type "R1 Test Project mtuiuuj8"** — tractatus_delta is null when project creation should trigger philosophical reflection on system state changes
- **3 Click + New Project and type "R1 Test Project mtuiuuj8"** — response_excerpt is empty, providing no evidence of user-facing confirmation or success messaging
- **3 Click + New Project and type "R1 Test Project mtuiuuj8"** — No SSE events captured despite the POST operation potentially warranting real-time updates
- **4 Exchange #1 in test project (Invariant A check)** — 23-node generation suggests the prompt or temperature settings encourage exhaustive rather than selective proposition extraction
- **4 Exchange #1 in test project (Invariant A check)** — Mix of ASSERTS/ASSUMES/OPEN/RESOLVED/REJECTS across 23 nodes may indicate valuable structural reasoning, but scale makes the tree unwieldy for human review
- **4 Exchange #1 in test project (Invariant A check)** — Response excerpt is empty despite successful streaming, making it impossible to verify coherence between rendered output and tractatus structure
- **4 Exchange #2 in test project (Invariant A check)** — Response is unusually terse ('Yes.') for an LLM assistant; lacks educational value or context about the speed of light constant
- **4 Exchange #2 in test project (Invariant A check)** — No elaboration on precision, measurement standards, or significance despite the question inviting such detail
- **4 Exchange #3 in test project (Invariant A check)** — The response was cut off mid-sentence ('but I haven't made'), suggesting the stream may have been truncated before completion
- **4 Exchange #3 in test project (Invariant A check)** — The tractatus added 4 nodes for a relatively simple correction; this seems slightly heavy though not unreasonable for tracking the false premise detection and resolution
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — No tractatus_delta provided despite the feature explicitly being 'Memory Hierarchy viewer' — unclear if hierarchy data was rendered
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — Response excerpt shows generic chat interface and an unrelated philosophy question rather than memory tier structures
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — No SSE events recorded; uncertain whether memory hierarchy supports streaming or if static rendering was expected
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — The API endpoint returned 200 but there's no evidence of what data structure was delivered or how UI reflected tier differentiation
- **6 Plant distinctive fact: "XQ-77-blue"** — No response excerpt captured despite the user expecting acknowledgment
- **6 Plant distinctive fact: "XQ-77-blue"** — Complete absence of streaming behavior suggests the agent may not have attempted LLM invocation at all
- **6 Plant distinctive fact: "XQ-77-blue"** — The violation note 'tree did not grow' confirms knowledge was never externalized into the graph structure
- **6 In a brand-new session, recall the secret** — Zero network activity despite expected POST /api/chat route usage
- **6 In a brand-new session, recall the secret** — Empty SSE events array indicates no streaming occurred
- **6 In a brand-new session, recall the secret** — Cross-session memory test is invalid without prior session establishing the secret
- **6 In a brand-new session, recall the secret** — No response content whatsoever suggests either a catastrophic error or complete non-execution

## Harness sanity failures (4)

- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — r1_input < 10 chars
- **6 Plant distinctive fact: "XQ-77-blue"** — expected route not seen: POST /api/chat
- **6 In a brand-new session, recall the secret** — expected route not seen: POST /api/chat
- **harness** — Uncaught exception: fetch failed
