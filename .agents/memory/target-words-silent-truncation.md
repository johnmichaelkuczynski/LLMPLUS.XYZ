---
name: Target-words box silently truncated every chat reply
description: A persistent composer control that overrides output length can silently break every response; make its active state visible and clearable.
---

# "Words #" target box silently capped every reply → "freezes mid-sentence"

Symptom reported: chat "keeps freezing mid-sentence" in a long, document-heavy chat. Production logs were the tell — EVERY `/api/chat` line showed `requestedWords=10 maxTokens=256`, then "upper bound reached". A stray `10` left in the composer's target-words number input was sent as `targetWords` on every message, capping `max_tokens` at 256 (~120 words) and stopping at 1.2× target — truncating every answer mid-sentence.

**Why it was invisible:** the control persists across messages (SPA, no reset), silently OVERRIDES the Length buttons, and had no obvious active-state cue, so the user never connected the tiny box to the truncation.

**How to apply:** any persistent composer control that overrides response length must (1) show a clear active state, (2) offer one-click clear, and (3) be reset by the more-obvious sibling control (here: clicking a Length button clears the word target). Base the visible/clearable state on raw non-empty input text, but keep the *sent* payload gated on the valid range — otherwise an out-of-range value hides the clear affordance while still looking set.

**Second incident (implicit phrase detection, Jul 2026):** the opposite direction — a bare "(\d+) words" regex scanned the user's typed message for an implied word target. User pasted legal text containing a court word limit ("shall not exceed 3,500 words"); it silently became requestedWords, overrode Normal's token cap, AND armed the auto-continuation loop → multi-thousand-word document from a plain question. Rule: implicit/phrase-detected length targets must NEVER apply in short modes (normal/concise) — only the explicit Words box may set a target there; phrase detection is allowed only in detailed/exhaustive where long output is expected. Pasted content is data, not a request.
