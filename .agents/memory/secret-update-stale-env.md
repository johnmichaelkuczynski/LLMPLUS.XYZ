---
name: Secret updates and stale env
description: How to verify a freshly updated Replit secret actually reached the process you're testing
---
- The agent shell can keep a stale copy of a secret after the user updates it; a "still failing" test may be testing the old value.
- **How to apply:** fingerprint without revealing — `echo -n "$KEY" | sha256sum | cut -c1-12` — and compare shell vs running server (`tr '\0' '\n' < /proc/<pid>/environ`). Restart the workflow after every secret update, and only restart AFTER the user has actually saved the value (auto-restarts fired by requestEnvVar can precede the save).
- Google `API_KEY_INVALID` = key doesn't exist at Google (deleted key/project) — no code fix possible; distinct from "expired" or referrer-blocked errors.
