---
name: Local-first task saves
description: The planner’s task mutations should feel immediate while preserving Google Sheets synchronization and retry behavior.
---

Task creation, edits, and completion should update the account-scoped local fieldbook first and let the Google Sheets mutation run in the background. Keep pending and retry state visible so an immediate UI response does not imply that the remote write has already completed. Flows that need a server-created task record, such as attachment uploads, must wait for the queued create to finish before uploading.

**Why:** Google Sheets writes are deliberately paced and can take seconds on a phone; waiting for them makes routine task work feel broken. Removing the queue wait without handling attachment ordering would create uploads for tasks that do not exist remotely yet.

**How to apply:** Preserve optimistic rollback/conflict handling, stable client task IDs, and account scoping. Defer secondary refreshes such as the daily plan until the background mutation settles.