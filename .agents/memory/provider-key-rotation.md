---
name: Provider credential rotation
description: Automatic key recovery must preserve the user's chosen model and use only authorized configured credentials.
---

The user directed: “If a given LLM API key stops working automatically rotate it to one that works.”

**Why:** A provider rate-limit error blocked an ordinary chat even though an existing alternative Claude credential could answer.

**How to apply:** Recover with another configured credential for the selected provider before surfacing the failure. Do not interpret key rotation as permission to silently change the user's model. Honor provider cooldowns rather than repeatedly retrying a rejected credential. If no usable alternate exists, say so instead of claiming recovery.

Test both the failure transition and the alternate credential's real ability to answer. Distinguish injected failures from real upstream responses.

**Why:** A configured key is not necessarily a working key; a passing mocked transition alone cannot establish that the live replacement can answer.

**How to apply:** Use isolated synthetic chats or test-only routing instances, never force failures in an active user's generation. Do not expose or copy secret values while checking credentials.
