---
name: Cross-tab fieldbook state
description: How account-scoped planner state reaches sibling browser tabs when its durable store is IndexedDB.
---

IndexedDB state changes do not notify sibling tabs by themselves. Publish a signal only after the persisted state write completes, then have other tabs rehydrate the same account scope without starting a second server sync. A browser `BroadcastChannel` can provide the fast path, while a same-origin `localStorage` pulse is a useful fallback.

**Why:** A failed delete is represented by a local tombstone plus failed mutation metadata. Re-reading that state in another tab removes the task from the board while preserving the recovery action; re-syncing or reconstructing from the server can reintroduce the deleted task.

**How to apply:** Keep notifications account-scoped, ignore the writer's own event, and make retry/discard handlers validate the current persisted mutation before acting so stale controls fail safely after another tab resolves the mutation.