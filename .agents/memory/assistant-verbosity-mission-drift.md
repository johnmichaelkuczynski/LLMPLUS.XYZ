---
name: Assistant verbosity & mission drift
description: Why the in-app assistant lectured/analyzed unprompted, and the system-prompt rule that stops it.
---

# The assistant must obey "read and take note" — not lecture

The owner's core workflow (e.g. building a legal document with surgical exhibit citations) is a multi-step process where he often just wants the assistant to INGEST material ("read this and take note, don't analyze yet") and wait. The assistant kept responding with huge unsolicited exhibit-by-exhibit analyses that "drowned the thread" and drifted off the stated mission.

**Root cause:** the base identity ("rigorous analytical assistant… provide expert-level, intellectually rigorous responses") plus the always-on STANCE block ("build a case") primed the model to analyze everything, and nothing in the prompt honored procedural/intake instructions about *how* to respond.

**Fix (in `buildSystemPrompt`, applies to both `/api/chat` and `/api/chat/compare`):** a "FOLLOW THE USER'S INSTRUCTION — HIGHEST PRIORITY" block declared to override stance/length/format. Core principle the owner insisted on: **flexibility — whatever the user instructs, do exactly that, nothing more and nothing less.** One word if asked for one word, 10,000 if asked for 10,000, deep analysis if asked to analyze, a brief confirmation if only told to read/take note. It must NOT substitute its own defaults, and must NOT withhold/water down work that was requested. Intake verbs (read/note/hold/acknowledge/wait/"do not analyze yet") → 1-2 sentence confirmation and STOP. Only ask a clarifying question if the instruction is genuinely self-contradictory.

**Why it's balanced (don't regress this in EITHER direction):** the owner escalated ("IT HAS TO BE FLEXIBLE… PERIOD") after an earlier version leaned too hard toward "stay brief," which was its own rigidity. The rule must cut both ways — never lecture unprompted, never skimp when asked. Verified: "read and take note" → 4 words; "reply with exactly one word: ACKNOWLEDGED" → 1 word; "thorough analysis of X" → full ~280-word analysis. If you ever strengthen the analytical/rigor framing again, keep this override ABOVE it, and do NOT tilt it back toward blanket brevity.

**Related:** the runaway-length continuation fix (adaptive length, no auto-continue without an explicit word target) is the other half of keeping answers proportionate. This block governs *whether to analyze at all*; that governs *how long*.

# Per-chat ground rules must win over per-message length asks

Users can set standing "ground rules" per chat (stored on the session) that constrain every reply (e.g. "no answer longer than one paragraph"). Two things were required to make the model obey them:
1. A high-priority block near the TOP of the system prompt declaring ground rules outrank stance/length/format and the verbosity any single message implies, with an explicit escape hatch (only a per-message "set rule X aside this time" overrides).
2. An ABSOLUTE-FINAL restatement appended as the literal last line of the system prompt — and crucially appended in the *route handler*, after the length-mode / exact-word-count / concise notes are added, NOT inside the prompt-builder. **Why:** those length notes are appended after buildSystemPrompt returns and one even says it "overrides every other length instruction"; recency decides conflicts, so the ground-rule reminder must be appended dead-last in the caller or a length directive wins.
**How to apply:** any constraint that must beat later-appended verbosity/length directives has to be re-stated after them, in the same code path that appends them.
