---
name: Worker access
description: Farm task access uses Clerk identity for membership and keeps assignment metadata backward-compatible in Google Sheets.
---

The farm owner is the master account; approved worker membership is stored in PostgreSQL, while task assignment remains in Google Sheets so legacy rows continue to work. Blank assignment means master-only visibility.

**Why:** Sheets is the task source of truth, but it is not a safe authorization boundary for private worker data.

**How to apply:** Enforce role and assignment checks in API handlers, attachment routes, and server-generated aggregates or snapshots; scope every task title and ID before serialization. Do not rely on client-side filtering.

Privileged farm settings and review actions use an exact configured Clerk user ID, not a display name or broad master role; missing configuration must deny access.

**Why:** A human-readable name is not a stable identity and allowing a fallback would let an unintended master account change shared farm behavior.

**How to apply:** Keep `FARM_MASTER_CLERK_USER_ID` configured outside source control for the intended owner in each environment, and test the missing-ID path as denied.

Client membership queries and any dependent offline state must be keyed by the current Clerk user ID, and signed-in users without approved membership must see an explicit recovery screen rather than entering the planner.

**Why:** A shared membership cache can leak the previous account's access state during account changes, while an unresolved invitation otherwise looks like a blank or indefinitely loading application.

**How to apply:** Gate planner routes on the account-scoped `/api/me` result; do not retry authorization failures automatically, and offer retry plus sign-out actions for unresolved invitations.