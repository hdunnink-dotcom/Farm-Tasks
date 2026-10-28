---
name: Task query coalescing
description: The web and mobile planners have several views that consume the same authenticated task feed.
---

Use one account-scoped task data path with shared in-flight refreshes and a finite freshness window. Individual views should consume that state rather than each starting their own initial network sync. Manual refreshes and mutation delivery must bypass the freshness window.

**Why:** Restoring a Clerk session or moving between planner views can mount consumers close together. Separate view-level queries and fieldbook fetches turn one task refresh into duplicate Google Sheets requests and make weak connections feel slower.

**How to apply:** When adding a planner view that reads tasks, use the shared account-scoped offline/task source. Coalesce concurrent reads, skip recently completed automatic reads, and force explicit refreshes and queued writes.