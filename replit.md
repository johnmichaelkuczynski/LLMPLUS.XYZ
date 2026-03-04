# LLM Plus

## Overview
Minimalist web chat app connecting to Anthropic Claude with document management, persistent per-project Tractatus tree memory, and a three-pass coherence engine for large document generation (up to 150k words).

## Architecture
- Plain HTML/CSS/JS frontend (no frameworks)
- Node.js + Express backend (ESM due to locked package.json)
- Raw pg Pool for PostgreSQL (Neon database via NEON_DATABASE_URL)
- Official Anthropic API (https://api.anthropic.com/v1/messages, x-api-key header)
- Model: claude-sonnet-4-20250514, max_tokens: 8192

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
- **SSE Streaming Chat**: Real-time word-by-word streaming from Claude with blinking cursor
- **Tractatus Tree Memory**: Per-project persistent JSONB tree, injected into every system prompt, updated after every exchange in a background popup (green, draggable, minimizable) that streams the JSON update so it doesn't block chat
- **Three-Pass Coherence Engine**: Outline → streaming section writing → global stitch & repair. Streams tokens live into paper popup. Short docs (≤5000 words) use single-call mode. User instructions are prioritized; chat transcript is NOT injected into paper prompts.
- **Document Upload**: PDF, DOCX, DOC, TXT, and image files (PNG, JPG, GIF, BMP, TIFF, WebP) via click or drag-and-drop. Images are processed with Google Cloud Vision OCR.
- **Document Library**: General Library modal to browse, select, download, and send documents to Claude. Upload from PC button. Drag-and-drop onto library button uploads directly to global library.
- **Artifact Panel**: When Claude generates a document (detected by length + structure), a formatted preview panel slides in from the right with proper document formatting (serif font, headings, justified text). Download as TXT/DOCX/PDF or save to library. "View as Document" button appears in chat to reopen the panel. Works for both streamed responses and transcript replay.
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
