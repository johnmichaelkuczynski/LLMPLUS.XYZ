# R1 Failures — 2026-08-17T23-44-59-760Z

## CRITICAL INVARIANT VIOLATIONS (0)

_None._


## Judge concerns (0)

_None._


## Harness sanity failures (1)

- **harness** — Uncaught exception: page.waitForSelector: Timeout 15000ms exceeded.
Call log:
[2m  - waiting for locator('#chat-input') to be visible[22m
[2m    - locator resolved to hidden <textarea rows="1" id="chat-input" class="chat-textarea" data-testid="chat-input" placeholder="Message Claude..."></textarea>[22m
[2m    - waiting for" http://localhost:5000/api/auth/dev-login" navigation to finish...[22m
[2m    - navigated to "http://localhost:5000/"[22m
[2m    32 × locator resolved to hidden <textarea rows="1" id="chat-input" class="chat-textarea" data-testid="chat-input" placeholder="Message Claude..."></textarea>[22m

