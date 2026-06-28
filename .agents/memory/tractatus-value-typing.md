---
name: Tractatus tree node values are not guaranteed strings
description: Why string methods on tree/JSONB node values crash chat, and how to guard
---

Tractatus tree nodes are stored in JSONB. Individual node values can be non-strings (numbers, nested objects) even though the format convention says values are summary strings. Calling string methods (`.toLowerCase()`, `.substring()`, `.split()`) directly on a node value will throw `X is not a function`.

**Why:** A single crash here is invisible to the user. The `/api/chat` `streamOneCall` catch historically swallowed exceptions and returned empty `segmentText` with nothing written to the SSE stream — so the symptom was an empty assistant bubble / "app won't answer", not an error. This made it look like "the app breaks all the time."

**How to apply:**
- Before any string method on a tree node value, coerce: `typeof v === 'string' ? v : (v == null ? '' : JSON.stringify(v))` (or `String(v)` when a number is acceptable).
- `compactTreeString` is safe because it uses `+` concatenation (auto-coerces) — prefer that pattern when rendering trees.
- Keep streaming catch blocks loud: write a visible error event to the SSE stream (guarded by `!res.writableEnded`) so future failures aren't silent.
