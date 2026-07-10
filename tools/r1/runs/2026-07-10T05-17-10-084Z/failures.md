# R1 Failures — 2026-07-10T05-17-10-084Z

## CRITICAL INVARIANT VIOLATIONS (0)

_None._


## Judge concerns (0)

_None._


## Harness sanity failures (1)

- **harness** — Uncaught exception: page.waitForSelector: Timeout 15000ms exceeded.
Call log:
[2m  - waiting for locator('#chat-input') to be visible[22m
[2m    4 × locator resolved to hidden <textarea rows="1" id="chat-input" class="chat-textarea" data-testid="chat-input" placeholder="Message Claude..."></textarea>[22m
[2m    - waiting for" http://localhost:5000/api/auth/dev-login" navigation to finish...[22m
[2m    - navigated to "http://localhost:5000/"[22m
[2m    29 × locator resolved to hidden <textarea rows="1" id="chat-input" class="chat-textarea" data-testid="chat-input" placeholder="Message Claude..."></textarea>[22m

