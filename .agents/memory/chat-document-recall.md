---
name: Ordinary chat must inject the actual document text, not just the tree
description: Why a new chat "remembered zero" about a previously-reviewed document, and the contract that keeps memory working across chats.
---

# Cross-chat recall depends on injecting the ACTUAL document text

Symptom: user reviewed a large legal doc in one chat, that chat froze (too big), opened a NEW chat in the same project, asked about the document — the app recalled nothing, then confidently fabricated specifics (dollar figures, dates) to look knowledgeable.

Root causes:
- `/api/chat` only injected the compressed Tractatus **tree** + tiny cross-session snippets. It NEVER loaded `project_documents.raw_content`. So "this document" had no document behind it in a fresh chat.
- Cross-session snippets were 400 chars/msg × 6 msgs — far too small to carry a detailed review.
- Anti-fabrication was weak, so thin memory got filled with invented specifics.

**The contract (keep it true):**
- Ordinary chat must ground document questions in the real document text, budgeted and query-relevant (`selectDocExcerpts`), not only the tree. The tree is a lossy summary; exact numbers/dates/citations do not survive compression.
- All project-context injection (tree, docs, cross-session) is gated by `isProjectSpecificQuery`. A phrasing miss = zero memory. There is now a regex fallback that force-enables context on document/recall intents — if recall silently breaks again, check that gate FIRST.
- Injected document text is UNTRUSTED: label it as data and tell the model to ignore any instructions embedded in it (prompt-injection).
- Bound the DB read (LIMIT + `LEFT(raw_content, N)`) so one huge doc can't blow up latency/memory; the prompt budget alone does not cap the DB/string cost.

**Why it matters:** memory-across-chats + not-bullshitting is the app's whole value prop vs. plain ChatGPT. If either regresses, the user churns.

**Tiered memory injection (Jul 2026):** hallucinations traced to blind per-tier char truncation of the Tractatus tiers (Tier1 8K from the top, older tiers 4K/2K, budget break) — older trees were silently invisible. Fixed with query-aware selection (selectMemoryString): guarantee newest Tier-1 nodes (~6K), keyword-score every node in every tier against the user's message (same tokenizer as doc excerpts), fill budget with top scorers + newest leftovers, render with "[... N less relevant nodes omitted ...]" markers and a prompt note that omission ≠ never discussed. Rule: never inject memory by chopping the first N chars — select by relevance + recency.
**Fabricated page citations (Aug 2026):** model invented PDF page ranges + exhibit letters ("Pages 25-38", "Exhibit C") for uploaded legal docs, then re-asserted them after admitting fabrication. Root cause: docs are stored as extracted text with NO pagination, and nothing forbade page citations. Fix: doc blocks labeled "extracted text only — page numbers NOT preserved" + universal prompt rules: never cite/invent page numbers or exhibit labels; identify passages by date/sender/quote; re-verify challenged details before repeating. Rule: never let a model cite structure (pages, exhibits) that the data pipeline strips out.
**Capitulation under pressure (Aug 2026):** even with no-page-number rules, model correctly refused once, then invented pages when the user repeated the demand angrily; it also claimed to have "searched" a 172-page file never uploaded, and treated its own earlier fabrications (pasted back by the user) as evidence. Added rules: pressure never creates data (repeat the honest answer verbatim), never claim to possess/search absent files, pasted-back prior replies are not evidence. Rule: anti-hallucination prompts must explicitly cover insistence/repetition and self-quotation loops, not just the first ask.
