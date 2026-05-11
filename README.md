# 🧠 LLM PLUS

**Multi-Model Scholarly Chat with Persistent Per-Project Memory and Recursive Compression**

---

## 🧩 Overview

LLM Plus is a multi-model AI chat platform built for serious, long-running intellectual work — legal cases, dissertations, research programs, philosophical investigations, multi-month projects where the conversation outlives any single context window. It plugs into four top-tier LLMs (Claude, ChatGPT, DeepSeek, Grok) and lets the user route any turn to the model best suited for it.

Unlike consumer chatbots that forget everything between sessions and flatter the user with hedged, watered-down output, LLM Plus is built around two strict operating principles: **memory must persist** and **truth must survive compression.** Every project maintains its own Tractatus tree — a numbered, tagged, machine-managed record of what has been asserted, rejected, assumed, resolved, and left open — that is injected into every system prompt and recursively compressed when it grows beyond the context window. Defeats stay defeats. Numbers stay numbers. Dates stay dates.

---

## 👥 Who It's For

- **Lawyers and litigators** — need to maintain perfect recall across years of case material, motions, rulings, and discovery without the model softening adverse outcomes
- **Academics, graduate students, and researchers** — need to write dissertations and journal articles where claims must remain consistent across hundreds of pages
- **Philosophers and theorists** — need a system that tracks distinctions, open questions, and dialectical commitments across months of investigation
- **Analysts and consultants** — need persistent project memory across dozens of documents and hundreds of conversations
- **Anyone** — who has ever had a long conversation with an AI, asked it three weeks later what was decided, and gotten a confident hallucination

---

## ⚙️ Core Capabilities

- **Tractatus Tree Memory** — Every project maintains a persistent JSONB tree of numbered, tagged claims (`ASSERTS`, `REJECTS`, `ASSUMES`, `OPEN`, `RESOLVED`, `DOCUMENT`, `QUESTION`). The tree is injected into every system prompt, giving the model effective recall across the entire history of a project — not just the visible conversation window.

- **Recursive Memory Compression** — When a project's tree reaches 200 nodes, it is automatically compressed into a higher-tier summary (Tier 2), preserving the most recent 30 nodes at full resolution in Tier 1. Tier 2 itself can be compressed into Tier 3, recursively. All tiers are loaded into the system prompt with per-tier character budgets (8K / 4K / 2K). Pre-compression snapshots are archived for audit.

- **Anti-Sycophancy Across the Memory Pipeline** — The same anti-flattery rules appear in three places: the chat system prompt, the tractatus update prompt, and the compression prompt. Defeats cannot be reframed as "strategic opportunities" during memory writes or compressions. Numbers, dates, names, and case numbers are preserved verbatim.

- **Stance Toggle** — Four-position content directive: Agreeable steel-mans the user's position, Strongly Critical steel-mans the contrary, Mildly Critical probes for weaknesses, Neutral weighs both sides. All four stances are equally bound by the truthfulness rules — Agreeable mode still corrects factual errors plainly.

- **Three-Pass Coherence Engine** — Long-form generation engine producing documents up to 150,000 words. Outline → section-by-section streaming with auto-continuation → global stitch-and-repair. Source material is keyword-matched per section; section sizes scale with target length; mandatory pauses between chunks for rate-limit safety.

- **Scholarly Research Integration** — Optional checkbox in the paper writer hits Semantic Scholar, OpenAlex, CrossRef, and PubMed in parallel for each section, dedupes by title, formats with author/year/abstract/DOI, and injects the results into the section prompt with citation requirements.

- **Audit (Fact-Check)** — Every assistant message has an Audit button. Streams a claim-by-claim analysis cross-referenced against the project's full tiered memory, source documents, and recent chat history. Each claim marked `VERIFIED`, `UNVERIFIABLE`, or `CONTRADICTED` with evidence citations. Dates, numbers, and names checked with extra strictness.

- **Staleness Detection** — Projects track `last_tree_update` and `compression_count`. When a tree hasn't been updated in 3+ days or has been compressed 2+ times, a warning banner appears and anti-hallucination rules are injected into the system prompt forcing the model to qualify uncertain claims.

- **Document Library** — Two tiers: per-project library scoped to each project, and a cross-project general library. PDF, DOCX, DOC, TXT, and image upload (PNG/JPG/GIF/BMP/TIFF/WebP via Google Cloud Vision OCR). Drag-and-drop. Multi-document selector in the paper writer.

- **Reports & Summaries** — Generate prose reports scoped to the entire project, a single chat, or "since N trees ago" using archive snapshots as temporal checkpoints. Auto-scaled length based on source size.

- **User Analytics / Profile Me** — Cross-project user profiling. A second tractatus-style tree built incrementally every fifth exchange tracks topics, conversational style, writing patterns, cognitive patterns, emotional patterns, and evolution. Generates a longitudinal clinical profile with a "Changes Since Last Profile" diff.

- **Reminders, Stance, Length, Format Controls** — Sidebar reminders with active-count indicator. Four-mode response length (Concise / Normal / Detailed / Exhaustive). Two-mode response format (Prose / Bullets). Smart auto-continuation when the user requests a specific word count ("write 10000 words" → up to 40 chained calls).

- **System Diagnostic** — Five-phase self-check: environment variables, database tables, LLM API reachability (1-token ping to all four), functional CRUD round-trip with cleanup. Streams pass/fail per step. Distinguishes upstream rate-limits from real failures.

- **Multi-User Authentication** — Username/password with bcryptjs, 30-day session cookies via connect-pg-simple, complete data isolation between users via `user_id` filters and ownership-verifier helpers in every route.

---

## 🚀 What Makes It Different

- **It actually remembers.** The tractatus tree gives the model effective recall across thousands of exchanges, far beyond any native context window. Ask about a detail from three months ago and the answer comes from project memory, not a hallucination.

- **Bad news stays bad news.** Most AI memory systems quietly soften adverse facts during summarization. LLM Plus enforces anti-sycophancy rules at the system-prompt layer, the tree-update layer, AND the compression layer. A motion denied is recorded as "Motion denied" — not "Denial creates strategic opportunity."

- **Compression is recursive and lossless of structure.** When Tier 1 fills up, it compresses to Tier 2 — not into a paragraph, but into a smaller numbered tree with the same tag vocabulary. When Tier 2 fills up, it compresses to Tier 3. The structure survives every compression cycle, so the model can reason against memory the same way at any depth.

- **Four LLMs, one project.** Switch between Claude, ChatGPT, DeepSeek, and Grok mid-conversation. The memory is model-agnostic — every model sees the same tractatus tree and the same conversation history. Use Claude for analysis, DeepSeek for cheap bulk work, Grok for a contrarian second opinion, all in the same project.

- **Stance is a content directive, not a vibe.** Most "be more critical" toggles just change tone. The stance toggle here changes which case the model builds — Agreeable steel-mans you, Strongly Critical steel-mans your opponent. Tone stays professional in all four; what changes is the argument under construction.

- **The audit trail is real.** Every pre-compression snapshot is archived. Every claim can be re-checked against the full tiered memory and source documents. Staleness is tracked and surfaced. The diagnostic verifies the whole stack end-to-end.

- **No frameworks, no surprises.** Plain HTML/CSS/JS frontend. Express + raw `pg` backend. No React, no Vite, no Tailwind, no TypeScript, no ORM. The whole backend is one file you can read top to bottom.

---

## 💡 Stack

Plain HTML/CSS/JS · Node.js + Express (ESM) · raw `pg` · Neon Postgres · Anthropic / OpenAI / DeepSeek / xAI APIs · Google Cloud Vision OCR
