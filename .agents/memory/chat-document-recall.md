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
