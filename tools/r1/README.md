# R1 — Synthetic User Agent for LLMPlus

R1 is a Playwright-driven synthetic user that beta-tests the LLMPlus app end-to-end
and produces raw, reviewable evidence of every interaction. It does NOT produce
pass/fail summaries — every screenshot, every request body, every model response is
captured verbatim so a human can review the run in under 30 minutes.

## Quick start

```bash
cd tools/r1
npm install
npm run install-browsers      # one-time: downloads Chromium (~300 MB)
ANTHROPIC_API_KEY=sk-...  npm start
```

Open the live view at <http://localhost:7777> while it runs.
When it finishes, open the report:

```bash
open runs/<timestamp>/report.html
```

## Environment

| Variable                              | Default                                  | Notes |
|---------------------------------------|------------------------------------------|------|
| `ANTHROPIC_API_KEY`                   | (required)                               | Used by R1's brain and the judge |
| `APP_URL`                             | `http://localhost:5000`                  | Where LLMPlus is running |
| `HEADLESS`                            | `false`                                  | Run Chromium headless |
| `TYPE_DELAY_MS`                       | `15`                                     | Per-keystroke delay (live-view visibility) |
| `LIVE_VIEW_PORT`                      | `7777`                                   | Live dashboard port |
| `SKIP_FUNCTIONS`                      | `''`                                     | Comma list, e.g. `7,8` skips compression + long doc |
| `COMPRESSION_TEST_MAX_ITERATIONS`     | `60`                                     | Cap on f7 chat loops |
| `LONG_DOC_TARGET_WORDS`               | `2000`                                   | Word target for f8 |
| `R1_MODEL`                            | `claude-sonnet-4-20250514`               | Brain + judge model |
| `R1_USERNAME`                         | `JMK`                                    | Login as (JMK accepts any password) |
| `R1_PASSWORD`                         | `r1test`                                 | Password to send |

## Output

```
runs/<ISO-timestamp>/
  transcript.jsonl     — one JSON per interaction (verbatim everything)
  report.html          — single self-contained reviewable report
  failures.md          — critical invariants + judge concerns, sanity failures
  network.log          — JSONL of every /api/* request + response body
  console.log          — full stdout
  screenshots/         — numbered PNGs (3 per interactive step)
  tree-snapshots/      — Tractatus tree JSON before/after each chat exchange
  diagnostic.json      — full /api/diagnostic/run response (if f14 ran)
  run-summary.txt      — top-line counts (interactions, concerns, violations)
```

## Adaptations from the original spec

The original spec assumed a multi-page app with `/projects`, `/projects/:id`,
"Memory tab" etc. The real LLMPlus is a single-page UI with sidebar buttons.
R1 was built against the **actual** code, not the spec. Key adaptations:

- Auth: real, not auto-login. R1 logs in as JMK (any password works).
- No `/projects/:id` route — sidebar button selects project; in-page memory/diagnostic
  modals open via topbar buttons.
- Chat endpoint is `POST /api/chat` with `{projectId, sessionId, message, ...}`,
  not `POST /api/project-sessions/:sid/chat`.
- Tree updates are fire-and-forget: chat SSE emits `tractatus_trigger`, then the
  client posts `/api/tractatus/update`. R1 mirrors that flow when calling APIs directly.
- Long-doc endpoint is `POST /api/coherence`, event types
  `status / progress / section_start / section_token / section_end / complete`.
- Voice endpoint is `POST /api/transcribe` (multipart upload), not a token+WS flow —
  Function 13 is therefore a limited check: confirm the mic UI is wired and the
  endpoint is reachable; it cannot actually speak.

## Exit codes

| Code | Meaning |
|------|---------|
| 0    | Clean run |
| 1    | Judge concerns raised (look at `failures.md`) |
| 2    | Critical invariant violations |
| 3    | Harness sanity check failed |
