---
name: Direct model output and reliable delivery
description: User-directed removal of application restrictions and automatic rewriting; preserve reliable browser delivery.
---

Do not add blanket app-written source-only restrictions, rigid response templates, forced short-answer caps, or unrequested model-generated endings to ordinary chat.

**Why:** Dr. Kuczynski explicitly directed removal of app-added filters and interference on 2026-10-26. The request supersedes the earlier numeric Normal cap and automatic sentence-completion approach.

**How to apply:** Supply user-selected controls, user-written chat rules, original history, documents and memory as context. Preserve the selected provider's answer without truncating, rewriting, or generating an unrequested ending. Keep provider policies, ownership/access checks, cancellation and technical context budgets intact.

Never report unfinished output as a successful complete answer.

**Why:** The previous implementation defaulted streams to end_turn and refused to finish ordinary token-limited responses. This made both genuine interruptions and falsely finished sentences look successful.

**How to apply:** Default unclosed streams to interrupted, parse final frames without a newline, preserve partial text, and surface the actual provider/transport completion status without altering the answer.

Browser rendering and protocol completion must not depend on animation callbacks.

**Why:** A completed answer could remain partially displayed and the composer could remain busy when requestAnimationFrame was suspended in a background/preview tab. Backend-only checks did not reproduce this. Separately, an eight-word final question ending in “where” escaped a detector that required a long final line.

**How to apply:** Display received text directly, finalize on the terminal protocol event even if the connection remains open, process trailing frames at EOF, and reconcile with the persisted answer snapshot. Regression checks must freeze animation callbacks and hold the connection open, not just simulate ordinary EOF. Include short dangling final lines, while preserving exact-output and structured-output requests.

Never clone successful streaming responses just to inspect their HTTP status.

**Why:** An unused cloned body leaves another branch of the stream alive. Canceling the displayed branch alone then does not cancel the underlying source; this was reproduced with a held-open browser stream.

**How to apply:** Inspect the original response status. Read a gating-error body only when the response actually represents that error, and do not create an unread clone on the success path.
