# R1 Failures — 2026-07-02T20-36-49-077Z

## CRITICAL INVARIANT VIOLATIONS (6)

- **2 Confirm sidebar project count equals GET /api/projects count** — Missing expected route: GET /api/projects was not called
- **2 Confirm sidebar project count equals GET /api/projects count** — No streaming events captured despite this being a user-facing interaction that should trigger SSE
- **2 Confirm sidebar project count equals GET /api/projects count** — Tractatus delta is null when the step involves a state-verification assertion that should be logged
- **4 Exchange #1 in test project (Invariant A check)** — Invariant A: tree grew by 32 (>8)
- **4 Exchange #1 in test project (Invariant A check)** — Invariant A: tree grew by 32 nodes, exceeding the maximum allowed growth of 8 nodes by 300%
- **4 Exchange #3 in test project (Invariant A check)** — Incomplete SSE stream: response text ends mid-word without proper termination or 'done' event

## Judge concerns (16)

- **2 Confirm sidebar project count equals GET /api/projects count** — No interaction or verification logic was executed despite the step having a clear confirmation requirement
- **2 Confirm sidebar project count equals GET /api/projects count** — The response excerpt shows only static UI elements with no indication of attempting to count visible projects or await API data
- **2 Confirm sidebar project count equals GET /api/projects count** — Impossible to determine if the test passed or failed without the required GET /api/projects call
- **3 Click + New Project and type "R1 Test Project mr3yuwpl"** — tractatus_delta is null with no response_excerpt or SSE events, providing no confirmation of LLM acknowledgment or streaming output
- **3 Click + New Project and type "R1 Test Project mr3yuwpl"** — Multiple redundant GET requests (sessions and documents fetched twice) suggest potential inefficiency or polling behavior
- **4 Exchange #1 in test project (Invariant A check)** — Massive tractatus bloat (32 nodes) suggests the agent failed to synthesize a focused argumentative structure
- **4 Exchange #1 in test project (Invariant A check)** — The presence of two OPEN tags amid 30 ASSERTS nodes may indicate the response remained incomplete or overly exploratory
- **4 Exchange #1 in test project (Invariant A check)** — Response was truncated in the excerpt, making full coherence assessment impossible
- **4 Exchange #2 in test project (Invariant A check)** — Text streaming fragments words unnaturally mid-syllable, creating a jarring reading experience
- **4 Exchange #2 in test project (Invariant A check)** — The response appears truncated ('in' as final token), suggesting incomplete streaming or premature termination
- **4 Exchange #3 in test project (Invariant A check)** — SSE stream terminates abruptly mid-word ('decom'), indicating incomplete response delivery
- **4 Exchange #3 in test project (Invariant A check)** — Unable to verify full response coherence due to truncation—cannot assess whether the agent completed its justification adequately
- **4 Exchange #3 in test project (Invariant A check)** — The response_excerpt field is empty, which should contain representative content from the completed response
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — Response excerpt contains no memory hierarchy data, tiers, or structured memory information despite successful API call
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — No validation that UI displays reconciliation between different memory tiers (pinned, project, session, etc.)
- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — Cannot verify if the viewer distinguishes between memory sources or presents hierarchy levels clearly

## Harness sanity failures (2)

- **5 Click 🧠 Memory Hierarchy button; reconcile UI tiers with API** — r1_input < 10 chars
- **harness** — Uncaught exception: browserContext.cookies: Target page, context or browser has been closed
