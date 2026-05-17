# R1 Failures — 2026-05-17T13-12-41-090Z

## CRITICAL INVARIANT VIOLATIONS (15)

- **1 Send a simple chat from a freshly-loaded page** — Invariant A: tree grew by 16 (>8)
- **1 Send a simple chat from a freshly-loaded page** — Invariant A: at least one new node has invalid tag prefix
- **1 Send a simple chat from a freshly-loaded page** — Tractatus delta violates Invariant A with 16 new nodes (exceeds 8 node limit)
- **2 Confirm sidebar project count equals GET /api/projects count** — Expected route GET /api/projects was not called
- **2 Confirm sidebar project count equals GET /api/projects count** — No network calls made despite route being required for test validation
- **3 Click + New Project and type "R1 Test Project mp9sqaq5"** — Created project not present in GET /api/projects
- **3 Click + New Project and type "R1 Test Project mp9sqaq5"** — Missing expected route: POST /api/projects was not called
- **3 Click + New Project and type "R1 Test Project mp9sqaq5"** — No network calls made despite user interaction
- **3 Click + New Project and type "R1 Test Project mp9sqaq5"** — Null tractatus delta violates state tracking requirements
- **13 Confirm #btn-mic exists and clicking it requests mic permission (no audio sent)** — Missing expected interaction with #btn-mic element
- **13 Confirm #btn-mic exists and clicking it requests mic permission (no audio sent)** — No demonstration of microphone permission request as specified in test step
- **14 POST /api/diagnostic/run and capture full pass/fail grid** — Missing expected route: POST /api/diagnostic/run was never called
- **14 POST /api/diagnostic/run and capture full pass/fail grid** — No network calls recorded despite test requirement
- **14 POST /api/diagnostic/run and capture full pass/fail grid** — Null tractatus_delta indicates missing core functionality
- **14 POST /api/diagnostic/run and capture full pass/fail grid** — No SSE events captured when diagnostic streaming was expected

## Judge concerns (19)

- **1 Send a simple chat from a freshly-loaded page** — Response claims to have previously answered the same question when this appears to be a fresh session
- **1 Send a simple chat from a freshly-loaded page** — Assistant incorrectly assumes ongoing legal case context that doesn't exist
- **1 Send a simple chat from a freshly-loaded page** — Content shows confusion between different conversation threads or sessions
- **1 Send a simple chat from a freshly-loaded page** — Quality of response is poor due to incorrect context assumptions
- **2 Confirm sidebar project count equals GET /api/projects count** — Missing critical API call prevents verification of the core test requirement
- **2 Confirm sidebar project count equals GET /api/projects count** — Cannot assess data consistency between UI and backend without API response
- **2 Confirm sidebar project count equals GET /api/projects count** — Test appears incomplete as it only captures UI state without validation
- **3 Click + New Project and type "R1 Test Project mp9sqaq5"** — Complete absence of network activity despite clear user action
- **3 Click + New Project and type "R1 Test Project mp9sqaq5"** — No tractatus delta indicating state management failure
- **3 Click + New Project and type "R1 Test Project mp9sqaq5"** — Missing response data suggests broken UI-backend communication
- **3 Click + New Project and type "R1 Test Project mp9sqaq5"** — No SSE events suggests real-time update mechanism is non-functional
- **13 Confirm #btn-mic exists and clicking it requests mic permission (no audio sent)** — No verification that #btn-mic element exists in the rendered interface
- **13 Confirm #btn-mic exists and clicking it requests mic permission (no audio sent)** — Missing evidence of microphone permission request flow
- **13 Confirm #btn-mic exists and clicking it requests mic permission (no audio sent)** — Test appears to show only static interface content without interactive functionality
- **13 Confirm #btn-mic exists and clicking it requests mic permission (no audio sent)** — Unclear if the voice feature is actually implemented or accessible
- **14 POST /api/diagnostic/run and capture full pass/fail grid** — No diagnostic endpoint execution occurred despite clear test specification
- **14 POST /api/diagnostic/run and capture full pass/fail grid** — Response content appears to be a project management interface rather than diagnostic results
- **14 POST /api/diagnostic/run and capture full pass/fail grid** — Complete absence of expected diagnostic pass/fail grid data
- **14 POST /api/diagnostic/run and capture full pass/fail grid** — No streaming events captured for what should be a diagnostic process

## Harness sanity failures (3)

- **3 Click + New Project and type "R1 Test Project mp9sqaq5"** — expected route not seen: POST /api/projects
- **14 POST /api/diagnostic/run and capture full pass/fail grid** — expected route not seen: POST /api/diagnostic/run
- **14 POST /api/diagnostic/run and capture full pass/fail grid** — r1_input < 10 chars
