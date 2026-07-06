# R1 Failures — 2026-07-06T00-12-35-435Z

## CRITICAL INVARIANT VIOLATIONS (2)

- **2 Confirm sidebar project count equals GET /api/projects count** — Expected route GET /api/projects was not called
- **2 Confirm sidebar project count equals GET /api/projects count** — No tractatus_delta provided (null) when state change should document authentication failure or test abortion

## Judge concerns (4)

- **2 Confirm sidebar project count equals GET /api/projects count** — No network calls were made despite GET /api/projects being explicitly expected
- **2 Confirm sidebar project count equals GET /api/projects count** — Agent encountered authentication barrier but did not attempt to authenticate or report inability to proceed
- **2 Confirm sidebar project count equals GET /api/projects count** — Test step requires comparing sidebar count to API response count, but neither data point was obtained
- **2 Confirm sidebar project count equals GET /api/projects count** — Response excerpt suggests agent is viewing a public landing page rather than the authenticated application interface

## Harness sanity failures (1)

- **harness** — Uncaught exception: page.fill: Timeout 30000ms exceeded.
Call log:
[2m  - waiting for locator('#project-name-input')[22m
[2m    - locator resolved to <input type="text" class="text-input" id="project-name-input" placeholder="Project name" data-testid="input-project-name"/>[22m
[2m    - fill("R1 Test Project mr8gvyd5")[22m
[2m  - attempting fill action[22m
[2m    2 × waiting for element to be visible, enabled and editable[22m
[2m      - element is not visible[22m
[2m    - retrying fill action[22m
[2m    - waiting 20ms[22m
[2m    2 × waiting for element to be visible, enabled and editable[22m
[2m      - element is not visible[22m
[2m    - retrying fill action[22m
[2m      - waiting 100ms[22m
[2m    60 × waiting for element to be visible, enabled and editable[22m
[2m       - element is not visible[22m
[2m     - retrying fill action[22m
[2m       - waiting 500ms[22m

