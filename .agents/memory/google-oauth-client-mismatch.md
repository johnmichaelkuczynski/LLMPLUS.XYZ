---
name: Google OAuth redirect_uri_mismatch diagnosis
description: How to diagnose redirect_uri_mismatch when the redirect URI looks correctly registered
---

**Rule:** When Google returns `redirect_uri_mismatch` even though the exact URI appears registered in the Console, suspect the *client*, not the URI — the user may be editing a different OAuth client than the one whose credentials the app holds.

**Why:** Client IDs in the same Google Cloud project all share the same numeric prefix (`<project-number>-<hash>.apps...`), so prefix comparison cannot distinguish clients. In this project the owner had registered the URIs on one client while the app's secrets held another client from the same project.

**How to apply:**
- Extract the client_id the app actually sends: `curl -sD - localhost:5000/auth/google | grep -i location` — client_id in the redirect URL is public info, safe to compare.
- To confirm which key source the server uses, capture the full client_id to a file, change the env/secret, restart, and `cmp` before/after — never print secret values.
- Shell/bash sessions and the code_execution sandbox do NOT get Replit secrets in env; only workflows do. Equality checks against `$SECRET` in bash silently compare against empty string.
- Fastest resolution: open a secure secrets prompt and have the owner re-paste ID+secret from the exact Console page where the redirect URIs are registered.
- Remember production only picks up new secrets/code after republishing; errors screenshotted on the prod domain say nothing about the dev server.
