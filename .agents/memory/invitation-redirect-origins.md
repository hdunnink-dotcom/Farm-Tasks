---
name: Invitation redirect origins
description: Why Clerk invitation redirect URLs must not be built from the API request host.
---

Clerk invitation redirect URLs must use the deployment's canonical public origin, not the API request's host or protocol.

**Why:** Replit's path router can forward the API request with an internal host or non-public scheme. Clerk may accept ordinary proxied client traffic while rejecting ticket acceptance when the invitation points at that internal or mismatched origin.

**How to apply:** Use the shared canonical-origin resolver for every worker invitation create and resend path. Keep the sign-up path base-relative to the public web artifact, and never log the ticket or full invitation URL while diagnosing failures.