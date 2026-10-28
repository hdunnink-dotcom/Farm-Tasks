---
name: Route smoke testing
description: Constraints for responsive authenticated route smoke tests in the web planner.
---

Route smoke tests in jsdom can verify responsive markup and interaction affordances, but Tailwind media-query visibility is not computed; assert the rendered responsive guidance and scroll containers rather than computed display. Radix dropdown triggers may require pointerDown followed by click to open reliably.

**Why:** The test environment renders the real route and dialogs but does not run a layout engine, while Radix models the browser's pointer lifecycle more closely than a bare click.

**How to apply:** Keep viewport assertions semantic and scope repeated grid controls to their worker row; use the pointer sequence for task option menus.