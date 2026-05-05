🧠 LLM Plus
The Scholar's Workbench — Multi-Model Reasoning with Persistent Project Memory

🧩 Overview
LLM Plus is a full-service conversational AI platform that gives a single researcher access to four frontier language models — Anthropic Claude, OpenAI ChatGPT, DeepSeek, and xAI Grok — under a unified interface engineered for serious intellectual work.

It performs end-to-end research dialogue, document-grounded analysis, persistent project memory, cross-project user profiling, fact-checking, and long-form composition — from rapid Q&A to multi-thousand-word coherent essays — all without ever throwing away what you've discussed before.

Designed for academics, lawyers, analysts, writers, and serious researchers, it solves the three pathologies that cripple ordinary chat tools: amnesia between sessions, sycophantic agreement with whatever the user says, and the silent erosion of factual fidelity over long projects.

🧠 What It Does

Multi-Model Consultation — Switch live between Claude (Sonnet 4), GPT-4o, DeepSeek-Chat, and Grok-3 on a per-query basis. The same project context, document library, and Tractatus tree are visible to whichever model you choose, so you can cross-check one model's reasoning against another's.

Persistent Project Memory (Tractatus Trees) — Every project maintains a Wittgenstein-style numbered knowledge graph (1.0, 1.1, 1.1.1, 2.0…) tagged with ASSERTS / REJECTS / ASSUMES / OPEN / RESOLVED / DOCUMENT / QUESTION. After every exchange, Claude updates the tree with what was discussed, what was claimed, what was disputed, and what remains open. The tree survives across sessions, restarts, and weeks of work — giving the model long-horizon recall across thousands of exchanges in the same project.

Recursive Compression with Tier Promotion — When a project's tree exceeds 200 nodes, it is automatically compressed into a higher-tier summary tree (50–80 nodes) that preserves all critical facts, evidence, and unresolved questions. Compression is iterative: a project can have multiple tiers of summary, with the model still able to draw on the densest archived layer when reasoning about old material.

Stance Toggle (Anti-Sycophancy Engine) — A four-position dial governs the analytical posture of every response: **Agreeable** (steel-man the user's view), **Neutral** (weigh both sides), **Mildly Critical** (probe weaknesses), **Strongly Critical** (steel-man the contrary). Stance is a content directive, not a tonal one; the manner of delivery stays measured in every mode. All four stances are bound by hard truthfulness rules — none may invent supporting or counter-evidence, and Agreeable mode must still correct factual errors plainly. This is the antidote to the "brilliant! do it!" failure mode of ordinary chat.

Audit (Fact-Check) — Every assistant message has an "Audit" button. Click it to fact-check the entire response, or highlight specific text first to audit just that passage. The audit cross-references each claim against the project's full Tractatus tree (all tiers), uploaded source documents, and recent chat history, returning a claim-by-claim verdict (VERIFIED / UNVERIFIABLE / CONTRADICTED) with evidence citations. Dates, numbers, and proper names are checked with extra strictness.

Staleness Detection — Projects track when their tree was last updated and how many times it has been compressed. When memory begins to age (3+ days unrefreshed, 2+ compressions), a dismissible banner appears with a severity gradient (mild / warning / critical), and the system prompt is silently injected with anti-hallucination rules that force the model to qualify uncertain claims and recommend auditing. Click the banner to trigger an immediate audit of the most recent response.

Cross-Project User Analytics ("Profile Me") — A dedicated Tractatus-style profile tree builds incrementally every fifth chat exchange by analyzing all project trees plus the latest conversation. Categories include Topics, Conversational Style, Writing Patterns, Cognitive Patterns, Emotional Patterns, and Evolution. The "Profile Me" sidebar button generates a full clinical profile (800–1500 words) comparing the present moment against previous snapshots stored in the database — a longitudinal record of how the user's thinking has changed over time.

Document Library (General + Per-Project) — Upload PDFs, DOCX, plaintext, and images (with OCR via Google Cloud Vision). Documents live in either a global library (shared across all your projects) or a project library (scoped to one project). Selecting documents from a library attaches them as pending content in the input box — you type your query first, then send the documents and your question together as a single message.

Reminders — A per-user reminder system lives behind a sidebar button that pulses a yellow dot whenever active reminders exist. Reminders are optionally project-scoped, can be marked complete, edited, or deleted, and persist across sessions.

Long-Form Coherent Generation — A "Write a Paper" button drives a structured multi-pass writing engine that produces essays and analyses far beyond a single chat turn, with response-length controls (Concise / Normal / Detailed / Exhaustive) governing both the system prompt and the per-call token budget.

⚙️ Technical Features

Direct Model APIs — No middleware, no proxies, no abstraction frameworks. Server makes direct fetch calls to Anthropic Messages API, OpenAI Chat Completions, DeepSeek Chat Completions, and xAI Chat Completions. Every call gets 3× retry-with-exponential-backoff on 429 and 5xx responses. Per-call max-token ceiling: 16,384.

Streaming Architecture — Token-by-token Server-Sent Events streaming for every chat, audit, and profile-generation endpoint. The client renders text as it arrives.

PostgreSQL Persistence (Neon) — All state lives in raw `pg`-driven SQL: users, sessions, projects, messages, global documents, project documents, Tractatus trees, profile snapshots, reminders, audit logs. No ORM, no Drizzle, no migrations framework — schema is created idempotently at boot via `CREATE TABLE IF NOT EXISTS` statements.

Session Persistence — Express sessions are stored in PostgreSQL via `connect-pg-simple` (table `user_sessions`, auto-created), so logged-in users survive server restarts and deployments without re-authentication.

Multi-User Authentication & Per-User Isolation — Username/password auth with bcryptjs hashing, 30-day session cookies, and database-level ownership verification on every read and write. No user can see another user's projects, documents, sessions, reminders, or analytics. A bypass exists for the username `jmk` per design specification.

Anti-Sycophancy Prompt Engineering — The system prompt enforces universal rules that apply across every stance: never lie or fabricate, never reframe defeats as victories without explicit factual grounding, court rulings must distinguish what was held / what was NOT held / forward implications, and negative findings must be preserved with full fidelity. The Tractatus tree update prompt and compression prompt include matching rules so that bad news cannot be laundered into optimistic framing during memory updates or compression cycles.

Context Management — Chat messages are truncated to 8K characters each; the last 16 messages are sent per request; total context capped at 100K characters; cross-session context capped at 10K characters (six messages per session, 400 characters each). System prompt size is logged to console for monitoring.

OCR Pipeline — Image documents (PNG, JPG, TIFF, WebP, etc.) are routed through the Google Cloud Vision API for text extraction before ingestion into the document library.

Plain-Stack Architecture — Vanilla HTML, CSS, and JavaScript on the front end; Node.js / Express (ESM modules) on the back end; raw `pg` for database access; no React, no Vite, no Tailwind, no TypeScript, no Drizzle, no shadcn. The result is an application with zero build step, near-instant deploys, and a stack a single person can audit end-to-end.

🎓 Designed For

Academics & Researchers: Persistent project memory across months of work; cross-model verification; rigorous fact-checking against your own document corpus.

Lawyers & Legal Analysts: Anti-sycophancy guardrails specifically engineered for adversarial analysis — stance toggle lets you steel-man your case in one breath and steel-man opposing counsel's case in the next, both within strict truthfulness rules. Court ruling analysis is hard-coded to separate what was held from what was not held from forward implications.

Writers & Long-Form Authors: Multi-pass paper generation; persistent character, plot, and argument trees per project; "Profile Me" longitudinal tracking of how your thinking evolves.

Strategists & Decision-Makers: Audit any answer claim-by-claim against your own evidence; staleness banners warn you when project memory has degraded; reminders keep open threads visible.

💡 Core Idea
LLM Plus treats AI consultation as a long-running, evidence-grounded, adversarially-tested intellectual partnership.

It does not forget between sessions. It does not agree with you by default. It does not let bad news quietly disappear during memory compression. And it lets you swap models mid-conversation to see whether the conclusion holds under four different reasoning styles.

LLM Plus — chat with any frontier model, but with a memory and a backbone.
