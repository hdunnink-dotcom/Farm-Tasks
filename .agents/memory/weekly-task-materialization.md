---
name: Recurring task materialization
description: Why recurring routines are stored as completed and future Google Sheet rows instead of generated dynamically.
---

Recurring routines advance only when an occurrence is completed. Keep the completed row as history and create exactly one next-occurrence row with a deterministic identity; never generate recurrence rows during list reads. Calendar-month and calendar-year intervals clamp to the last valid day rather than accumulating fixed day counts.

**Why:** Google Sheets is the task source of truth, and workers must see stable assignments and completion history across offline retries. Read-time synthesis would create inconsistent identities and make retries hard to reconcile.

**How to apply:** Preserve deterministic occurrence identities, assignment fields, Auckland wall-clock time across DST, calendar month-end/leap-day clamping, and recovery when completion succeeds before next-occurrence creation.