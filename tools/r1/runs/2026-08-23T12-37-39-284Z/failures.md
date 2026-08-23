# R1 Failures — 2026-08-23T12-37-39-284Z

## CRITICAL INVARIANT VIOLATIONS (23)

- **1 Send a simple chat from a freshly-loaded page** — Invariant A: tree grew by 0 after chat exchange
- **1 Send a simple chat from a freshly-loaded page** — Invariant A: at least one new node has invalid tag prefix
- **1 Send a simple chat from a freshly-loaded page** — Invariant A: at least one new node id is not decimal-formatted
- **1 Send a simple chat from a freshly-loaded page** — Tractatus Invariant A violated: tree contracted (delta: -5) instead of growing
- **1 Send a simple chat from a freshly-loaded page** — allTagsValid=false indicates presence of invalid or missing node tags
- **1 Send a simple chat from a freshly-loaded page** — allIdsValid=false indicates malformed node identifiers in the tractatus structure
- **2 Confirm sidebar project count equals GET /api/projects count** — Expected route GET /api/projects was not called (network_calls array is empty)
- **3 Click + New Project and type "R1 Test Project mt5snw2p"** — Missing tractatus delta for state-changing operation
- **3 Click + New Project and type "R1 Test Project mt5snw2p"** — No streaming communication (sse_events empty) when system architecture appears to expect it
- **4 Exchange #1 in test project (Invariant A check)** — Invariant A: tree grew by 19 (>8)
- **4 Exchange #1 in test project (Invariant A check)** — Invariant A: tree grew by 19 nodes (>8 node threshold)
- **4 Exchange #1 in test project (Invariant A check)** — violationNote explicitly confirms the breach
- **4 Exchange #3 in test project (Invariant A check)** — Invariant A: tree grew by 12 (>8)
- **4 Exchange #3 in test project (Invariant A check)** — Invariant A: tractatus delta of 12 nodes exceeds the maximum permitted growth of 8 nodes per exchange
- **6 Plant distinctive fact: "XQ-77-blue"** — Invariant A: tree grew by 0 after chat exchange
- **6 Plant distinctive fact: "XQ-77-blue"** — Missing expected route: POST /api/chat was never called
- **6 Plant distinctive fact: "XQ-77-blue"** — Invariant A violated: tractatus tree must grow when processing new semantic content, remained at 37 nodes
- **6 Plant distinctive fact: "XQ-77-blue"** — No streaming response captured despite user input requiring acknowledgment
- **6 Plant distinctive fact: "XQ-77-blue"** — No response excerpt available, indicating complete pipeline failure
- **6 In a brand-new session, recall the secret** — Invariant C VIOLATION: new session failed to recall "XQ-77-blue"
- **6 In a brand-new session, recall the secret** — Missing expected POST /api/chat route - no network call was made
- **6 In a brand-new session, recall the secret** — No streaming response delivered despite being a chat interaction
- **6 In a brand-new session, recall the secret** — No response content available for evaluation

## Judge concerns (26)

- **1 Send a simple chat from a freshly-loaded page** — Response excerpt is empty despite successful streaming output
- **1 Send a simple chat from a freshly-loaded page** — Tractatus added 17 nodes but net contracted by 5, suggesting improper pruning or deletion
- **1 Send a simple chat from a freshly-loaded page** — Metadata nodes (metadata.context, metadata.branch_summary.6.0) appear in newNodeIds but may not be proper tree nodes
- **2 Confirm sidebar project count equals GET /api/projects count** — No network activity recorded when the test explicitly requires GET /api/projects to validate count accuracy
- **2 Confirm sidebar project count equals GET /api/projects count** — Unable to verify whether the 6 visible projects match the backend source of truth
- **2 Confirm sidebar project count equals GET /api/projects count** — Test step is effectively unexecuted despite appearing to load the interface
- **3 Click + New Project and type "R1 Test Project mt5snw2p"** — Tractatus delta is null despite a state-changing operation (project creation) that should generate delta updates
- **3 Click + New Project and type "R1 Test Project mt5snw2p"** — No SSE events were emitted for what appears to be an asynchronous or stream-capable operation
- **3 Click + New Project and type "R1 Test Project mt5snw2p"** — Response excerpt is empty, providing no confirmation or feedback to the user about the created project
- **3 Click + New Project and type "R1 Test Project mt5snw2p"** — The subsequent GET requests suggest the UI updated, but without delta/streaming this breaks the expected communication pattern
- **4 Exchange #1 in test project (Invariant A check)** — 19-node growth from one philosophical question suggests poor chunking granularity or misclassification of sub-arguments as independent nodes
- **4 Exchange #1 in test project (Invariant A check)** — The tag distribution (heavy ASSERTS bias with limited dialectical diversity) implies the system is atomizing claims rather than preserving argumentative structure
- **4 Exchange #1 in test project (Invariant A check)** — No evidence of consolidation or pruning mechanisms—system appears to treat every clause as tractatus-worthy
- **4 Exchange #2 in test project (Invariant A check)** — The response could be slightly more structured in the knowledge graph—breaking down 'two hydrogen atoms' and 'one oxygen atom' and 'covalent bonding' into separate assertions is somewhat granular for such a simple fact, though it does provide good atomic decomposition
- **4 Exchange #3 in test project (Invariant A check)** — The response text appears truncated mid-sentence ('We') in the SSE excerpt, though this may be a logging artifact rather than actual streaming failure
- **4 Exchange #3 in test project (Invariant A check)** — Twelve new tractatus nodes for a straightforward factual correction seems excessive — the distinction between P and NP could likely be captured in 6-8 nodes
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — No memory hierarchy data visible in response excerpt despite successful API call
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — Response shows only navigation elements and unrelated chat content about Wittgenstein
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — Unable to verify UI-to-API tier reconciliation as specified in the test step
- **6 Plant distinctive fact: "XQ-77-blue"** — Zero response to user input suggests a catastrophic failure in the request-response cycle
- **6 Plant distinctive fact: "XQ-77-blue"** — No attempt to persist or acknowledge the seed fact 'XQ-77-blue' undermines the entire cross-session persistence test
- **6 Plant distinctive fact: "XQ-77-blue"** — Absence of SSE events indicates streaming was never initiated or captured
- **6 In a brand-new session, recall the secret** — Complete absence of network activity suggests the agent did not attempt to process or send the user's query
- **6 In a brand-new session, recall the secret** — No streaming events or response excerpt indicates total communication breakdown
- **6 In a brand-new session, recall the secret** — Impossible to evaluate cross-session recall capabilities when the base chat functionality is non-operational
- **6 In a brand-new session, recall the secret** — The test provides no data about whether memory systems were even queried

## Harness sanity failures (4)

- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — r1_input < 10 chars
- **6 Plant distinctive fact: "XQ-77-blue"** — expected route not seen: POST /api/chat
- **6 In a brand-new session, recall the secret** — expected route not seen: POST /api/chat
- **harness** — Uncaught exception: fetch failed
