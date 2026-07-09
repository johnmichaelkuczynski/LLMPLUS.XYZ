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
server/auth.js    - Google OAuth (canonical, DO NOT rewrite); server/storage.js - pg storage shim
server/db.js      - pg Pool connection to Neon PostgreSQL
client/index.html - Single page HTML (white theme, bottom input bar)
client/style.css  - All styles (white UI, no dark mode)
client/app.js     - Frontend logic (vanilla JS, drag-drop, SSE, modals)
package.json      - express, pg, dotenv, cors, body-parser, multer, docx, pdfkit, mammoth, pdf-parse, passport(+google-oauth20), connect-pg-simple
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
- **Staleness Detection**: warns when a tree is old / heavily compressed; injects anti-hallucination rules. `GET /api/projects/:id/staleness`.
- **Anti-Sycophancy**: universal truthfulness rules in every stance; preserved through tree updates/compression.
- **Compare Stances** (⚖ Compare): dual-column overlay streaming two stances concurrently; does not write transcript. `POST /api/chat/compare`.
- **Stance Toggle**: Agreeable / Neutral / Mildly Critical / Strongly Critical — a CONTENT directive, all bound by truthfulness rules.
- **System Diagnostic** (🧪): live self-check of env vars, DB/tables, LLM API reachability, functional CRUD, cleanup. `POST /api/diagnostic/run`.
- **Context Management (flat per-turn cost)**: hot paths never load the full transcript — `loadRecentTranscript()` trims to last N in SQL. Chat uses last ~12 msgs; cross-session context only for project-specific queries. On-demand features (report/summarize/profile/paper) still load the full transcript.
- **Kill switch**: stop button / Escape aborts fetch; server cancels upstream streams and saves partial transcript ("[Stopped by user]").

## Authentication: MANDATORY Google login via canonical server/auth.js
- `server/auth.js` is a verbatim port (only domain values changed). **Do NOT rewrite its logic.**
- **Login REQUIRED**: no Google sign-in → no site. Client shows a full-screen login gate; `requireAuth` returns 401 for anonymous requests. Signed-in users get their own workspace; the owner's Google email maps to the JMK workspace (seeded at boot).
- **This breaks the R1 Beta Test harness** (it relied on the anonymous workspace) — expected, not a regression.
- setupAuth: passport + passport-google-oauth20 + connect-pg-simple sessions (`user_sessions`), session-state CSRF, per-request callback URL from trusted hosts. Secrets: GOOGLE_CLIENT_ID/SECRET (legacy GOOGLE_LOGIN_*/GOOGLE_OAUTH_* are fallbacks). Routes under `/auth/google*` and `/api/auth/*` (both callback paths must be registered in Google Cloud Console).
- **Admin = Google email match** `johnmichaelkuczynski@gmail.com` (hardcoded ADMIN_EMAIL; mirrored client-side only for button visibility). Admin dashboard at `/administrative` (data API 403 until owner signs in); visit buckets 24h/week/month/year/all + sign-in list.
- **DEV-ONLY preview auto-login**: `GET /api/auth/dev-login` exists only when `REPLIT_DEPLOYMENT` is unset; client auto-calls it on `.replit.dev`/localhost so the preview is always signed in. Production requires real Google login.
- CSRF guard (foreign-Origin rejection on non-GET `/api/*`) + CORS allowlist remain; sameSite=None cookie mutation for the iframe preview runs after setupAuth.

## Database Tables
users, projects (user_id FK, tractatus_tier, parent_project_id, pinned_context, audit_lessons), sessions (ground_rules), project_documents, global_documents (user_id FK), document_jobs (user_id FK), document_chunks, tractatus_archive, user_analytics (user_id UNIQUE, profile_tree JSONB), profile_snapshots, reminders, user_sessions (auth), login_events.

## Environment Variables
ANTHROPIC_API_KEY, OPENAI_API_KEY, DEEPSEEK_API_KEY, XAI_API_KEY, VENICE_API_KEY, DATABASE_URL, GOOGLE_CLOUD_VISION_API_KEY, GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET, ASSEMBLYAI_API_KEY, SESSION_SECRET, PORT (default 5000). Anthropic key prefers Replit AI integration (AI_INTEGRATIONS_ANTHROPIC_API_KEY/_BASE_URL) with fallback to ANTHROPIC_API_KEY.

## Replit Environment / Deployment
- Run: `npm run dev` (dev) / `npm start` (prod) — both run `node server/index.js` on port 5000; no build step. Deployment: autoscale.
- Transcript saves use atomic JSONB append to avoid lost updates.

## Critical Rules
- NO React, Vite, Tailwind, TypeScript, Drizzle, shadcn, Prisma, ORM. Only raw pg + official APIs.
- Coherence engine queries skeleton/deltas from DB every chunk (never from memory); 15-second mandatory pauses between chunks.
- Summary projects (`tractatus_tier > 1`) are hidden from the main project list.
- Keep owner-facing replies extremely short, calm, and plain (no jargon).
