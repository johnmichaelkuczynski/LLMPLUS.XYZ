# LLM Plus — Technical Reference

## What This App Is

LLM Plus is a web chat application that connects to the Anthropic Claude API (model: `claude-sonnet-4-20250514`). It goes beyond simple chat by providing:

- **Per-project persistent memory** using a "Tractatus tree" (a JSONB knowledge graph that grows and self-compresses)
- **A three-pass coherence engine** for generating large documents (up to 150K words) with automatic section continuation
- **Multi-user authentication** with data isolation between users
- **Document management** with two-tier library (project-scoped + global)
- **Scholarly research integration** pulling from 4 academic APIs
- **Real-time SSE streaming** for all AI operations

The entire stack is intentionally simple: plain HTML/CSS/JS frontend (no React, no build tools), Node.js + Express backend using ESM modules, raw `pg` for PostgreSQL (hosted on Neon). No ORMs, no TypeScript, no frameworks.

---

## File Tree

```
LLM-Plus/
├── server/
│   ├── index.js          (2,811 lines)  — THE main server file. Everything lives here.
│   └── db.js             (10 lines)     — PostgreSQL connection pool (pg.Pool → Neon)
│
├── client/
│   ├── index.html        (294 lines)    — Single-page HTML shell
│   ├── app.js            (3,304 lines)  — ALL frontend logic (vanilla JS IIFE)
│   └── style.css         (2,039 lines)  — ALL styles (white theme, no dark mode)
│
└── package.json          (120 lines)    — Dependencies and config
```

**Total: ~8,500 lines across 6 source files.**

---

## File-by-File Descriptions

### `server/db.js` (10 lines)
Creates and exports a `pg.Pool` connected to Neon PostgreSQL via `DATABASE_URL` env var with SSL. That's it — every other file imports `pool` from here.

### `server/index.js` (2,811 lines)
The entire backend in one file. Contains, in order:

| Lines (approx) | Section | What It Does |
|---|---|---|
| 1–25 | Imports & middleware | Express setup, multer (file upload), express-session, bcryptjs, CORS, static file serving for `/client` |
| 27–96 | Auth routes & middleware | `POST /api/auth/register`, `login`, `logout`, `GET /api/auth/me`. `requireAuth` middleware blocks all `/api/*` except `/auth/*`. JMK user bypasses password check. |
| 98–116 | Ownership helpers | `verifyProjectOwnership()`, `verifySessionOwnership()`, `verifyProjectDocOwnership()`, `verifyGlobalDocOwnership()` — called before every data operation to enforce user isolation |
| 118–199 | DB schema & init | `SCHEMA_SQL` constant creates all 8 tables. `initDB()` runs on startup, adds columns if missing, creates default project if DB is empty. |
| 201–350 | Claude API helpers | `callClaude()` — non-streaming and streaming modes. `streamClaudeToSSE()` — pipes Claude's streaming response directly to the client via SSE. `streamClaudeWithContinuation()` — chains multiple API calls for long outputs, using last 500 words as continuation context. `extractRequestedWordCount()` — regex to detect word count targets like "write 10000 words" or "20k words". `loadTieredMemory()` — loads all memory tiers for a project (Tier 1 current tree + archived higher tiers). |
| 350–480 | CRUD routes | Projects (list/create/delete/rename), Sessions (list/create/delete/rename/auto-title), all with ownership verification |
| 480–550 | Session utilities | Session download as TXT, transcript append |
| 551–790 | Chat endpoint | `POST /api/chat` — the main SSE streaming chat. Loads Tractatus tree + tiered memory + transcript + cross-session context. Builds system prompt with memory hierarchy. Handles response length modes (concise/normal/detailed/exhaustive). Auto-continuation for word count targets. Saves transcript. Triggers Tractatus update. |
| 791–975 | Report generator | `POST /api/report/scopes` and `POST /api/report/generate` — generates prose reports from project data. Supports scopes: entire project, specific chat, or "since N trees ago". |
| 975–1100 | Tractator | `POST /api/tractator/generate` — standalone tool that analyzes any text and generates a Tractatus tree from it. Handles large documents by splitting into segments. |
| 1100–1210 | Tractatus update | `POST /api/tractatus/update` — SSE endpoint called after every chat exchange. Claude analyzes the conversation and generates tree node updates (ASSERTS, REJECTS, ASSUMES, etc.). Merges into existing tree. Triggers compression if ≥500 nodes. |
| 1210–1310 | Tractatus compression | `compressTractatusTier()` — recursive function. When tree hits 500 nodes: archives current tree, asks Claude to compress into ~100 summary nodes, stores as higher-tier summary project, resets current tree. Recurses if the summary tier also hits 500. |
| 1310–1450 | Markdown/output helpers | `stripMarkdownFromOutput()`, `stripTractatusFromOutput()` — clean up Claude's output for final display |
| 1450–1700 | Scholarly research | `searchSemanticScholar()`, `searchOpenAlex()`, `searchCrossRef()`, `searchPubMed()` — 4 parallel academic API integrations. `fetchScholarlyResearch()` orchestrates all 4, deduplicates, retries with rephrased queries. `formatResearchForPrompt()` formats citations for injection into prompts. |
| 1700–2220 | Coherence engine | `POST /api/coherence` — the three-pass document generation engine. Pass 1: Claude generates JSON outline. Pass 2: writes each section with streaming + continuation (up to 6 API calls per section), keyword-matched source material per section. Pass 3: global stitch & repair pass. Handles scholarly research injection per section. `POST /api/coherence/revise` — revises a completed document based on user instructions. |
| 2220–2350 | Download routes | `GET /api/download/:jobId/:format` — export coherence engine output as TXT/DOCX/PDF. `POST /api/artifact/docx` and `POST /api/artifact/pdf` — export artifact panel content. |
| 2350–2800 | Document management | Project documents (CRUD, move between projects, copy to global). Global documents (CRUD, user_id filtered). Upload endpoint (PDF/DOCX/DOC/TXT/image with Google Cloud Vision OCR). Save artifact/generated documents to both libraries. Insert document content into chat. Copy/move between libraries. |
| 2800–2812 | Server startup | Catch-all route serves `index.html`. `initDB()` then `app.listen()` on port 5000. |

### `client/index.html` (294 lines)
Single-page HTML shell. Contains:
- **Login screen** (`#login-screen`) — username/password form, shown when not authenticated
- **Main app** (`#app`, hidden until login) — flex layout with:
  - **Sidebar** (`aside.sidebar`) — project list, session list, library buttons, tool buttons (Memory Hierarchy, Report Generator, Tractator), user bar with sign-out
  - **Main area** (`main.main`) — topbar, messages container, welcome screen, chat input with response length pills, file upload, paper writer button
  - **Document panel** (`aside.doc-panel`) — right sidebar for project/global document lists
  - **Artifact panel** (`#artifact-panel`) — slide-in panel for formatted document display with download/copy/save buttons
- **Modals** — Library modal (tabbed global/project docs with search, upload, select), Project rename modal, Paper writer modal, Move session modal, Report generator modal, Tractator modal, Memory hierarchy modal

### `client/app.js` (3,304 lines)
All frontend logic in a single IIFE `(function() { ... })()`. Contains:

| Section | What It Does |
|---|---|
| State & DOM refs | `state` object (projects, sessions, currentProject, currentSession, streaming flag, docs, attachments, responseLength). `els` object caches all DOM element references. |
| Tractatus helpers | `stripTractatusContent()` — removes tree JSON from displayed messages |
| Project/Session CRUD | `loadProjects()`, `loadSessions()`, `renderProjects()`, `renderSessions()`, inline rename (double-click), delete with confirmation |
| Chat engine | `sendMessage()` — posts to `/api/chat` SSE endpoint, handles streaming tokens, auto-title, artifact detection, thinking indicator (bouncing dots → blinking cursor) |
| Tractatus popup | Green draggable/minimizable popup that shows tree update streaming after each chat exchange |
| Artifact panel | Detects document-like responses (word count + structure heuristics), opens slide-in panel with formatted content, live-updates during streaming, download/copy/save buttons |
| Paper writer | Modal with title, instructions, word count, doc type selector, document checkboxes (project + global library), scholarly research toggle. Calls `/api/coherence` SSE. Revise button for iterative refinement. |
| Document management | Library modal (tabbed), upload via click or drag-and-drop, search, select & send to chat, download, delete, copy between libraries |
| Report generator | Modal with scope selector, instructions field. Calls `/api/report/generate` SSE. |
| Tractator | Modal to analyze pasted text. Calls `/api/tractator/generate` SSE. |
| Memory hierarchy | Modal showing tiered memory tree with color-coded tags, expand/collapse, archive listing |
| Response length | Four-mode pill selector (Concise/Normal/Detailed/Exhaustive) above chat input |
| Auth system | `checkAuth()` on load, login/register forms, logout, auto-fill password for JMK username |
| Drag & drop | File drop overlay for document upload |

### `client/style.css` (2,039 lines)
All styles. White/light theme only. Notable sections:
- Login screen (centered card with gradient background)
- Sidebar (fixed 240px, scrollable middle, sticky footer with user bar)
- Chat messages (user right-aligned blue, assistant left-aligned, collapsed large messages)
- Streaming indicators (bouncing dots animation, blinking cursor)
- Artifact panel (slide-in from right, formatted document display)
- Paper writer popup (floating panel with progress bar)
- Modals (library, project, report, tractator, memory hierarchy)
- Document panel (right sidebar)
- Response length pills

### `package.json` (120 lines)
Key dependencies:
- `express` (v5) — web server
- `pg` — PostgreSQL client
- `bcryptjs` — password hashing
- `express-session` — session management
- `multer` — file upload handling
- `docx` — DOCX generation
- `pdfkit` — PDF generation
- `mammoth` — DOCX → text extraction
- `pdf-parse` — PDF → text extraction
- `dotenv` — env var loading
- `cors`, `body-parser` — middleware
- `"type": "module"` — ESM imports throughout

---

## Database Schema

8 tables, all using UUID primary keys:

```
users
├── id UUID (PK)
├── username TEXT (unique, case-insensitive lookup)
├── password_hash TEXT (nullable — JMK has NULL, bypasses password check)
└── created_at TIMESTAMPTZ

projects
├── id UUID (PK)
├── name TEXT
├── user_id UUID (FK → users) ← data isolation
├── tractatus_tree JSONB ← the live Tractatus memory tree
├── tractatus_tier INTEGER (default 1, >1 = hidden summary project)
├── parent_project_id UUID (FK → projects, self-ref for compression hierarchy)
└── created_at TIMESTAMPTZ

sessions (scoped via project FK)
├── id UUID (PK)
├── project_id UUID (FK → projects, CASCADE delete)
├── title TEXT
├── transcript JSONB (array of {role, content} messages)
└── created_at TIMESTAMPTZ

project_documents (scoped via project FK)
├── id UUID (PK)
├── project_id UUID (FK → projects, CASCADE delete)
├── name TEXT
├── raw_content TEXT
└── created_at TIMESTAMPTZ

global_documents
├── id UUID (PK)
├── user_id UUID (FK → users) ← data isolation
├── name TEXT
├── raw_content TEXT
└── created_at TIMESTAMPTZ

document_jobs
├── id UUID (PK)
├── session_id UUID (FK → sessions, CASCADE delete)
├── user_id UUID (FK → users) ← data isolation
├── status TEXT ('pending' | 'complete')
├── original_text TEXT
├── global_skeleton JSONB
├── final_output TEXT
└── created_at TIMESTAMPTZ

document_chunks
├── id UUID (PK)
├── job_id UUID (FK → document_jobs, CASCADE delete)
├── chunk_index INTEGER
├── chunk_text TEXT
├── chunk_output TEXT
├── chunk_delta JSONB
└── created_at TIMESTAMPTZ

tractatus_archive
├── id UUID (PK)
├── project_id UUID (FK → projects, CASCADE delete)
├── tier INTEGER
├── tree JSONB
├── node_count INTEGER
└── created_at TIMESTAMPTZ
```

**Data isolation model**: `users` → `projects` (via user_id) → `sessions`, `project_documents`, `tractatus_archive` (via project_id cascade). `global_documents` and `document_jobs` have direct `user_id` FK. Every API endpoint verifies ownership before any read/write.

---

## How the App Works (End to End)

### 1. Authentication Flow
- User visits the app → sees login screen (empty fields)
- Types username + password → `POST /api/auth/login` → server checks bcrypt hash (or bypasses for JMK) → sets `req.session.userId`
- All subsequent API calls check `req.session.userId` via `requireAuth` middleware
- Every data query includes ownership verification (project belongs to user, session belongs to user's project, etc.)

### 2. Chat Flow
1. User selects a project and session (or creates new ones)
2. Types a message → client calls `POST /api/chat` (SSE stream)
3. Server builds system prompt:
   - Loads **tiered Tractatus memory** (Tier 1: current tree up to 12K chars, Tier 2: 6K, Tier 3+: 3K each)
   - Loads **current session transcript** (capped at 150K chars, 12K per message)
   - Loads **cross-session context** from other sessions in the same project (15K cap)
   - Adds **response length instructions** based on selected mode
4. Calls Claude API with streaming enabled
5. Tokens stream back via SSE → client renders word-by-word with blinking cursor
6. If user requested a word count (e.g., "write 5000 words"), server auto-continues: chains additional API calls using last 500 words as context until 75% of target reached
7. After response completes:
   - Transcript saved to DB
   - **Tractatus update triggered** → separate SSE call to `/api/tractatus/update` → Claude analyzes the exchange and generates tree node updates → merged into project's `tractatus_tree` JSONB → shown in green popup
   - If artifact detected (long structured response), artifact panel slides open

### 3. Tractatus Memory System
- Each project has a `tractatus_tree` (JSONB object, keys are Wittgenstein-style numbers like "1.0", "1.1", "1.11")
- Each node value is tagged: `ASSERTS:`, `REJECTS:`, `ASSUMES:`, `OPEN:`, `RESOLVED:`, `DOCUMENT:`, `QUESTION:`
- Updated after every chat exchange via Claude analysis
- **Compression**: When tree reaches 500 nodes → archived → Claude compresses to ~100 summary nodes → stored as hidden Tier 2 project → current tree reset. If Tier 2 also hits 500, recursively compresses to Tier 3, etc.
- All tiers loaded into system prompt with decreasing char budgets

### 4. Three-Pass Coherence Engine (Paper Writer)
1. **Pass 1 — Outline**: Claude generates a JSON outline with section titles, descriptions, and word targets
2. **Pass 2 — Section Writing**: Each section written individually with:
   - Keyword-matched source material from selected documents (50K char budget per section)
   - Scholarly research injected if enabled (4 academic APIs queried in parallel)
   - `streamClaudeWithContinuation()` chains up to 6 API calls per section to hit word targets
   - Tokens stream live to client
3. **Pass 3 — Stitch & Repair**: Claude reviews entire assembled document for coherence, fixes transitions, removes redundancy
4. Final output saved to `document_jobs` table, downloadable as TXT/DOCX/PDF
5. "Revise" button allows iterative refinement without restarting

### 5. Document Management
- **Project Library**: Documents scoped to a project. Upload PDF/DOCX/DOC/TXT/images (OCR via Google Cloud Vision). Used as source material for Paper Writer.
- **General Library**: Global documents across all projects (but user-scoped). Can copy between libraries.
- **Artifact Panel**: Auto-detects document-like Claude responses, shows formatted view with download/copy/save buttons.

---

## API Endpoints Reference

### Auth
| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` | Create account (username + password, min 4 chars) |
| POST | `/api/auth/login` | Login (JMK: any password works) |
| POST | `/api/auth/logout` | Destroy session |
| GET | `/api/auth/me` | Current user info or 401 |

### Projects & Sessions
| Method | Path | Description |
|---|---|---|
| GET | `/api/projects` | List user's projects (hides tier >1 summaries) |
| POST | `/api/projects` | Create project |
| DELETE | `/api/projects/:id` | Delete project + cascade |
| POST | `/api/projects/:id/name` | Rename project |
| GET | `/api/projects/:id/sessions` | List sessions in project |
| POST | `/api/projects/:id/sessions` | Create session |
| DELETE | `/api/sessions/:id` | Delete session |
| POST | `/api/sessions/:id/title` | Rename session |
| POST | `/api/sessions/:id/auto-title` | Claude generates title from first exchange |
| GET | `/api/sessions/:id/download` | Download transcript as TXT |
| POST | `/api/sessions/:id/transcript` | Append messages to transcript |
| POST | `/api/sessions/:id/move` | Move session to different project |

### Chat & AI
| Method | Path | Description |
|---|---|---|
| POST | `/api/chat` | SSE streaming chat with Claude |
| POST | `/api/tractatus/update` | SSE — Claude updates Tractatus tree from exchange |
| GET | `/api/projects/:id/tractatus` | Get project's current Tractatus tree |
| GET | `/api/projects/:id/memory-hierarchy` | Get all memory tiers |
| POST | `/api/tractator/generate` | SSE — standalone Tractatus analysis of any text |
| POST | `/api/report/scopes` | Get available report scopes for project |
| POST | `/api/report/generate` | SSE — generate prose report |
| POST | `/api/coherence` | SSE — three-pass document generation |
| POST | `/api/coherence/revise` | SSE — revise generated document |

### Documents
| Method | Path | Description |
|---|---|---|
| GET | `/api/projects/:id/documents` | List project documents |
| GET | `/api/documents/global` | List global documents |
| POST | `/api/documents/upload` | Upload file (multipart) |
| POST | `/api/documents/save-artifact` | Save artifact to both libraries |
| POST | `/api/documents/save-generated` | Save coherence engine output |
| POST | `/api/documents/insert` | Get document content for chat insertion |
| GET | `/api/documents/global/:id/download` | Download global doc |
| GET | `/api/documents/global/:id/content` | Get global doc content |
| DELETE | `/api/documents/global/:id` | Delete global doc |
| GET | `/api/projects/documents/:id/content` | Get project doc content |
| GET | `/api/projects/documents/:id/download` | Download project doc |
| DELETE | `/api/projects/documents/:id` | Delete project doc |
| POST | `/api/projects/documents/:id/move` | Move doc to another project |
| POST | `/api/projects/documents/:id/copy-to-global` | Copy project doc to global |
| POST | `/api/documents/copy-to-project` | Copy doc to a project |
| POST | `/api/documents/copy-to-global` | Copy doc to global library |
| GET | `/api/download/:jobId/:format` | Download coherence output (txt/docx/pdf) |
| POST | `/api/artifact/docx` | Generate DOCX from text |
| POST | `/api/artifact/pdf` | Generate PDF from text |

---

## Environment Variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | Claude API key |
| `GOOGLE_CLOUD_VISION_API_KEY` | Image OCR |
| `SESSION_SECRET` | Express session encryption |
| `PORT` | Server port (default 5000) |

---

## Key Technical Details

- **ESM only**: `"type": "module"` in package.json — all files use `import`/`export`, no `require()`
- **Express v5**: Wildcard routes use `app.get('/{*splat}', ...)` syntax
- **All IDs are UUIDs**: Never `parseInt()` an ID
- **SSE pattern**: All streaming endpoints set `Content-Type: text/event-stream`, `X-Accel-Buffering: no`, send `data: JSON\n\n` events, end with `data: [DONE]\n\n`
- **Claude max_tokens**: 16,384 per API call. Continuation chains multiple calls for longer output.
- **Context limits**: 12K chars per message, 150K total context, 15K cross-session context
- **No build step**: Frontend served as static files from `/client` directory
