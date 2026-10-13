---
name: Chat context-build latency
description: Balance intact current-chat history with bounded project-source retrieval.
---

Supply original current-chat messages intact when the selected model's context budget permits. Fixed short-history windows and lossy generated trees are not substitutes for source evidence.

**Why:** The user explicitly requested a genuinely large-context app after basic identities and corrections disappeared from long conversations. Earlier tail-only latency optimization contradicted that purpose.

**How to apply:** Token-budget the current conversation. Keep broader project retrieval indexed, bounded and incremental; do not transfer every other session or complete document on every turn. A source index must react to document edits without repeatedly hashing every stored document.

Do not disable all memory just because a keyword classifier judges a question general.

**Why:** Pronouns, short follow-ups and corrections can be project-specific without obvious keywords. Losing their identity context caused confident answers about the wrong parties.

**How to apply:** Preserve access to sourced identities and relevant original statements on every ordinary chat turn. Treat latency and source fidelity as separate requirements, not reasons to silently discard corrections.
