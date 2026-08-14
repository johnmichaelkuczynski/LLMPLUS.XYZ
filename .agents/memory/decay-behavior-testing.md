---
name: Decay-warning behavioral testing
description: How to run repeatable behavioral A/B checks of prompt-injected memory-decay effects on chat answers.
---
Behavioral checks of prompt-level effects (e.g. the memory-decay notice) need a true A/B design: identically-seeded degraded vs healthy control projects, repeated trials, and a control invariant (decay-specific language must appear in a MAJORITY of degraded trials and ZERO control trials).
**Why:** generic hedging appears in healthy replies too (baseline anti-fabrication), so "the degraded reply hedges" proves nothing by itself; completion review rejects checks that can't attribute behavior to the injected notice.
**How to apply:**
- One project PER TRIAL: /api/chat deliberately cross-injects other sessions of the same project, so reusing a project leaks earlier trial answers into later ones.
- Fabrication detectors must be over-inclusive (ordinal/textual/ISO/slash dates, USD/„dollars"/spelled-out amounts) and fail regardless of hedging — a hedged fabricated figure is still a failure.
- Degrade via SQL (compression_count, old last_tree_update, tractatus_archive rows); verify via /api/projects/:id/memory-health before spending model calls; clean up synthetic projects in `finally`.
- Working harness: tools/r1/decay-check.mjs (must hit https://$REPLIT_DEV_DOMAIN — secure cookie).
