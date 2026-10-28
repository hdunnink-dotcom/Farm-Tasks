---
name: Pnpm root overrides
description: Where to place dependency-resolution security overrides in this workspace.
---

Put workspace-wide security resolution overrides in the root package manifest's `pnpm.overrides` block.

**Why:** The root manifest is the authoritative source reflected in the lockfile; equivalent entries in the workspace configuration did not update the resolved package graph while a root override block existed.

**How to apply:** For a transitive vulnerability, target the narrowest compatible parent path in the root overrides, regenerate the lockfile, and confirm the vulnerable package is absent from the audit output.