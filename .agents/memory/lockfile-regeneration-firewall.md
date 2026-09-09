---
name: Lockfile regeneration firewall
description: How to handle npm lockfile metadata when an optional artifact is unavailable through the package firewall.
---

If npm has already produced and audited a safe resolved graph, but a later package-lock-only regeneration fails because an optional platform artifact is unavailable through the package firewall, do not force a major upgrade or discard the safe graph. Synchronize only the root manifest metadata in the lockfile, then verify every resolved package version and run a fresh audit.

**Why:** npm can attempt to fetch optional cross-platform artifacts even with omit-optional, so metadata-only regeneration may fail for reasons unrelated to the installed dependency graph.

**How to apply:** Confirm the failure names an optional platform artifact, verify manifest/lock root declarations match, inspect resolved package versions programmatically, and require a zero-finding audit plus successful build/runtime checks.