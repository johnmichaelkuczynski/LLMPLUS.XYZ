---
name: Source-claim testing
description: Avoid false passes and false failures when checking factual recall and corrections.
---

Test the claim being made, not merely the presence of a keyword or year. Inspect the exact returned answer when an expectation fails.

**Why:** A completed-period check falsely accepted an answer that called completion unknown. Date checks also falsely rejected correct answers quoting an earlier invented date specifically to retract it.

**How to apply:** Require acknowledgement of the sourced update, distinguish reported developments from independent verification, and allow explicit retractions or qualified unknowns. Preserve exact tested answers alongside results. Do not report a provider block when the provider answered and only the test's wording expectation failed.
