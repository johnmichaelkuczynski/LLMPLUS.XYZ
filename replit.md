# LLM Plus

## Overview
Minimalist web chat app connecting to Anthropic Claude with document management, persistent per-project Tractatus tree memory with recursive compression, a three-pass coherence engine for large document generation (up to 150k words), and a standalone Tractator tool.

## Architecture
- Plain HTML/CSS/JS frontend (no frameworks)
- Node.js + Express backend (ESM due to locked package.json)
- Raw pg Pool for PostgreSQL (Neon database via NEON_DATABASE_URL)
- Official Anthropic API (https://api.anthropic.com/v1/messages, x-api-key header)
- OpenAI API (https://api.openai.com/v1/chat/completions)
- DeepSeek API (https://api.deepseek.com/chat/completions, OpenAI-compatible)
- xAI/Grok API (https://api.x.ai/v1/chat/completions, OpenAI-compatible)
- Models: Claude (claude-sonnet-4-20250514), ChatGPT (gpt-4o), DeepSeek (deepseek-chat), Grok (grok-3); max_tokens: 16384

## File Structure
```
server/index.js   - Express server, all API routes, chat SSE, coherence engine, Tractatus
server/db.js      - pg Pool connection to Neon PostgreSQL
client/index.html - Single page HTML (white theme, bottom input bar)
client/style.css  - All styles (white UI, no dark mode)
client/app.js     - Frontend logic (vanilla JS, drag-drop, SSE, modals)
package.json      - Dependencies (express, pg, dotenv, cors, body-parser, multer, docx, pdfkit, mammoth, pdf-parse)
```

## Key Features
- **Projects & Sessions**: CRUD with auto-created "Main" project on first load. Double-click to rename projects or chats inline. New chats get a Claude-generated smart title after the first exchange. Move chats between projects via 📃 button.
- **SSE Streaming Chat**: Real-time word-by-word streaming from Claude with blinking cursor. Smart auto-continuation: when user requests a word count (e.g. "write 10000 words"), the server detects the target via `extractRequestedWordCount()`, chains up to 40 API calls using only the last 500 words as context (keeping context window small), and keeps going until 75% of the target is reached. Also supports "20k words" notation. Logs continuation progress to console.
- **Tractatus Tree Memory**: Per-project persistent JSONB tree, injected into every system prompt, updated after every exchange in a background popup (green, draggable, minimizable) that streams the JSON update so it doesn't block chat
- **Recursive Memory Compression**: When a project's Tractatus tree reaches 200 nodes, it automatically compresses into a higher-tier summary. After compression, the 30 most recent nodes are kept in Tier 1 (no cliff). Tier 2 = summary, Tier 3+ = recursive summaries. All tiers loaded into system prompt with a total memory budget of 15K chars (Tier 1: 8K, Tier 2: 4K, Tier 3+: 2K). Tree rendered in compact `key: value` format (not full JSON) to save tokens. Archives preserved in `tractatus_archive` table. Summary projects stored as hidden projects with `tractatus_tier > 1` and `parent_project_id` linking back.
- **Memory Hierarchy Viewer**: 🧠 button shows all memory tiers with expand/collapse per tier, color-coded tags (ASSERTS green, REJECTS red, ASSUMES orange, OPEN purple, RESOLVED gray, DOCUMENT blue, QUESTION pink), sorted tree keys, and archived snapshot listing.
- **Report Generator**: 📜 button opens modal with scope selector. Generates prose reports (normal sentences, not Tractatus nodes) from project data. Scopes: Entire Project, specific Chat, or "Since N trees ago" (using archive snapshots as temporal checkpoints). Loads tiered memory + chat transcripts + document listings per scope. Output is streamed and displayed in the artifact panel. Uses `stripMarkdownFromOutput` safety net. API: `POST /api/report/scopes` returns available scopes, `POST /api/report/generate` streams the report via SSE.
- **Three-Pass Coherence Engine**: Outline → streaming section writing with continuation → global stitch & repair. Each section uses `streamClaudeWithContinuation()` to chain up to 6 API calls per section, ensuring each section reaches its word target. Source material is keyword-matched per section (50K char budget) instead of generic truncation. Section sizes scale with document length (1500 words for <10K, 2000 for 10-20K, 3000 for 20K+ documents). Streams tokens live into paper popup. Short docs (≤5000 words) also use continuation when a target is set. User instructions are prioritized; chat transcript is NOT injected into paper prompts. Word count is optional (auto mode). **Multi-document source selector**: Paper writer modal shows checkboxes for all Project Library and General Library documents; user selects which docs to use as source material. Upload New button also available for ad-hoc uploads. Selected doc IDs (UUIDs) are passed to server as `selectedDocs` array; if none selected, falls back to all project docs. "Revise" button on completed output lets users iteratively refine without starting over.
- **Scholarly Research Integration**: "Fetch Scholarly Sources" checkbox in Paper Writer. When enabled, after outline generation: Claude generates 3-5 search queries per section → all 4 free academic APIs (Semantic Scholar, OpenAlex, CrossRef, PubMed) are hit in parallel per query → results are deduplicated by title → formatted with author, year, abstract, DOI/PMID → injected into each section's writing prompt with strict instructions to cite sources inline and ground all expansion in fetched material. If zero results returned, queries are automatically rephrased and retried. Research progress shown live in paper popup status bar. Functions: `searchSemanticScholar()`, `searchOpenAlex()`, `searchCrossRef()`, `searchPubMed()`, `fetchScholarlyResearch()`, `formatResearchForPrompt()`.
- **Document Upload**: PDF, DOCX, DOC, TXT, and image files (PNG, JPG, GIF, BMP, TIFF, WebP) via click or drag-and-drop. Images are processed with Google Cloud Vision OCR.
- **Document Library**: Two-tier library system — General Library (global, cross-project) and Project Library (scoped to each project). Both have keyword search, upload (button or drag-and-drop), select & send to chat, download, delete. Project Library also has "Copy to General" for selected docs. Sidebar buttons for both.
- **Artifact Panel**: When Claude generates a document-like response (detected by word count + structure: 150+ words with headings, 200+ words with paragraphs, 300+ words with numbered lists, or 800+ words), a formatted side panel auto-opens during streaming — slides in from right with live updates every 300ms. Buttons: Copy to clipboard, Download TXT/DOCX/PDF, Save to Library, Close.
- **Download**: Export coherence engine output and artifacts as TXT, DOCX, PDF
- **Collapsed Messages**: Large user messages (200+ words) show collapsed card with expand button
- **Response Length Control**: Four-mode selector above chat input: Concise (1024 tokens, no continuations), Normal (4096 tokens, 2 continuations), Detailed (8192 tokens, 10 continuations), Exhaustive (16384 tokens, 40 continuations). System prompt adapts per mode. If user specifies a word count in their message, it overrides to full tokens. Default is Normal. Server validates input.
- **Streaming UX**: All SSE endpoints include `X-Accel-Buffering: no` header. Chat endpoint sends immediate `status: thinking` event. Client shows animated bouncing dots while waiting for first token, then transitions to blinking cursor with streaming text.
- **Summarize Project/Chat**: Two sidebar buttons. Opens a modal with length options: Auto (default, calculated from content size), Brief (~200 words), Moderate (~600 words), Detailed (~1500 words or custom). Auto mode scales: <500 source words → 150, <2K → 300, <5K → 500, <15K → 800, <40K → 1200, 40K+ → 2000. Summary streams via SSE and opens in the artifact panel with copy/download options. Server endpoint: `POST /api/summarize` with `scope` (project/chat), `chatId`, `targetWords`.
- **User Analytics / Profile Me**: Cross-project user profiling system. Maintains a dedicated Tractatus-style profile tree (`user_analytics` table) that builds incrementally every 5th chat exchange by analyzing all project trees + the latest conversation. Profile tree categories: 1.x Topics, 2.x Conversational Style, 3.x Writing Patterns, 4.x Cognitive Patterns, 5.x Emotional Patterns, 6.x Evolution. "Profile Me" sidebar button (amber) generates a full clinical profile via SSE streaming — gathers all project trees, samples 20 recent conversations, compares against previous profile snapshot, and produces an 800-1500 word analysis with evidence/quotations. Output opens in artifact panel. Profile snapshots saved to `profile_snapshots` table for longitudinal tracking. Includes "Changes Since Last Profile" section comparing against previous generation. API: `POST /api/profile/generate` (SSE), `GET /api/profile/tree`, `GET /api/profile/history`, `GET /api/profile/snapshot/:id`.
- **Reminders**: Red sidebar button opens a reminders modal. Users can write notes/tasks, mark them complete (checkbox toggle), and delete them. A discrete yellow pulsing dot appears on the Reminders button whenever there are active (uncompleted) reminders. "Clear completed" button removes all finished items. Reminders are per-user, persisted in `reminders` table, optionally linked to a project. API: `GET /api/reminders`, `GET /api/reminders/count`, `POST /api/reminders`, `PATCH /api/reminders/:id` (toggle complete), `PUT /api/reminders/:id` (edit text), `DELETE /api/reminders/:id`.
- **Audit (Fact-Check)**: Every assistant message has an "Audit" button. Click it to fact-check the entire response — or highlight/select specific text first and then click Audit to check just that passage. The audit opens a side panel that streams a rigorous claim-by-claim analysis from Claude, cross-referencing against the project's Tractatus tree (all tiers), source documents, and recent chat history. Each claim is marked as VERIFIED, UNVERIFIABLE, or CONTRADICTED with evidence citations. Dates, numbers, and names are checked with extra strictness. API: `POST /api/audit` (SSE).
- **Staleness Detection**: Projects track `last_tree_update` (timestamp) and `compression_count` (integer). When a project's Tractatus tree hasn't been updated in 3+ days or has been compressed 2+ times, a warning banner appears above the chat area with severity levels: mild (3+ days / 2+ compressions), warning (7+ days / 3+ compressions), critical (14+ days / 5+ compressions). The system prompt also gets injected with anti-hallucination rules when staleness is detected, forcing the model to qualify uncertain claims and recommend auditing. API: `GET /api/projects/:id/staleness`.
- **Anti-Sycophancy System Prompt**: The system prompt has universal anti-silver-lining rules that apply in every stance: never lie or fabricate, never reframe defeats as victories without factual grounding, court rulings must distinguish what was held / not held / forward implications. The Tractatus tree update prompt and compression prompt include matching rules to preserve negative findings with full fidelity during memory updates and compression cycles.
- **Compare Stances**: Purple "⚖ Compare" button next to the stance toggle. Opens a picker modal to choose two of the four stances; on confirm, opens a full-screen dual-column overlay that streams both answers concurrently into left/right panes (each tagged by lane via SSE). Uses the same context (tree, tieredMemory, transcript, staleness) as `/api/chat` but with two distinct system prompts; does NOT write to transcript and does NOT trigger Tractatus updates (comparison is exploratory). Supports all 4 models. Aborts upstream API calls if the user closes the overlay (`req.on('close')` → `reader.cancel()`). Per-lane Copy buttons. API: `POST /api/chat/compare` (SSE, events: `text {lane:'A'|'B', text}`, `lane_end {lane}`).
- **Stance Toggle**: Four-position toggle in the input toolbar (amber buttons): Agreeable / Neutral / Mildly Critical / Strongly Critical. Stance is a CONTENT directive (which case to build), not a tonal one. Agreeable steel-mans the user's position. Strongly Critical steel-mans the contrary. All four stances are equally bound by the universal truthfulness rules — none may invent supporting or counter-evidence; agreeable mode must still correct factual errors plainly. State field: `state.stance`, default `'neutral'`. Wired through `/api/chat` body and into `buildSystemPrompt(..., stance)`.
- **System Diagnostic**: Teal "🧪 Diagnostic" button in the topbar runs a full self-check that streams results live: (1) **Environment** — verifies all 6 env vars are present (4 LLM keys + Vision + session secret); (2) **Database** — pings DB and verifies all 10 required tables exist; (3) **External LLM APIs** — sends a 1-token ping to Anthropic, OpenAI, DeepSeek, and xAI to confirm reachability and HTTP 200; (4) **Functional CRUD** — creates a test project + session + global document + reminder, exercises ownership verification, tractatus tree round-trip, staleness query, and system-prompt builder; (5) **Cleanup** — deletes everything created during the test so user data is untouched. Each step is reported as PASS/FAIL with timing. The check focuses on formal plumbing, not answer quality. API: `POST /api/diagnostic/run` (SSE).
- **Context Management**: Chat messages truncated to 8K chars each, last 16 messages sent, total context capped at 100K chars, cross-session context capped at 10K chars (6 msgs/session, 400 chars each). System prompt size logged to console for monitoring.

## Multi-User Authentication
- Username/password auth (no email), bcryptjs hashing, express-session with 30-day cookie
- Login screen shown on load; on success, main app loads
- JMK user: special case, any password works (password_hash is NULL)
- All data (projects, global_documents, document_jobs) filtered by user_id from session
- Sessions, project_documents, tractatus_archive scoped through their project FK
- Auth routes: POST /api/auth/register, POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me
- requireAuth middleware protects all /api/* except /auth/*
- New users start with empty state; complete data isolation between users

## Database Tables
users (id UUID, username, password_hash nullable), projects (with user_id FK, tractatus_tier, parent_project_id for memory hierarchy), sessions, project_documents, global_documents (with user_id FK), document_jobs (with user_id FK), document_chunks, tractatus_archive, user_analytics (user_id UNIQUE, profile_tree JSONB, exchange_count, last_updated), profile_snapshots (user_id, profile_text, word_count, created_at)

## Environment Variables
- ANTHROPIC_API_KEY: Claude API key
- OPENAI_API_KEY: OpenAI ChatGPT API key
- DEEPSEEK_API_KEY: DeepSeek API key
- XAI_API_KEY: xAI/Grok API key
- DATABASE_URL: Neon PostgreSQL connection string
- GOOGLE_CLOUD_VISION_API_KEY: Google Cloud Vision API key for image OCR
- SESSION_SECRET: Express session secret
- PORT: Server port (default 5000)

## Critical Rules
- NO React, Vite, Tailwind, TypeScript, Drizzle, shadcn, Prisma, ORM
- Only raw pg, official Anthropic API
- Coherence engine queries skeleton/deltas from DB every chunk (never from memory)
- 15-second mandatory pauses between chunks
- Summary projects (tractatus_tier > 1) are hidden from the main project list
