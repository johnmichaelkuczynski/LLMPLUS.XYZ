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
- **Projects & Sessions**: CRUD with auto-created "Main" project on first load
- **SSE Streaming Chat**: Real-time word-by-word streaming from Claude
- **Tractatus Tree Memory**: Per-project persistent JSONB tree, injected into every system prompt, updated after every exchange
- **Three-Pass Coherence Engine**: Skeleton extraction → constrained chunk processing (15s pauses, fresh DB queries) → global stitch & repair
- **Document Upload**: PDF, DOCX, DOC, TXT via click or drag-and-drop
- **Document Library**: Book icon modal to browse and insert document text into chat input
- **Download**: Export coherence engine output as TXT, DOCX, PDF
- **Collapsed Messages**: Large user messages (200+ words) show collapsed card with expand button

## Database Tables
users, projects, sessions, project_documents, global_documents, document_jobs, document_chunks

## Environment Variables
- ANTHROPIC_API_KEY: Claude API key
- DATABASE_URL: Neon PostgreSQL connection string
- PORT: Server port (default 5000)

## Critical Rules
- NO React, Vite, Tailwind, TypeScript, Drizzle, shadcn, Prisma, ORM
- Only raw pg, official Anthropic API
- Coherence engine queries skeleton/deltas from DB every chunk (never from memory)
- 15-second mandatory pauses between chunks
