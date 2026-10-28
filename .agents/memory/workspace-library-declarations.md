---
name: Workspace library declarations
description: Workspace app typechecks can read ignored declaration output that lags tracked library source.
---

Refresh workspace library declarations before diagnosing an app typecheck error that says a recently added source export is missing.

**Why:** The API client package exposes tracked TypeScript source through project references, while its ignored `dist` declarations can remain stale after a source-only change.

**How to apply:** Run the workspace library typecheck/build first, then rerun the affected artifact typecheck before changing application code or generated output.