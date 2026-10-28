---
name: Calendar throttle coordination
description: Cross-instance coordination and transient authorization recovery for Google calendar and sheet requests
---

Use short-lived PostgreSQL advisory leases keyed by a one-way digest of the calendar request path to coordinate Google Calendar reads across API instances. Keep process-local request coalescing and cooldowns as the fast path, and hold the shared lease briefly after an exhausted provider throttle.

**Why:** The API may run more than one worker, while calendar provider throttles apply across the connected account. A database-backed lease prevents workers from independently repeating the same request without adding calendar payloads or connector credentials to durable storage.

**How to apply:** Keep the lease non-blocking so competing workers fail with the existing actionable rate-limit error; let PostgreSQL release it automatically on connection loss, and bound any cooldown-held connection to the existing short cooldown window.

Treat an isolated connector 401 as potentially transient even when the OAuth connection is still healthy: allow one short retry, but never loop on a persistent authorization failure. After a scheduled sync failure, retry sooner than the normal cadence and log both failures and successful sync counts.

**Why:** Production returned bursts of Google Sheets 401 responses while direct Calendar and Sheets API checks still succeeded with the same added connections. The next successful calendar sync reconciled stale rows without reauthorization.

**How to apply:** Use a single bounded retry for 401 responses, preserve normal error reporting after the second failure, and distinguish sparse source data from failed imports using per-sync counts and source coverage.