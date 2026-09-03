# R1 Failures — 2026-09-03T19-13-23-551Z

## CRITICAL INVARIANT VIOLATIONS (22)

- **1 Send a simple chat from a freshly-loaded page** — Invariant A: tree grew by 0 after chat exchange
- **1 Send a simple chat from a freshly-loaded page** — Invariant A: at least one new node has invalid tag prefix
- **1 Send a simple chat from a freshly-loaded page** — Invariant A: at least one new node id is not decimal-formatted
- **1 Send a simple chat from a freshly-loaded page** — Tractatus Invariant A violated: tree contracted instead of growing during active dialogue
- **1 Send a simple chat from a freshly-loaded page** — allTagsValid=false indicates tag schema violations in delta
- **1 Send a simple chat from a freshly-loaded page** — allIdsValid=false indicates malformed node identifiers
- **1 Send a simple chat from a freshly-loaded page** — Response completely fails to address user query (extreme coherence failure)
- **1 Send a simple chat from a freshly-loaded page** — Node IDs use incorrect namespace pattern (metadata.* without proper qualification)
- **2 Confirm sidebar project count equals GET /api/projects count** — Expected route GET /api/projects was not called (network_calls array is empty)
- **3 Click + New Project and type "R1 Test Project mtlwn70i"** — tractatus_delta is null instead of containing token count data from the required LLM stream
- **3 Click + New Project and type "R1 Test Project mtlwn70i"** — No SSE events present despite streaming being mandatory for all LLMPlus operations
- **4 Exchange #1 in test project (Invariant A check)** — Invariant A: tree grew by 24 (>8)
- **4 Exchange #1 in test project (Invariant A check)** — Invariant A: Maximum 8 nodes per exchange, actual delta was 24 nodes
- **6 Plant distinctive fact: "XQ-77-blue"** — Invariant A: tree grew by 0 after chat exchange
- **6 Plant distinctive fact: "XQ-77-blue"** — Expected route POST /api/chat was never called
- **6 Plant distinctive fact: "XQ-77-blue"** — No SSE events emitted (streaming requirement not met)
- **6 Plant distinctive fact: "XQ-77-blue"** — Tractatus invariant A violated: tree must grow on meaningful user interaction
- **6 Plant distinctive fact: "XQ-77-blue"** — No response delivered to user (empty response_excerpt with no network calls)
- **6 In a brand-new session, recall the secret** — Invariant C VIOLATION: new session failed to recall "XQ-77-blue"
- **6 In a brand-new session, recall the secret** — Expected route 'POST /api/chat' was not called - network_calls array is empty
- **6 In a brand-new session, recall the secret** — No SSE streaming events were captured despite streaming being a core requirement
- **6 In a brand-new session, recall the secret** — No response content was recorded, violating the expectation of coherent output

## Judge concerns (27)

- **1 Send a simple chat from a freshly-loaded page** — Total semantic disconnect between query and response content
- **1 Send a simple chat from a freshly-loaded page** — Response appears to be pulled from completely unrelated context or training data
- **1 Send a simple chat from a freshly-loaded page** — Tractatus shrinkage (-11 nodes) in a fresh chat session suggests memory corruption or improper pruning
- **1 Send a simple chat from a freshly-loaded page** — Streaming was abruptly cut off mid-word ('proc'), indicating potential error handling failure
- **2 Confirm sidebar project count equals GET /api/projects count** — No network activity occurred despite the step explicitly requiring GET /api/projects
- **2 Confirm sidebar project count equals GET /api/projects count** — Unable to determine if sidebar count matches API response since API was never queried
- **2 Confirm sidebar project count equals GET /api/projects count** — The agent appears to have only captured a UI screenshot without performing the validation logic
- **3 Click + New Project and type "R1 Test Project mtlwn70i"** — Zero SSE events during project creation suggests streaming was not implemented or failed silently
- **3 Click + New Project and type "R1 Test Project mtlwn70i"** — Empty response_excerpt provides no evidence of user communication or confirmatory feedback
- **3 Click + New Project and type "R1 Test Project mtlwn70i"** — The tractatus_delta being null rather than an empty object or zero suggests the streaming infrastructure wasn't invoked at all
- **4 Exchange #1 in test project (Invariant A check)** — Tractatus grew by 24 nodes (300% over the 8-node limit), indicating poor knowledge chunking strategy
- **4 Exchange #1 in test project (Invariant A check)** — Six top-level document nodes (1.0-6.0) suggest excessive fragmentation rather than integrated understanding
- **4 Exchange #1 in test project (Invariant A check)** — No evidence of consolidation or hierarchical depth—flat structure defeats the purpose of numbered propositions
- **4 Exchange #2 in test project (Invariant A check)** — Response is excessively brief (two characters) for a conversational AI system, suggesting minimal engagement
- **4 Exchange #2 in test project (Invariant A check)** — No explanatory value added (e.g., showing calculation, confirming √144 = 12, or contextualizing the answer)
- **4 Exchange #2 in test project (Invariant A check)** — The DOCUMENT and ASSERTS tags suggest knowledge capture occurred, but the value of memorializing such a trivial fact is questionable
- **4 Exchange #3 in test project (Invariant A check)** — The streaming contains a mojibake artifact ('Ã—' instead of '×'), indicating a character encoding issue in the SSE transport or serialization layer
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — Response excerpt contains no memory hierarchy data—only navigation chrome and chat content unrelated to the feature being tested
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — Zero SSE events recorded despite memory hierarchy potentially requiring streaming for large or structured data
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — No tractatus_delta despite the memory hierarchy viewer likely needing to reference or display tractatus-derived context tiers
- **6 Plant distinctive fact: "XQ-77-blue"** — Zero network activity despite explicit user request requiring memory persistence
- **6 Plant distinctive fact: "XQ-77-blue"** — Tractatus graph failed to grow, indicating no semantic node creation for the memorable fact 'XQ-77-blue'
- **6 Plant distinctive fact: "XQ-77-blue"** — No streaming response means user received no acknowledgment, violating basic conversational contract
- **6 Plant distinctive fact: "XQ-77-blue"** — Empty response_excerpt suggests total UI/UX breakdown
- **6 In a brand-new session, recall the secret** — Complete absence of network activity suggests the agent failed to invoke the chat API entirely
- **6 In a brand-new session, recall the secret** — Cross-session memory retrieval requires persistence mechanisms that were never tested due to lack of API calls
- **6 In a brand-new session, recall the secret** — The test structure appears valid but execution was non-existent, making it impossible to evaluate LLMPlus's actual cross-session capabilities

## Harness sanity failures (4)

- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — r1_input < 10 chars
- **6 Plant distinctive fact: "XQ-77-blue"** — expected route not seen: POST /api/chat
- **6 In a brand-new session, recall the secret** — expected route not seen: POST /api/chat
- **harness** — Uncaught exception: fetch failed
