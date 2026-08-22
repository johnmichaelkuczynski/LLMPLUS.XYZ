---
name: UI modal stacking
description: Dynamic modals opened from the artifact panel need a higher stacking level than the panel.
---

**Rule:** Dynamic modals opened from artifact-panel content need z-index at least 1200.

**Why:** The artifact panel uses z-index 1000; lower modals appear present but the panel intercepts their clicks.

**How to apply:** Check modal stacking whenever a panel action opens a dialog. Playwright surfaces failures as element-intercepts-pointer-events.