---
name: Expo Metro watcher compatibility
description: Compatibility constraint between the secure Metro dependency pin and Expo SDK 54 CLI file watchers.
---

Keep the Metro 0.83.8 security pin, and retain the pnpm patch that updates Expo CLI 54.0.23 and 54.0.27 file watchers to consume Metro’s `changes` collections instead of the legacy `eventsQueue`.

**Why:** The newer Metro release removes a vulnerable transitive dependency but changes the watcher event shape. Expo SDK 54’s bundled and direct CLI copies both otherwise crash during file changes, including static mobile build output.

**How to apply:** When changing Expo, Metro, or pnpm patch configuration, test both the static mobile build and the live mobile preview after a file change. Remove the patch only after the installed Expo CLI natively uses the current Metro watcher format.