---
name: Manager role compatibility
description: How canonical manager access coexists with legacy master membership records.
---

Use `manager` for newly granted full-access memberships, while continuing to recognize the configured legacy `master` owner record. Workers remain task-only and can submit supervised drafts but cannot approve or sync them.

**Why:** Existing owner data and deployments already use `master`; replacing it destructively could lock out the owner, while treating every historical `master` row as an owner could accidentally broaden access.

**How to apply:** New team invitations should choose `manager` or `worker`. Privileged server routes must use the centralized manager rule, and worker-facing pages must avoid mounting manager-only data queries.