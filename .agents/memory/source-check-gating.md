---
name: Source-check gating
description: The model-based source verifier must not block ordinary chat responses.
---

**Rule:** Do not reintroduce a post-generation source-check gate that replaces normal assistant output with a generic “SOURCE CHECK FAILED” response.

**Why:** The verifier confused ordinary conversation and valid answers with unsupported document claims, withholding even basic availability checks and making the app appear nonfunctional.

**How to apply:** Keep document grounding in retrieval and prompt construction. Test document use through explicit behavioral diagnostics, audits, or warnings that do not suppress unrelated chat output.