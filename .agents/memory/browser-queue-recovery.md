---
name: Browser queue recovery
description: Durable constraints for recovering account-scoped browser mutations after mobile tab suspension or temporary server failures.
---

Queued browser mutations need their own wake-up schedule. The browser `online` event only describes network connectivity and may not fire when a request receives a transient server error, so a queue can remain local forever without a timer keyed to its next retry time.

**Why:** Mobile Chrome commonly suspends and resumes tabs, while a healthy connection can still return 408, 429, 5xx, or an unavailable sheet response. Permanent failures must remain visible and must not be replayed automatically.

**How to apply:** Schedule the earliest non-permanent mutation retry while the account-scoped fieldbook is hydrated, force a retry when the document becomes visible again, coalesce overlapping sync requests, and keep explicit user retry as the path for permanent failures.

Browser-level visibility tests in this workspace should dispatch `visibilitychange` with an explicit hidden/visible state when running headless Chrome; opening a second page alone does not reliably change `document.visibilityState`.

**Why:** The available headless Chromium can keep both pages visible, which otherwise leaves foreground-retry coverage untested or flaky.

**How to apply:** Keep a second tab in the test to model the backgrounded tab, but use a controlled visibility transition before asserting queued work flushes on restore.

Authentication failures are a separate permanent-until-renewed state: persist an auth-required marker on every queued mutation, pause automatic retries, and restore the visible renewal prompt from storage after reload.

**Why:** A backgrounded Clerk session can expire while local fieldbook edits remain valid; treating a 401 like a network outage causes retry storms or hides work that still needs to reach the connected sheet.

**How to apply:** Classify 401 responses before temporary-failure backoff, keep the optimistic task and mutation intact, renew Clerk access explicitly, then replay the queue and clear the marker only when the queue reaches the fieldbook.

Temporary and permanent failures should block only later mutations for the same task during a replay run; unrelated tasks should continue. When a create or update succeeds, rebase later same-task mutations on the returned server timestamp before sending them.

**Why:** Stopping the whole queue behind one bad request strands otherwise valid field work, while replaying later edits to the same task without rebasing creates self-inflicted conflicts.

**How to apply:** Preserve queue order per task, refresh each mutation from the latest persisted state before sending it, and normalize legacy queued payloads before retrying schema failures caused by obsolete client values.