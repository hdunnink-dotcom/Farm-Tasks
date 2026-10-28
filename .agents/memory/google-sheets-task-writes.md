---
name: Google Sheets task writes
description: Why task creation uses explicit row writes instead of the Google Sheets append endpoint.
---

Write task records to an explicitly calculated row in the canonical A:W table under one distributed creation lock. Do not use the Sheets values append endpoint for this workbook.

**Why:** Google Sheets table detection selected a neighboring formatted region and shifted accepted task writes into S:AO. The API reported success, but the task reader could not see the records; repeated calendar syncs then accumulated duplicate shifted copies.

**How to apply:** Any task producer—manual, mobile, calendar, or assistant approval—must use the shared explicit-row creation path. Pace and retry connector writes for Sheets quota responses, and deduplicate stable task IDs before creating rows.