---
name: Brief but complete answers
description: Keep Normal mode short without accepting a provider's cut-off sentence as a finished answer.
---

Control Normal length with aligned numeric prompt guidance, an end-of-prompt reminder, and a bounded output budget. Do not restore unrestricted continuations to solve truncation.

**Why:** Prompt-only instructions previously produced excessively long answers under heavy project context. Conversely, accepting a hard budget as a finished response stranded sentences. A recorded production response also ended with “would be” despite the provider reporting end_turn, so that signal alone is insufficient.

**How to apply:** Keep the existing concise style instructions. Allow one short completion-only attempt for a token-cap stop, a stream without a terminal event, or clearly dangling prose. Finish the current thought, not additional sections. Preserve explicit exact-output requests and intentional structured output.

Never report unfinished output as a successful complete answer.

**Why:** The previous implementation defaulted streams to end_turn and refused to finish ordinary token-limited responses. This made both genuine interruptions and falsely finished sentences look successful.

**How to apply:** Default unclosed streams to interrupted, parse the final streaming frame even without a newline, preserve partial text, and persist a visible incomplete status if the bounded completion cannot finish. Do not discard original source context to make a continuation fit.
