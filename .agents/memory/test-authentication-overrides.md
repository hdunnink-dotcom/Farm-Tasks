---
name: Test authentication overrides
description: Prevent browser-test setup from leaving the development API in an unsafe authentication mode.
---

When a browser test temporarily disables farm authentication, verify that the corresponding environment variable is absent after the test, restart the API, and confirm an unsigned request is rejected.

**Why:** Test workflow overrides can persist as shared environment variables, causing later API restarts to treat every visitor as the test owner.

**How to apply:** After any auth-bypass test setup, inspect only the relevant non-secret flag, remove it if test-created, restart the affected service, and check the protected identity endpoint returns its normal unauthenticated response.