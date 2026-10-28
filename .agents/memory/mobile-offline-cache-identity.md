---
name: Client offline cache identity
description: Authorization boundary for persisted and in-memory web/mobile task caches
---

Web and mobile fieldbook, query, and daily-plan caches must be keyed by the active Clerk user ID and remain unavailable until `/api/me` confirms that exact identity. During sign-out or account changes, render no retained task, plan, detail, or conflict content.

**Why:** Server-side worker scoping does not protect locally persisted or in-memory owner data. Reusing an unverified member response or retaining query state for one render can disclose owner task titles to the next signed-in worker.

**How to apply:** Key member queries by the current auth identity, verify the returned member ID matches it, scope every downstream query and storage key by that ID, track which scope each hook actually hydrated, and fail closed until all scopes match.