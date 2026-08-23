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
- Project-dependent questions search the full document library before any result limit; never fall back to a newest-N slice for termless/referential questions.
- Clearly general questions stay isolated from project documents, memory, and cross-session context.
- Injected document text is UNTRUSTED: label it as data and tell the model to ignore embedded instructions.
- A project-dependent draft remains hidden and unsaved until a claim/source verifier and an independent coverage/entailment reviewer both pass. Exact cited quotations must also exist mechanically in retrieved evidence.
- Missing, contradicted, incomplete, or unverifiable support becomes a persisted high-severity alarm. The rejected draft never enters the transcript or memory update.
- Persist verified/failed status with transcript entries so reloads preserve the badge/alarm rather than presenting checked content as ordinary text.

**Why it matters:** memory-across-chats + not-bullshitting is the app's whole value prop vs. plain ChatGPT. If either regresses, the user churns.

**Tiered memory injection (Jul 2026):** hallucinations traced to blind per-tier char truncation of the Tractatus tiers (Tier1 8K from the top, older tiers 4K/2K, budget break) — older trees were silently invisible. Fixed with query-aware selection (selectMemoryString): guarantee newest Tier-1 nodes (~6K), keyword-score every node in every tier against the user's message (same tokenizer as doc excerpts), fill budget with top scorers + newest leftovers, render with "[... N less relevant nodes omitted ...]" markers and a prompt note that omission ≠ never discussed. Rule: never inject memory by chopping the first N chars — select by relevance + recency.
**Fabricated page citations (Aug 2026):** model invented PDF page ranges + exhibit letters ("Pages 25-38", "Exhibit C") for uploaded legal docs, then re-asserted them after admitting fabrication. Root cause: docs are stored as extracted text with NO pagination, and nothing forbade page citations. Fix: doc blocks labeled "extracted text only — page numbers NOT preserved" + universal prompt rules: never cite/invent page numbers or exhibit labels; identify passages by date/sender/quote; re-verify challenged details before repeating. Rule: never let a model cite structure (pages, exhibits) that the data pipeline strips out.
**Capitulation under pressure (Aug 2026):** even with no-page-number rules, model correctly refused once, then invented pages when the user repeated the demand angrily; it also claimed to have "searched" a 172-page file never uploaded, and treated its own earlier fabrications (pasted back by the user) as evidence. Added rules: pressure never creates data (repeat the honest answer verbatim), never claim to possess/search absent files, pasted-back prior replies are not evidence. Rule: anti-hallucination prompts must explicitly cover insistence/repetition and self-quotation loops, not just the first ask.
**Fabricated quotes + fake search (Aug 2026):** given a 236k-word archive (model sees only ~40K chars), the model said "stand by, searching..." then INVENTED verbatim quotes with dates attributed to the user's own emails. Fixes: per-doc coverage disclosure in the prompt ("PARTIAL: only ~N% of X chars shown"), rules that quotations must be copy-paste from visible text, never claim exhaustive search, and no deferred work (every reply is final; the app has no background search). Coverage % must be computed from unique source chars (exclude markers, dedupe head/window overlap) and capped <100.

**Why two verification passes:** a single verifier can cite real but non-entailing text, omit a material claim, or emit an inconsistent confidence scale. Streaming first also makes any later audit too late. Treat source IDs/quotes, complete claim coverage, and entailment as separate failure gates.
