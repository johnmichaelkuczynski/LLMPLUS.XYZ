# R1 Failures — 2026-07-04T20-53-41-484Z

## CRITICAL INVARIANT VIOLATIONS (10)

- **1 Send a simple chat from a freshly-loaded page** — Invariant A: tree grew by 0 after chat exchange
- **1 Send a simple chat from a freshly-loaded page** — Invariant A: at least one new node has invalid tag prefix
- **1 Send a simple chat from a freshly-loaded page** — Invariant A: at least one new node id is not decimal-formatted
- **1 Send a simple chat from a freshly-loaded page** — Invariant A violated: tractatus tree decreased by 21 nodes instead of growing
- **1 Send a simple chat from a freshly-loaded page** — allTagsValid = false (tag schema violations present)
- **1 Send a simple chat from a freshly-loaded page** — allIdsValid = false (ID format violations present)
- **1 Send a simple chat from a freshly-loaded page** — violationNote confirms 'tree did not grow' hard constraint failure
- **2 Confirm sidebar project count equals GET /api/projects count** — Expected route GET /api/projects was not called (network_calls array is empty)
- **3 Click + New Project and type "R1 Test Project mr6uda1q"** — No SSE stream initiated despite tractatus requirement for streaming responses
- **3 Click + New Project and type "R1 Test Project mr6uda1q"** — tractatus_delta is null, indicating complete absence of incremental reasoning display

## Judge concerns (9)

- **1 Send a simple chat from a freshly-loaded page** — Agent hallucinated prior conversation history on a fresh page load
- **1 Send a simple chat from a freshly-loaded page** — Response excerpt is empty despite SSE events showing substantial text generation
- **1 Send a simple chat from a freshly-loaded page** — Tractatus nodesBefore (119) suggests prior state shouldn't exist for a fresh load
- **2 Confirm sidebar project count equals GET /api/projects count** — No network activity occurred despite an explicit expectation of GET /api/projects
- **2 Confirm sidebar project count equals GET /api/projects count** — Sidebar displays two projects but the agent never validated this count against backend state
- **2 Confirm sidebar project count equals GET /api/projects count** — The response excerpt shows unrelated philosophical content about mathematical objects, indicating possible context confusion or improper test scoping
- **3 Click + New Project and type "R1 Test Project mr6uda1q"** — No streaming response provided during project creation, leaving users without real-time feedback
- **3 Click + New Project and type "R1 Test Project mr6uda1q"** — Empty response_excerpt suggests no confirmation message or guidance was displayed
- **3 Click + New Project and type "R1 Test Project mr6uda1q"** — Subsequent GET requests appear automated but lack context about whether they contributed to user-visible updates

## Harness sanity failures (1)

- **harness** — Uncaught exception: fetch failed
