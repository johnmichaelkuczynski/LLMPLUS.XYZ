---
name: Diary AI refusals and safety
description: Durable handling of empty model refusals and non-clinical analytics policy checks.
---

Treat a successful HTTP response with no model text as a possible policy refusal, not a transient parse error. User-authored diary capture must still persist deterministically when model classification refuses.

**Why:** A harmless-looking diary phrase repeatedly produced HTTP 200 responses with an empty content array and a refusal stop reason. Retrying could not recover it, so model-only memory updates would silently lose durable project memory.

**How to apply:** Keep raw user entries authoritative, serialize project-memory updates, and append a non-analytical fallback node when classification returns no usable text. For analytics safety, scan clauses after “but,” “yet,” and similar pivots; never exempt an entire sentence merely because it begins with a disclaimer. Use deterministic filtering plus a separate fail-closed classifier for the full prohibited-trait taxonomy.