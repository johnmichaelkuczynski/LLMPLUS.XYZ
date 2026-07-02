# R1 Failures — 2026-07-02T20-32-07-880Z

## CRITICAL INVARIANT VIOLATIONS (4)

- **2 Confirm sidebar project count equals GET /api/projects count** — Missing expected route: GET /api/projects was never called
- **2 Confirm sidebar project count equals GET /api/projects count** — Step objective not executed: no count comparison was performed
- **4 Exchange #1 in test project (Invariant A check)** — Invariant A: tree grew by 45 (>8)
- **4 Exchange #1 in test project (Invariant A check)** — Invariant A: Generated 45 nodes when maximum allowed is 8 (violation factor: 5.6x)

## Judge concerns (10)

- **2 Confirm sidebar project count equals GET /api/projects count** — No attempt was made to fetch project data via the expected route
- **2 Confirm sidebar project count equals GET /api/projects count** — The UI shows navigation elements but no actual project list to count
- **2 Confirm sidebar project count equals GET /api/projects count** — The agent appears to have halted after page load without performing the required verification
- **3 Click + New Project and type "R1 Test Project mr3yot20"** — No tractatus_delta present despite a state-changing operation (project creation)
- **3 Click + New Project and type "R1 Test Project mr3yot20"** — Missing response_excerpt prevents verification of user feedback
- **3 Click + New Project and type "R1 Test Project mr3yot20"** — No SSE events recorded; unclear if streaming was attempted or required
- **3 Click + New Project and type "R1 Test Project mr3yot20"** — Excessive polling (8 GET requests post-creation) may indicate inefficient state synchronization
- **4 Exchange #1 in test project (Invariant A check)** — The 45-node generation represents a massive overshoot of the 8-node limit, suggesting either the constraint is not implemented or is being systematically ignored
- **4 Exchange #1 in test project (Invariant A check)** — Such explosive tree growth in early exchanges will lead to tractatus bloat and undermine the system's ability to maintain coherent knowledge structure over longer conversations
- **4 Exchange #1 in test project (Invariant A check)** — The response excerpt is empty despite 30+ text streaming events, making it impossible to verify response coherence fully

## Harness sanity failures (1)

- **harness** — Uncaught exception: browserContext.cookies: Target page, context or browser has been closed
