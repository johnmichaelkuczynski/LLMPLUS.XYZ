# LLM Plus

## Overview
Minimalist web chat app connecting to Anthropic Claude (plus ChatGPT, DeepSeek, Grok, Venice) with document management, persistent per-project Tractatus tree memory with recursive compression, a three-pass coherence engine for large document generation (up to 150k words), and a standalone Tractator tool.

## Architecture
- Plain HTML/CSS/JS frontend (no frameworks); Node.js + Express backend (ESM, locked package.json)
- Raw pg Pool for PostgreSQL (Neon). No ORM.
- LLM APIs: Anthropic (x-api-key), OpenAI/DeepSeek/xAI/Venice (OpenAI-compatible chat/completions)
- Models: Claude (claude-sonnet-4-20250514), ChatGPT (gpt-4o), DeepSeek (deepseek-chat), Grok (grok-3); max_tokens 16384

## File Structure
```
server/index.js   - Express server, all API routes, chat SSE, coherence engine, Tractatus
server/auth.js    - fixed single-owner identity resolver and retired-login route blockers
server/db.js      - pg Pool connection to Neon PostgreSQL
client/index.html - Single page HTML (white theme, bottom input bar)
client/style.css  - All styles (white UI, no dark mode)
client/app.js     - Frontend logic (vanilla JS, drag-drop, SSE, modals)
package.json      - express, pg, dotenv, cors, body-parser, multer, docx, pdfkit, mammoth, pdf-parse
```

## Key Features (one-liner each; see code for detail)
- **Projects & Sessions**: CRUD, auto "Main" project, inline rename, smart auto-titles, move chats between projects.
- **SSE Streaming Chat**: word-by-word streaming; auto-continuation only when an explicit word target or long-form request is detected (see Response Length Control).
- **Tractatus Tree Memory**: per-project JSONB tree injected into every system prompt, updated after each exchange via a background popup.
- **Recursive Memory Compression**: at 200 nodes the tree compresses into higher tiers (Tier1 recent + Tier2/3 summaries); ~15K char prompt budget; archives in `tractatus_archive`; summary projects are hidden (`tractatus_tier > 1`).
- **Memory Hierarchy Viewer** (🧠): view all tiers, color-coded tags, archived snapshots.
- **Report Generator** (📜): prose reports by scope (project / chat / "since N trees ago"); SSE to artifact panel.
- **Three-Pass Coherence Engine**: outline → section writing with continuation → stitch/repair; per-section keyword-matched source material; multi-document source selector; Revise button. Word count optional.
- **Scholarly Research**: optional per-section fetch from Semantic Scholar, OpenAlex, CrossRef, PubMed; deduped and injected with citation instructions.
- **Document Upload**: PDF/DOCX/DOC/TXT/images (images via Google Cloud Vision OCR); click or drag-drop.
- **Voice Input** (🎤, AssemblyAI): record → POST `/api/transcribe` → transcript appended to input.
- **Document Library**: General (global) + Project (scoped) libraries; search, upload, send-to-chat, download, delete, copy-to-general.
- **Artifact Panel**: auto-opens for document-like responses; Copy / Download TXT-DOCX-PDF / Save to Library.
- **Rich Formatting & Tables**: markdown tables render as HTML/DOCX/PDF; `copyRich()` preserves formatting on copy.
- **Response Length Control**: Concise (1024 tok, no continuation) / Normal (4096) / Detailed (8192) / Exhaustive (16384, up to 40 continuations). Adaptive: matches answer length to the question; NO auto-continue on max_tokens unless there's an explicit word target or long-form request (this was the runaway-length bug). **"Words #" box**: exact word count (10–30000) overrides the mode with ±20% margin and caps max_tokens; sent as `targetWords`. Choosing a Length button clears the box; box shows an amber active state + clear (×) button so a lingering value can't silently truncate replies.
- **Summarize Project/Chat**: length options (Auto/Brief/Moderate/Detailed/custom); SSE to artifact panel. `POST /api/summarize`.
- **User Analytics / Profile Me**: incremental profile tree (`user_analytics`) every 5th exchange; "Profile Me" generates a clinical profile (SSE), snapshots to `profile_snapshots`.
- **Reminders**: per-user notes/tasks with complete/delete; pulsing dot when active. `/api/reminders*`.
- **Audit (Fact-Check)**: per-message (or selected-text) claim-by-claim analysis cross-referenced against tree/docs/history; VERIFIED/UNVERIFIABLE/CONTRADICTED. `POST /api/audit` (SSE).
- **Audit Lessons**: contradicted findings are parsed, sanitized, and stored in `projects.audit_lessons` (JSONB, FIFO 20), then injected into later prompts as DATA (anti prompt-injection) so mistakes aren't repeated.
- **Pinned Context (Ground Truth)** (📌): per-project user text injected verbatim at the very top of every prompt; survives compression; overrides contradictory tree nodes. `projects.pinned_context`.
- **Per-Chat Ground Rules** (⚖): optional standing rules set on New Chat; stored in `sessions.ground_rules`; injected near the top AND as the absolute last line (appended after length/target notes in the route handlers so recency wins). Only an explicit per-message override sets them aside. `/api/sessions/:id/ground-rules`.
- **Memory Health (decay meter & rip cord)**: composite 0-100 score (age + compression count/tier + prompt-budget truncation + archive-vs-live ratio) via `GET /api/projects/:id/memory-health` (`/staleness` is an alias). Always-visible 🧠 badge in topbar (green/yellow/orange/red) with click-through factor breakdown; warning/critical shows a rip-cord banner (Pin Facts 📌 / Run Audit 🔍 / View Memory 🧠); in-prompt decay notice scales with severity, telling the model to hedge names/dates/figures instead of confabulating. Replaces the old days-only staleness banner.
- **SEO**: full meta set in `client/index.html` (title, description, canonical → https://llmplus.ink/, Open Graph, Twitter card, JSON-LD WebApplication schema, noscript content), plus `client/robots.txt` and `client/sitemap.xml`. Note: the `.replit.dev` proxy injects `x-robots-tag: noindex` — production (llmplus.ink) does not.
- **Unique visitor counter**: cookie-based (`llmplus_vid`, 2-yr) middleware upserts into `site_visitors`; `GET /api/admin/visitor-stats` supplies the 👁 topbar chip. Historical access-event rows remain stored but their former login dashboard and API are retired. Highlight-to-Remember: selecting text in any chat message shows a floating 📌 Remember button that appends the snippet to pinned context via `POST /api/projects/:id/remember` (max 10/day per project, 500 chars each, deduped, 8000-char Ground Truth cap).
- **Anti-Sycophancy**: universal truthfulness rules in every stance; preserved through tree updates/compression.
- **Compare Stances** (⚖ Compare): dual-column overlay streaming two stances concurrently; does not write transcript. `POST /api/chat/compare`.
- **Stance Toggle**: Agreeable / Neutral / Mildly Critical / Strongly Critical — a CONTENT directive, all bound by truthfulness rules.
- **System Diagnostic** (🧪): live self-check of env vars, DB/tables, LLM API reachability, functional CRUD, cleanup. `POST /api/diagnostic/run`.
- **Context Management (flat per-turn cost)**: hot paths never load the full transcript — `loadRecentTranscript()` trims to last N in SQL. Chat uses last ~12 msgs; cross-session context only for project-specific queries. On-demand features (report/summarize/profile/paper) still load the full transcript.
- **Kill switch**: stop button / Escape aborts fetch; server cancels upstream streams and saves partial transcript ("[Stopped by user]").

## Access: Google login; one personal owner
- **Google-only personal access:** `server/auth.js` creates a fresh database-backed Google session. Only the verified `johnmichaelkuczynski@gmail.com` account can sign in; it is linked to the existing database user and no user/project/document record is created or reassigned during sign-in. All other API routes require that session.
- The login setup fails closed: other Google accounts, unverified emails, missing/duplicate owner rows, and conflicting Google account links are rejected.
- Sessions use a new cookie and database table so sessions from older authentication implementations cannot become valid.
- **Development preview:** requests on the configured Replit development host (and local app preview) resolve directly to that same existing owner row so the original workspace loads without a login wall. This exception is disabled in production.
- CSRF guard (foreign-Origin rejection on non-GET `/api/*`) and the CORS allowlist remain.

## Database Tables
users, projects (user_id FK, tractatus_tier, parent_project_id, pinned_context, audit_lessons), sessions (ground_rules), project_documents, global_documents (user_id FK), document_jobs (user_id FK), document_chunks, tractatus_archive, user_analytics (user_id UNIQUE, profile_tree JSONB), profile_snapshots, reminders, login_events (historical).

## Environment Variables
ANTHROPIC_API_KEY, OPENAI_API_KEY, DEEPSEEK_API_KEY, XAI_API_KEY, VENICE_API_KEY, DATABASE_URL, GOOGLE_CLOUD_VISION_API_KEY, ASSEMBLYAI_API_KEY, PORT (default 5000). Anthropic key prefers Replit AI integration (AI_INTEGRATIONS_ANTHROPIC_API_KEY/_BASE_URL) with fallback to ANTHROPIC_API_KEY.

## Replit Environment / Deployment
- Run: `npm run dev` (dev) / `npm start` (prod) — both run `node server/index.js` on port 5000; no build step. Deployment: autoscale.
- Transcript saves use atomic JSONB append to avoid lost updates.

## Critical Rules
- NO React, Vite, Tailwind, TypeScript, Drizzle, shadcn, Prisma, ORM. Only raw pg + official APIs.
- Coherence engine queries skeleton/deltas from DB every chunk (never from memory); 15-second mandatory pauses between chunks.
- Summary projects (`tractatus_tier > 1`) are hidden from the main project list.
- Keep owner-facing replies extremely short, calm, and plain (no jargon).
