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

**How to apply:** any time you touch chat/compare context assembly, re-check these three. Measure TTFT against the largest real session (find it via `ORDER BY pg_column_size(transcript) DESC`), not a fresh one.

## The scalable fix (makes per-turn cost flat, not just smaller)
Trimming constants (fewer messages / chars) only lowers the constant — the read still scaled with session length because it did `SELECT transcript` (whole JSONB) then `slice()` in Node. The real fix: `loadRecentTranscript(sessionId, limit)` trims the tail IN SQL, so the hot path never transfers/parses the full transcript. Applied to both `/api/chat` and `/api/chat/compare` (last 16). Result: TTFT went flat (~1.5s) across 4-, 76-, and 98-message sessions (was 3.3s on the 98-msg one).

**Key reasoning for future scale questions:** the felt "conversation dragging" is entirely at READ time (before generation). The transcript WRITE (`jsonb ||` append) happens AFTER the response streams, so its O(n) cost does NOT affect perceived latency — don't waste a risky message-per-row migration on it unless write throughput itself becomes a problem. On-demand features (report/summarize/profile/paper) still load the full transcript on purpose; that's fine, they're not the hot path.
**Why:** user demanded a "scalable" solution and was right that constant-tuning wasn't it — the architecture, not the numbers, had to stop scaling with length.
