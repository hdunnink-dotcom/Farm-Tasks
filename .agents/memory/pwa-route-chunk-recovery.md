---
name: PWA route chunk recovery
description: Service-worker and lazy-import constraints for route loading in the installed web shortcut.
---

The service worker may use the cached HTML app shell only for document navigations. Failed JavaScript, CSS, and other asset requests must remain asset failures; returning index.html makes the browser parse HTML as a module and surfaces a misleading route-level error.

**Why:** A deployed PWA can briefly combine a cached document with a newer or unavailable lazy-loaded route chunk. Without this boundary, navigating between pages can show the generic error screen until the user manually restarts the app.

**How to apply:** Keep the service worker network-first for same-origin assets, restrict the app-shell fallback to navigation requests, and let page-level lazy imports perform at most one guarded reload before preserving the original error.