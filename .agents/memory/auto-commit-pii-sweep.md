---
name: Auto-commit sweeps attached_assets PII
description: Task commits auto-include stray user-pasted transcripts; code review rejects them.
---
Task completion auto-commits everything in the working tree, including user-pasted chat transcripts in attached_assets/ that contain sensitive legal/PII content. Completion review REJECTS commits containing them.
**Why:** task #-completion was rejected once for two Pasted-*.txt transcript files swept into the commit.
**How to apply:** before markTaskComplete, check `git status` / recent adds under attached_assets; `git rm` unrelated pasted transcripts and amend so the commit is feature-only.
