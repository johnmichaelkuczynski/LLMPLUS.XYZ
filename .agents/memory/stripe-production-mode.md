---
name: Stripe production mode
description: The required Stripe credential and integration model for LLM Plus.
---

Use the official Stripe SDK with the project’s owner-managed live Stripe secrets. Do not add or depend on Replit’s Stripe sandbox-sync integration.

**Why:** The sandbox integration added a publishing prerequisite even though the live Stripe account, price, and subscription were already active.

**How to apply:** Preserve the custom live-key implementation for checkout, billing status, and webhooks. If Publishing reports a Stripe sandbox connection, remove the installed Stripe integration rather than replacing the live credentials.