# R1 Failures — 2026-07-02T20-49-08-346Z

## CRITICAL INVARIANT VIOLATIONS (18)

- **1 Send a simple chat from a freshly-loaded page** — Invariant A: tree grew by 73 (>8)
- **1 Send a simple chat from a freshly-loaded page** — Invariant A violated: tractatus grew by 73 nodes (delta: 73) when maximum permitted growth is 8 nodes per interaction
- **2 Confirm sidebar project count equals GET /api/projects count** — Expected route GET /api/projects not called
- **2 Confirm sidebar project count equals GET /api/projects count** — No streaming events captured (sse_events array empty)
- **2 Confirm sidebar project count equals GET /api/projects count** — tractatus_delta is null, violating streaming coherence requirement
- **3 Click + New Project and type "R1 Test Project mr3zbnj2"** — tractatus_delta is null - mandatory reasoning chain is completely absent
- **3 Click + New Project and type "R1 Test Project mr3zbnj2"** — response_excerpt is empty - no evidence of system response or confirmation provided
- **4 Exchange #1 in test project (Invariant A check)** — Invariant A: tree grew by 32 (>8)
- **4 Exchange #1 in test project (Invariant A check)** — Invariant A explicitly violated: tree grew by 32 nodes, exceeding the maximum threshold of 8
- **6 Plant distinctive fact: "XQ-77-blue"** — Invariant A: tree grew by 0 after chat exchange
- **6 Plant distinctive fact: "XQ-77-blue"** — Expected route POST /api/chat was never called
- **6 Plant distinctive fact: "XQ-77-blue"** — No SSE stream events emitted (empty sse_events array)
- **6 Plant distinctive fact: "XQ-77-blue"** — Tractatus invariant A violated: tree did not grow when new information was provided
- **6 Plant distinctive fact: "XQ-77-blue"** — Empty response_excerpt indicates no user acknowledgment was produced
- **6 In a brand-new session, recall the secret** — Invariant C VIOLATION: new session failed to recall "XQ-77-blue"
- **6 In a brand-new session, recall the secret** — Missing expected route: POST /api/chat was never called
- **6 In a brand-new session, recall the secret** — No SSE stream events were generated despite user interaction
- **6 In a brand-new session, recall the secret** — Empty response violates the streaming requirement for user-facing output

## Judge concerns (28)

- **1 Send a simple chat from a freshly-loaded page** — The 73-node delta represents nearly a 10x violation of the tractatus growth invariant, indicating the system may be creating redundant or overly-atomized knowledge structures
- **1 Send a simple chat from a freshly-loaded page** — Such extensive node creation for a straightforward philosophical explanation suggests inefficient memory architecture that could lead to scalability issues
- **1 Send a simple chat from a freshly-loaded page** — The response excerpt is empty, making it impossible to verify coherence between the streamed text and the tractatus structure
- **2 Confirm sidebar project count equals GET /api/projects count** — No network_calls array entries despite GET /api/projects being declared as expected
- **2 Confirm sidebar project count equals GET /api/projects count** — Response excerpt contains only UI shell and chat content, no project count validation performed
- **2 Confirm sidebar project count equals GET /api/projects count** — Missing streaming events or tractatus_delta that would document the comparison reasoning
- **3 Click + New Project and type "R1 Test Project mr3zbnj2"** — Missing response_excerpt prevents verification that the UI reflected the newly created project
- **3 Click + New Project and type "R1 Test Project mr3zbnj2"** — No SSE events captured suggests streaming may not be functioning or the agent is not monitoring real-time updates
- **3 Click + New Project and type "R1 Test Project mr3zbnj2"** — The additional GET requests (projects list, sessions, documents, staleness) suggest proper UI refresh, but without tractatus_delta we cannot confirm the agent's reasoning for these follow-up calls
- **4 Exchange #1 in test project (Invariant A check)** — The tractatus grew by 32 nodes from a single user question, which may indicate over-segmentation of conceptual content
- **4 Exchange #1 in test project (Invariant A check)** — No evidence of response length management or node consolidation logic
- **4 Exchange #1 in test project (Invariant A check)** — The response excerpt is empty, preventing validation of output quality against the streaming content
- **4 Exchange #2 in test project (Invariant A check)** — Four new tractatus nodes for a basic yes/no question with supporting detail appears to exceed necessary granularity
- **4 Exchange #2 in test project (Invariant A check)** — The presence of a DOCUMENT tag is unexpected for a conversational chemistry fact - unclear what document-level semantics justify this classification
- **4 Exchange #2 in test project (Invariant A check)** — Token chunking shows mid-word breaks ('c|ovalently', 'definit|ively', 'chem|ists') which, while functionally acceptable, suggests suboptimal tokenization boundaries
- **4 Exchange #3 in test project (Invariant A check)** — Response excerpt is empty despite text being streamed, making it impossible to verify final output quality
- **4 Exchange #3 in test project (Invariant A check)** — The streamed response appears incomplete, ending abruptly with 'confirmed' without finishing the thought or providing a complete sentence
- **4 Exchange #3 in test project (Invariant A check)** — The agent's confusion is justified, but it assumes the topic is water composition when the user's challenge was intentionally vague—a more robust response might seek clarification about which 'initial premises' are being referenced
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — Response excerpt contains no memory hierarchy data or UI elements despite successful API call
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — Cannot verify UI correctly displays tiered memory structure (pinned, project, chat, general contexts)
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — Unable to assess whether the viewer provides meaningful memory reconciliation interface
- **6 Plant distinctive fact: "XQ-77-blue"** — Agent failed to recognize an explicit memory instruction requiring LLM interaction
- **6 Plant distinctive fact: "XQ-77-blue"** — No user-facing feedback or acknowledgment was generated despite the prompt requesting confirmation
- **6 Plant distinctive fact: "XQ-77-blue"** — Cross-session persistence feature appears non-functional at the most basic level
- **6 In a brand-new session, recall the secret** — No network activity occurred despite the user prompt explicitly requesting information
- **6 In a brand-new session, recall the secret** — Empty response_excerpt indicates no SSE streaming took place
- **6 In a brand-new session, recall the secret** — The agent failed to attempt the expected POST /api/chat route
- **6 In a brand-new session, recall the secret** — Cross-session recall cannot be evaluated without an actual invocation attempt

## Harness sanity failures (4)

- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — r1_input < 10 chars
- **6 Plant distinctive fact: "XQ-77-blue"** — expected route not seen: POST /api/chat
- **6 In a brand-new session, recall the secret** — expected route not seen: POST /api/chat
- **harness** — Uncaught exception: fetch failed
