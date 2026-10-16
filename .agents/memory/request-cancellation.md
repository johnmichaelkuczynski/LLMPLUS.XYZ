---
name: Cancellation and recovery
description: Why a busy-chat guard must abort pending work rather than blindly clear a lock.
---

Do not recover a stopped chat by simply expiring or forcibly clearing its busy lock while generation continues.

**Why:** A busy guard combined with flag-only cancellation stranded chats after Stop or disconnection. Blindly unlocking without cancelling the old work would instead allow overlapping replies and corrupt conversation ordering.

**How to apply:** Propagate cancellation through upstream requests, stalled response reads and retry waits. Preserve actual partial output before releasing ownership. Destroy a database connection if unlocking it fails rather than returning a potentially locked connection to the pool. Keep old malformed empty records archived, but do not send them as provider messages or render them as answers.

Historical answers without model provenance must not be relabeled as a guessed provider.

**Why:** Hardcoded Claude labels made other providers' historical answers look like Claude; refresh also discarded the user's model choice.

**How to apply:** Persist future attribution, preserve the browser's selected provider, and use a neutral label when historical provenance is absent.
