---
name: Rollback workflow restart
description: A checkpoint rollback can restore files while the running server continues executing the pre-rollback code from memory.
---

**Rule:** After any checkpoint or code rollback, restart every affected running workflow before testing the restored state.

**Why:** The workspace files were restored, but the Node server continued executing the later broken code already loaded in memory. The app therefore looked unchanged until the workflow restarted.

**How to apply:** Compare current logs with current source markers when rollback behavior seems impossible. Restart the application workflow, then verify the new process logs and behavior before editing anything else.