# R1 Failures — 2026-07-04T16-12-02-363Z

## CRITICAL INVARIANT VIOLATIONS (27)

- **1 Send a simple chat from a freshly-loaded page** — Invariant A: tree grew by 14 (>8)
- **1 Send a simple chat from a freshly-loaded page** — Invariant A: at least one new node has invalid tag prefix
- **1 Send a simple chat from a freshly-loaded page** — Invariant A: at least one new node id is not decimal-formatted
- **1 Send a simple chat from a freshly-loaded page** — Invariant A violated: tree grew by 14 nodes, exceeding the maximum delta of 8
- **1 Send a simple chat from a freshly-loaded page** — allTagsValid=false indicates tag validation failures
- **1 Send a simple chat from a freshly-loaded page** — allIdsValid=false indicates node ID structure violations
- **2 Confirm sidebar project count equals GET /api/projects count** — Missing expected route: GET /api/projects was not called
- **2 Confirm sidebar project count equals GET /api/projects count** — No streaming or SSE events occurred when the test step required data fetching
- **4 Exchange #1 in test project (Invariant A check)** — Invariant A: tree grew by 48 (>8)
- **4 Exchange #1 in test project (Invariant A check)** — Invariant A: tractatus grew by 48 nodes (limit: 8) - delta exceeds budget by 40 nodes
- **4 Exchange #2 in test project (Invariant A check)** — Invariant A: tree grew by 14 (>8)
- **4 Exchange #2 in test project (Invariant A check)** — Invariant A: added 14 nodes, maximum allowed is 8
- **4 Exchange #2 in test project (Invariant A check)** — tractatus_delta shows nodesBefore=48, nodesAfter=62, violating growth constraint
- **4 Exchange #3 in test project (Invariant A check)** — Invariant A: tree grew by 0 after chat exchange
- **4 Exchange #3 in test project (Invariant A check)** — No SSE stream on chat route (expected thought/content/node events)
- **4 Exchange #3 in test project (Invariant A check)** — Invariant A: Tractatus tree failed to grow on valid conversational exchange
- **4 Exchange #3 in test project (Invariant A check)** — Response coherence failure: user receives no acknowledgment or reply to their input
- **6 Plant distinctive fact: "XQ-77-blue"** — Invariant A: tree grew by 0 after chat exchange
- **6 Plant distinctive fact: "XQ-77-blue"** — Expected route POST /api/chat was never called
- **6 Plant distinctive fact: "XQ-77-blue"** — No SSE stream initiated (required for user-facing responses)
- **6 Plant distinctive fact: "XQ-77-blue"** — Invariant A violated: tractatus tree did not grow when new memorable information was introduced
- **6 Plant distinctive fact: "XQ-77-blue"** — Missing response excerpt indicates complete response failure
- **6 In a brand-new session, recall the secret** — Invariant C VIOLATION: new session failed to recall "XQ-77-blue"
- **6 In a brand-new session, recall the secret** — No POST /api/chat call made despite explicit expected_routes requirement
- **6 In a brand-new session, recall the secret** — No SSE streaming events generated, violating the fundamental streaming response architecture
- **6 In a brand-new session, recall the secret** — Empty response violates the basic requirement that agents must produce output for user queries
- **6 In a brand-new session, recall the secret** — Missing tractatus_delta indicates no state tracking occurred

## Judge concerns (28)

- **1 Send a simple chat from a freshly-loaded page** — All 20 new nodes are uniformly tagged as ASSERTS, which is inappropriate for definitional and explanatory content about Kant's philosophical distinctions
- **1 Send a simple chat from a freshly-loaded page** — The response appears to be a straightforward philosophical explanation, yet the system created nearly double the permitted node budget
- **1 Send a simple chat from a freshly-loaded page** — Node IDs like 'nodes.8.2.1' through 'nodes.8.7.2' suggest fragmentation that may not align with semantic boundaries in the content
- **2 Confirm sidebar project count equals GET /api/projects count** — No network activity was initiated despite the test explicitly requiring a comparison between UI state and API data
- **2 Confirm sidebar project count equals GET /api/projects count** — The agent appears to have passively observed the UI rather than actively querying the backend
- **2 Confirm sidebar project count equals GET /api/projects count** — The response excerpt terminates mid-sentence in unrelated philosophical content, suggesting focus drift or context confusion
- **3 Click + New Project and type "R1 Test Project mr6karot"** — tractatus_delta is null despite a state-modifying operation (project creation) occurring
- **3 Click + New Project and type "R1 Test Project mr6karot"** — No SSE events streamed despite project creation being a significant state change
- **3 Click + New Project and type "R1 Test Project mr6karot"** — response_excerpt is empty, providing no evidence of user-facing confirmation
- **4 Exchange #1 in test project (Invariant A check)** — The response appears to be building an excessively detailed epistemic tree for what could be addressed more concisely
- **4 Exchange #1 in test project (Invariant A check)** — The streaming text shows mid-word breaks ('stu'/'bbornly', 'res'/'ists', 'un'/'resolved', 'subj'/'ective') which suggest tokenization issues that may correlate with poor chunking decisions
- **4 Exchange #1 in test project (Invariant A check)** — No response excerpt provided makes it impossible to verify if the excessive node count produced proportionally valuable content
- **4 Exchange #2 in test project (Invariant A check)** — Response granularity seems excessive—13 ASSERTS tags for a straightforward historical fact suggests over-decomposition
- **4 Exchange #2 in test project (Invariant A check)** — No evidence of synthesis or consolidation; each minor claim gets its own node rather than grouping related assertions
- **4 Exchange #3 in test project (Invariant A check)** — No streaming events delivered despite successful POST, creating a broken user experience
- **4 Exchange #3 in test project (Invariant A check)** — Empty response_excerpt indicates the UI received nothing to display
- **4 Exchange #3 in test project (Invariant A check)** — Invariant A violation suggests either backend failed to generate content or streaming pipeline is severed
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — Response excerpt contains zero memory hierarchy content — only shows sidebar navigation and an unrelated chat about consciousness
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — No evidence of UI reconciliation with API data; the excerpt doesn't demonstrate what memory tiers or hierarchy structure was rendered
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — Missing tractatus_delta prevents verification of whether memory context was properly structured or integrated
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — Test step claims to 'reconcile UI tiers with API' but provides no validation artifacts showing this reconciliation occurred
- **6 Plant distinctive fact: "XQ-77-blue"** — Complete absence of any response mechanism—no streaming events means the user received no feedback
- **6 Plant distinctive fact: "XQ-77-blue"** — Zero network activity suggests the agent failed to initialize or invoke the chat endpoint entirely
- **6 Plant distinctive fact: "XQ-77-blue"** — No acknowledgment was provided despite the user explicitly requesting one
- **6 In a brand-new session, recall the secret** — Complete absence of network activity suggests the agent never attempted to process the user's request
- **6 In a brand-new session, recall the secret** — Empty response_excerpt indicates no user-facing output was generated, creating a silent failure experience
- **6 In a brand-new session, recall the secret** — Cross-session memory test cannot be evaluated when the system fails to engage with the request at all
- **6 In a brand-new session, recall the secret** — No tractatus_delta measurement means we cannot assess whether the system even recognized this as a recall task

## Harness sanity failures (4)

- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — r1_input < 10 chars
- **6 Plant distinctive fact: "XQ-77-blue"** — expected route not seen: POST /api/chat
- **6 In a brand-new session, recall the secret** — expected route not seen: POST /api/chat
- **harness** — Uncaught exception: terminated
