---
name: Personal Google access
description: Production uses one exact Google owner; development preview opens that same existing workspace without a login wall.
---

**Rule:** Production workspace APIs require a Google session for the exact approved owner email. The Replit development preview bypasses the visual login wall and resolves only the same pre-existing owner row. Never create, substitute, or reassign a user.

**Why:** The workspace contains personal data, but the owner must be able to work directly in the Replit development preview. The published app still needs Google protection for the personal workspace.

**How to apply:** Limit the development bypass to development/local preview hosts. In production, require the verified exact Google email. Keep all ownership checks bound to the unchanged database user ID and fail closed on missing, duplicate, or conflicting identity records.