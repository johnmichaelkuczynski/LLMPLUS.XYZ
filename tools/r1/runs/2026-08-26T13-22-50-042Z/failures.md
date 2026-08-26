# R1 Failures — 2026-08-26T13-22-50-042Z

## CRITICAL INVARIANT VIOLATIONS (22)

- **1 Send a simple chat from a freshly-loaded page** — Invariant A: tree grew by 9 (>8)
- **1 Send a simple chat from a freshly-loaded page** — Invariant A: at least one new node has invalid tag prefix
- **1 Send a simple chat from a freshly-loaded page** — Invariant A: at least one new node id is not decimal-formatted
- **1 Send a simple chat from a freshly-loaded page** — Invariant A violated: tree grew by 9 nodes (maximum allowed: 8)
- **1 Send a simple chat from a freshly-loaded page** — allTagsValid returned false, indicating malformed or invalid tags in the tractatus delta
- **1 Send a simple chat from a freshly-loaded page** — allIdsValid returned false, indicating malformed node identifiers in the knowledge graph
- **2 Confirm sidebar project count equals GET /api/projects count** — Expected route GET /api/projects was not called (network_calls array is empty)
- **2 Confirm sidebar project count equals GET /api/projects count** — No SSE stream or reasoning artifacts present despite the step requiring a comparison operation
- **3 Click + New Project and type "R1 Test Project mta4kw16"** — tractatus_delta is null for a state-changing operation (project creation) that must update the knowledge graph
- **3 Click + New Project and type "R1 Test Project mta4kw16"** — No SSE events present despite POST operation where streaming response is architecturally expected
- **4 Exchange #1 in test project (Invariant A check)** — Invariant A: tree grew by 20 (>8)
- **4 Exchange #1 in test project (Invariant A check)** — Invariant A: tractatus grew by 20 nodes, exceeding the strict 8-node-per-exchange limit by 150%
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — Missing tractatus delta for a memory structure viewing operation
- **6 Plant distinctive fact: "XQ-77-blue"** — Invariant A: tree grew by 0 after chat exchange
- **6 Plant distinctive fact: "XQ-77-blue"** — Missing expected route: POST /api/chat was never called
- **6 Plant distinctive fact: "XQ-77-blue"** — No SSE streaming events captured (streaming requirement not met)
- **6 Plant distinctive fact: "XQ-77-blue"** — Tractatus Invariant A violated: tree failed to grow when receiving novel information requiring memorization
- **6 Plant distinctive fact: "XQ-77-blue"** — Empty response_excerpt indicates no user-facing output was generated
- **6 In a brand-new session, recall the secret** — Invariant C VIOLATION: new session failed to recall "XQ-77-blue"
- **6 In a brand-new session, recall the secret** — Missing expected route: POST /api/chat was never called
- **6 In a brand-new session, recall the secret** — No SSE stream initiated despite expected streaming response pattern
- **6 In a brand-new session, recall the secret** — Zero tractatus_delta when context retrieval should have modified or queried the knowledge base

## Judge concerns (28)

- **1 Send a simple chat from a freshly-loaded page** — The response references specific project context ('3 PM call with Melnick', 'Li Weng withdrawal notice') that may not exist in the conversation history, potentially hallucinating project details
- **1 Send a simple chat from a freshly-loaded page** — Nine new node IDs were created but only eight tags are listed, indicating a mismatch between nodes and their metadata
- **2 Confirm sidebar project count equals GET /api/projects count** — No programmatic verification occurred; the tester appears to have visually inspected the sidebar without fetching the authoritative project count from the API endpoint
- **2 Confirm sidebar project count equals GET /api/projects count** — The response excerpt is excessively verbose UI content with no analytical content or count comparison
- **2 Confirm sidebar project count equals GET /api/projects count** — Missing tractatus_delta suggests no reasoning process was tracked for this validation step
- **3 Click + New Project and type "R1 Test Project mta4kw16"** — No SSE streaming events captured for a project creation operation that should provide real-time feedback
- **3 Click + New Project and type "R1 Test Project mta4kw16"** — Empty response_excerpt means no validation of user-facing confirmation or success messaging
- **3 Click + New Project and type "R1 Test Project mta4kw16"** — Multiple GET requests fired immediately after POST suggests potential over-fetching or lack of optimistic UI updates
- **4 Exchange #1 in test project (Invariant A check)** — Adding 20 nodes for a single philosophical question suggests the extraction heuristics are miscalibrated—most exchanges should add 2-4 nodes maximum
- **4 Exchange #1 in test project (Invariant A check)** — The mix of tags (QUESTION, ASSERTS, DOCUMENT, RESOLVED) appears scattered across 20 nodes without clear hierarchical justification
- **4 Exchange #1 in test project (Invariant A check)** — No response excerpt provided makes it impossible to assess whether the answer quality justified this excessive memory allocation
- **4 Exchange #2 in test project (Invariant A check)** — Response coherence is minimal—a one-word answer with punctuation does not constitute meaningful dialogue
- **4 Exchange #2 in test project (Invariant A check)** — No explanation, confirmation of understanding, or educational elaboration provided
- **4 Exchange #2 in test project (Invariant A check)** — The tractatus delta shows substantive internal reasoning (4 new nodes including ASSERTS tags) but this cognitive work is completely invisible in the user-facing output
- **4 Exchange #2 in test project (Invariant A check)** — Streaming two separate events for 'Yes' and '.' suggests unnecessary fragmentation of an already minimal response
- **4 Exchange #3 in test project (Invariant A check)** — Six tractatus nodes for a short restatement of a definitional fact may indicate excessive granularity in belief tracking
- **4 Exchange #3 in test project (Invariant A check)** — The response, while correct, could have been more concise given that it's defending an uncontroversial fact
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — No visible memory hierarchy data in the response excerpt despite successful 200 status
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — Response excerpt shows only navigation elements and an unrelated chat conversation
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — Zero tractatus delta when memory hierarchy viewing should generate structural context
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — No verification that API response contained expected memory tier data or that UI rendered it
- **6 Plant distinctive fact: "XQ-77-blue"** — No attempt to communicate with the LLMPlus backend despite explicit memory instruction
- **6 Plant distinctive fact: "XQ-77-blue"** — Complete absence of streaming response suggests no API interaction occurred
- **6 Plant distinctive fact: "XQ-77-blue"** — The distinctive seed fact 'XQ-77-blue' was not processed or acknowledged
- **6 Plant distinctive fact: "XQ-77-blue"** — Zero delta in tractatus nodes indicates no knowledge persistence mechanism was triggered
- **6 In a brand-new session, recall the secret** — No network activity whatsoever suggests the agent failed to integrate or invoke the LLMPlus API
- **6 In a brand-new session, recall the secret** — Cross-session recall requires retrieval mechanisms (memory, context search, or session bridging) which cannot function without API interaction
- **6 In a brand-new session, recall the secret** — Empty response_excerpt with no streaming events indicates a complete pipeline breakdown

## Harness sanity failures (4)

- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — r1_input < 10 chars
- **6 Plant distinctive fact: "XQ-77-blue"** — expected route not seen: POST /api/chat
- **6 In a brand-new session, recall the secret** — expected route not seen: POST /api/chat
- **harness** — Uncaught exception: fetch failed
