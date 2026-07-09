---
name: "Normal" length runaway — prompt recency + token ceiling, not continuation
description: Why "Normal" produced never-ending essays for simple questions, and the levers that actually control it.
---

# "Normal" length = never-ending: the real levers

Symptom: user asks a yes/no ("tell me if this document is correct") in NORMAL mode and gets a giant section-by-section / clause-by-clause essay. User rage: "NORMAL SEEMS TO MEAN NEVER ENDING."

It was NOT the auto-continuation logic (that already correctly refuses to continue on max_tokens without an explicit word target / long-form request). The runaway came from a SINGLE call. Three compounding causes:

1. **Persona lead-in rewarded verbosity.** The system prompt opened by telling the model to give "expert-level, intellectually rigorous responses" — the model reads that as "be elaborate." Fix: frame rigor as QUALITY of reasoning, not LENGTH, and tell it to match length to the request.
2. **No end-of-prompt reminder for Normal.** Concise mode had a strong FINAL REMINDER appended AFTER buildSystemPrompt returns (recency wins); Normal's length instruction was buried mid-prompt and got drowned by persona + heavy project/legal context. Fix: give Normal its own end-of-prompt FINAL REMINDER, mirroring concise.
3. **Token ceiling too high.** Normal max_tokens was 4096 (~3000 words) so runaway was physically possible. Lowered to 2048 as a hard safety net (Normal does NOT auto-continue on max_tokens, so the ceiling is real).

**Durable rules:**
- Length control lives in THREE places that must agree: (a) the length block inside buildSystemPrompt, (b) an end-of-prompt FINAL REMINDER (recency; concise & normal both have one), (c) the max_tokens ceiling per mode. Changing only one is why earlier length fixes didn't stick.
- Recency matters: the last length instruction in the prompt wins. Length/target/ground-rules notes are deliberately appended AFTER buildSystemPrompt for this reason.
- "Confirm / verify / check / is this correct?" is a request for a brief yes/no, NOT a license to analyze. This is now a HIGHEST-PRIORITY rule alongside the "read and take note" procedural rule.
- Tradeoff accepted: a 2048 cap can truncate a genuinely-long Normal answer mid-sentence (Normal won't continue). Acceptable because if the model writes 1500+ words for a simple question it's already failing; shorter is what the user wants. Detailed/Exhaustive exist for real length.
