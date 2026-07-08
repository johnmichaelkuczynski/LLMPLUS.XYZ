---
name: Chat context-build latency
description: Why per-message chat latency grew with conversation/project size, and the rules that keep it flat.
---

# Chat context build must not scale with project size

The `/api/chat` (and `/api/chat/compare`) latency was growing as a project accumulated large sessions. The app's whole selling point is that conversations DON'T drag as they get long, so this is a first-class regression whenever it reappears.

Root causes found (all in the per-turn context-build):
- The cross-session context query loaded the **full transcript JSONB of up to 10 other sessions on every message**, then trimmed to last 6 in JS — so a project with a ~1MB session paid ~1.3MB transfer+parse per turn, even when the answer never used cross-session context (the `includeProjectContext` gate ran AFTER the query).
- Recent history window was last 16 msgs @ 8000 chars (~128K char prompt) — far larger than needed given the memory system.
- Project-level fields were fetched in 3 separate `SELECT`s from `projects`.

**Rules to keep it flat:**
1. Never load whole transcript JSONBs to use only a tail. Trim in SQL: `jsonb_array_elements(... ) WITH ORDINALITY`, inner `ORDER BY ord DESC LIMIT N`, outer `jsonb_agg(e ORDER BY ord)` to restore chronological order. Guard with `CASE WHEN jsonb_typeof(transcript)='array' THEN transcript ELSE '[]'::jsonb END` for malformed legacy rows.
2. Gate expensive optional context (cross-session) behind the flag that decides whether it's used (`includeProjectContext`) — compute the flag first.
3. Keep the raw recent-history window lean (currently last 12 @ 5000 chars / 50K budget). **Why:** the Tractatus tree + tiered memory + pinned context are what carry continuity; the raw window is redundant safety, not the memory of record.

**How to apply:** any time you touch chat/compare context assembly, re-check these three. Measure TTFT against the largest real session (find it via `ORDER BY pg_column_size(transcript) DESC`), not a fresh one. Fixing all three took TTFT on a 98-message session from ~3.3s to ~1.8s.
