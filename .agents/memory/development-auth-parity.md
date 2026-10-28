---
name: Development auth parity
description: The mobile/web client auth mode must match the API auth mode during local preview.
---

Keep client-side auth-disable flags aligned with the API's authentication mode. A client configured for no-auth while the API still requires Clerk produces a burst of 401 requests and a loading state that can be mistaken for a slow or broken startup.

**Why:** Preview checks exposed that configuration mismatch as repeated unauthenticated task, plan, and account requests before the app could show a useful state.

**How to apply:** When changing preview auth settings, check the client and server flags together, then restart the affected workflows and verify both the signed-out screen and an authenticated request path. For web resume flows, keep Clerk cookie auth, leave session touching enabled, and allow the initial account check to retry a transient 401 after Clerk renews an idle session.