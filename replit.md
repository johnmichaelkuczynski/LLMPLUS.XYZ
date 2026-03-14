# LLM Plus

## Overview
Minimalist web chat app connecting to Anthropic Claude with document management, persistent per-project Tractatus tree memory with recursive compression, a three-pass coherence engine for large document generation (up to 150k words), and a standalone Tractator tool.

## Architecture
- Plain HTML/CSS/JS frontend (no frameworks)
- Node.js + Express backend (ESM due to locked package.json)
- Raw pg Pool for PostgreSQL (Neon database via NEON_DATABASE_URL)
- Official Anthropic API (https://api.anthropic.com/v1/messages, x-api-key header)
- Model: claude-sonnet-4-20250514, max_tokens: 16384

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
- **Recursive Memory Compression**: When a project's Tractatus tree reaches 500 nodes, it automatically compresses into a higher-tier summary. The original tree is archived and reset. Tier 1 = recent high-resolution nodes, Tier 2 = summary of first 500, Tier 3+ = recursive summaries. All tiers are loaded into the system prompt with appropriate context budgets (Tier 1: 12K chars, Tier 2: 6K, Tier 3+: 3K). Archives preserved in `tractatus_archive` table. Summary projects stored as hidden projects with `tractatus_tier > 1` and `parent_project_id` linking back.
- **Memory Hierarchy Viewer**: 🧠 button shows all memory tiers with expand/collapse per tier, color-coded tags (ASSERTS green, REJECTS red, ASSUMES orange, OPEN purple, RESOLVED gray, DOCUMENT blue, QUESTION pink), sorted tree keys, and archived snapshot listing.
- **Report Generator**: 📜 button opens modal with scope selector. Generates prose reports (normal sentences, not Tractatus nodes) from project data. Scopes: Entire Project, specific Chat, or "Since N trees ago" (using archive snapshots as temporal checkpoints). Loads tiered memory + chat transcripts + document listings per scope. Output is streamed and displayed in the artifact panel. Uses `stripMarkdownFromOutput` safety net. API: `POST /api/report/scopes` returns available scopes, `POST /api/report/generate` streams the report via SSE.
- **Three-Pass Coherence Engine**: Outline → streaming section writing with continuation → global stitch & repair. Each section uses `streamClaudeWithContinuation()` to chain up to 6 API calls per section, ensuring each section reaches its word target. Source material is keyword-matched per section (50K char budget) instead of generic truncation. Section sizes scale with document length (1500 words for <10K, 2000 for 10-20K, 3000 for 20K+ documents). Streams tokens live into paper popup. Short docs (≤5000 words) also use continuation when a target is set. User instructions are prioritized; chat transcript is NOT injected into paper prompts. Word count is optional (auto mode). **Multi-document source selector**: Paper writer modal shows checkboxes for all Project Library and General Library documents; user selects which docs to use as source material. Upload New button also available for ad-hoc uploads. Selected doc IDs (UUIDs) are passed to server as `selectedDocs` array; if none selected, falls back to all project docs. "Revise" button on completed output lets users iteratively refine without starting over.
- **Scholarly Research Integration**: "Fetch Scholarly Sources" checkbox in Paper Writer. When enabled, after outline generation: Claude generates 3-5 search queries per section → all 4 free academic APIs (Semantic Scholar, OpenAlex, CrossRef, PubMed) are hit in parallel per query → results are deduplicated by title → formatted with author, year, abstract, DOI/PMID → injected into each section's writing prompt with strict instructions to cite sources inline and ground all expansion in fetched material. If zero results returned, queries are automatically rephrased and retried. Research progress shown live in paper popup status bar. Functions: `searchSemanticScholar()`, `searchOpenAlex()`, `searchCrossRef()`, `searchPubMed()`, `fetchScholarlyResearch()`, `formatResearchForPrompt()`.
- **Document Upload**: PDF, DOCX, DOC, TXT, and image files (PNG, JPG, GIF, BMP, TIFF, WebP) via click or drag-and-drop. Images are processed with Google Cloud Vision OCR.
- **Document Library**: Two-tier library system — General Library (global, cross-project) and Project Library (scoped to each project). Both have keyword search, upload (button or drag-and-drop), select & send to chat, download, delete. Project Library also has "Copy to General" for selected docs. Sidebar buttons for both.
- **Artifact Panel**: When Claude generates a document-like response (detected by word count + structure: 150+ words with headings, 200+ words with paragraphs, 300+ words with numbered lists, or 800+ words), a formatted side panel auto-opens during streaming — slides in from right with live updates every 300ms. Buttons: Copy to clipboard, Download TXT/DOCX/PDF, Save to Library, Close.
- **Download**: Export coherence engine output and artifacts as TXT, DOCX, PDF
- **Collapsed Messages**: Large user messages (200+ words) show collapsed card with expand button
- **Context Management**: Chat messages truncated to 12K chars each, total context capped at 150K chars, cross-session context capped at 15K chars to prevent exceeding API token limits.

## Database Tables
projects (with tractatus_tier, parent_project_id for memory hierarchy), sessions, project_documents, global_documents, document_jobs, document_chunks, tractatus_archive

## Environment Variables
- ANTHROPIC_API_KEY: Claude API key
- DATABASE_URL: Neon PostgreSQL connection string
- GOOGLE_CLOUD_VISION_API_KEY: Google Cloud Vision API key for image OCR
- PORT: Server port (default 5000)

## Critical Rules
- NO React, Vite, Tailwind, TypeScript, Drizzle, shadcn, Prisma, ORM
- Only raw pg, official Anthropic API
- Coherence engine queries skeleton/deltas from DB every chunk (never from memory)
- 15-second mandatory pauses between chunks
- Summary projects (tractatus_tier > 1) are hidden from the main project list
