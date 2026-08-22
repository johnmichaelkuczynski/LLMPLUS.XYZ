---
name: No-login owner access
description: The app intentionally has no login and must retain the exact pre-existing owner's data identity.
---

**Rule:** The app has no login provider, login screen, session, logout, or development-login shortcut. Every application request resolves to the one pre-existing owner row; do not create or substitute a default user.

**Why:** Authentication was repeatedly added and removed at the user's direction. The current explicit decision is to remove all provider login while retaining the owner's existing projects, chats, documents, and profiles.

**How to apply:** Bind request ownership to the exact existing owner record and fail closed if it is missing or ambiguous. Keep historical identity columns and access-event rows because deleting them could destroy retained data. Former login routes should return 404 explicitly rather than falling through to the SPA.