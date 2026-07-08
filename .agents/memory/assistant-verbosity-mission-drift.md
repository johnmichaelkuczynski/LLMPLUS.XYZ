---
name: Assistant verbosity & mission drift
description: Why the in-app assistant lectured/analyzed unprompted, and the system-prompt rule that stops it.
---

# The assistant must obey "read and take note" — not lecture

The owner's core workflow (e.g. building a legal document with surgical exhibit citations) is a multi-step process where he often just wants the assistant to INGEST material ("read this and take note, don't analyze yet") and wait. The assistant kept responding with huge unsolicited exhibit-by-exhibit analyses that "drowned the thread" and drifted off the stated mission.

**Root cause:** the base identity ("rigorous analytical assistant… provide expert-level, intellectually rigorous responses") plus the always-on STANCE block ("build a case") primed the model to analyze everything, and nothing in the prompt honored procedural/intake instructions about *how* to respond.

**Fix (in `buildSystemPrompt`, applies to both `/api/chat` and `/api/chat/compare`):** a "RESPONDING TO INSTRUCTIONS — HIGHEST PRIORITY" block declared to override stance/length/format. It tells the model to do exactly what was asked and nothing more; obey intake verbs (read/note/hold/acknowledge/wait/"do not analyze yet") with a 1-2 sentence confirmation and STOP; not restate/summarize documents unprompted; stay on the user's stated mission; and ask a one-line clarification instead of dumping analysis when unsure.

**Why it's balanced (don't regress this):** it is scoped to the *how-to-respond* decision, so explicit analysis requests still get full analysis. Verified: "read this and take note" → "Confirmed. Read and retained." (4 words); "analyze whether page 29 proves X" → full ~163-word analysis. If you ever strengthen the analytical/rigor framing again, keep this override ABOVE it or the lecturing returns.

**Related:** the runaway-length continuation fix (adaptive length, no auto-continue without an explicit word target) is the other half of keeping answers proportionate. This block governs *whether to analyze at all*; that governs *how long*.
