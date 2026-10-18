---
name: Cancellation and recovery
description: Why a busy-chat guard must abort pending work rather than blindly clear a lock.
---

Do not recover a stopped chat by simply expiring or forcibly clearing its busy lock while generation continues.

**Why:** A busy guard combined with flag-only cancellation stranded chats after Stop or disconnection. Blindly unlocking without cancelling the old work would instead allow overlapping replies and corrupt conversation ordering.

**How to apply:** Propagate cancellation through upstream requests, stalled response reads, retry waits and memory-index transactions. Preserve actual partial output before releasing ownership. Keep old malformed empty records archived, but do not send them as provider messages or render them as answers.

Do not reserve a database connection for the lifetime of a model response, and do not rely on a worker-local map as the sole ownership or cancellation authority.

**Why:** The original repair still left a lock held during post-answer indexing. A reserved generation connection and unbounded database waits could also exhaust the same pool used to verify sign-in. Isolated short-response checks did not cover either failure.

**How to apply:** Use expiring shared ownership with fenced writes and cross-worker cancellation. Release ownership before reporting completion. Keep sign-in reads independent of chat-pool exhaustion. Test Stop while memory indexing is deliberately blocked, not only while the provider is streaming.

A reopened browser must offer Stop for a remotely owned response even when it has no local streaming request.

**Why:** A correct backend cancellation endpoint still leaves the user blocked if reloading removes the only button that can invoke it.

**How to apply:** Derive the visible Stop action from shared live ownership, keep it scoped to the selected chat, and discard stale status responses after confirmed cancellation.

The shared generation fence currently resides alongside session health to avoid a new database migration; health updates must preserve it.

**Why:** Replacing the entire health object would silently remove live ownership and permit overlapping replies.

**How to apply:** Use the shared health-save operation, preserve the active fence, and do not let an expired request overwrite its successor's answer or diagnostics.

Historical answers without model provenance must not be relabeled as a guessed provider.

**Why:** Hardcoded Claude labels made other providers' historical answers look like Claude; refresh also discarded the user's model choice.

**How to apply:** Persist future attribution, preserve the browser's selected provider, and use a neutral label when historical provenance is absent.
