# LLM Plus

## Overview
Minimalist web chat app connecting to Anthropic Claude with document management, persistent per-project Tractatus tree memory, and a three-pass coherence engine for large document generation (up to 150k words).

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
- **Projects & Sessions**: CRUD with auto-created "Main" project on first load. Double-click to rename projects or chats inline. New chats get a Claude-generated smart title after the first exchange.
- **SSE Streaming Chat**: Real-time word-by-word streaming from Claude with blinking cursor. Smart auto-continuation: when user requests a word count (e.g. "write 10000 words"), the server detects the target via `extractRequestedWordCount()`, chains up to 40 API calls using only the last 500 words as context (keeping context window small), and keeps going until 75% of the target is reached. Also supports "20k words" notation. Logs continuation progress to console.
- **Tractatus Tree Memory**: Per-project persistent JSONB tree, injected into every system prompt, updated after every exchange in a background popup (green, draggable, minimizable) that streams the JSON update so it doesn't block chat
- **Three-Pass Coherence Engine**: Outline → streaming section writing → global stitch & repair. Streams tokens live into paper popup. Short docs (≤5000 words) or auto-length use single-call mode. User instructions are prioritized; chat transcript is NOT injected into paper prompts. Word count is optional (auto mode). Source document upload available in paper writer modal. "Revise" button on completed output lets users iteratively refine without starting over — sends previous output + revision instructions to `/api/coherence/revise`. New doc types: legal_brief, rewrite, letter.
- **Document Upload**: PDF, DOCX, DOC, TXT, and image files (PNG, JPG, GIF, BMP, TIFF, WebP) via click or drag-and-drop. Images are processed with Google Cloud Vision OCR.
- **Document Library**: Two-tier library system — General Library (global, cross-project) and Project Library (scoped to each project). Both have keyword search, upload (button or drag-and-drop), select & send to chat, download, delete. Project Library also has "Copy to General" for selected docs. Sidebar buttons for both.
- **Artifact Panel**: When Claude generates a document-like response (detected by word count + structure: 150+ words with headings, 200+ words with paragraphs, 300+ words with numbered lists, or 800+ words), a formatted side panel auto-opens during streaming — slides in from right with live updates every 300ms. Buttons: Copy to clipboard, Download TXT/DOCX/PDF, Save to Library, Close. "View as Document" button appears in chat to reopen. Works for both streamed responses and transcript replay.
- **Download**: Export coherence engine output and artifacts as TXT, DOCX, PDF
- **Collapsed Messages**: Large user messages (200+ words) show collapsed card with expand button
- **Context Management**: Chat messages truncated to 12K chars each, total context capped at 150K chars, cross-session context capped at 15K chars to prevent exceeding API token limits.

## Database Tables
users, projects, sessions, project_documents, global_documents, document_jobs, document_chunks

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
