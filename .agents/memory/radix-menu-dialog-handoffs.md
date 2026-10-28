---
name: Radix menu-to-dialog handoffs
description: Close a modal dropdown before opening a sibling modal dialog to preserve focus and accessibility.
---

When a Radix dropdown item opens a dialog, let the dropdown close normally and then open the controlled dialog. Preventing the menu’s default close can leave both modal layers active and hide the dialog from accessibility queries.

**Why:** Nested modal primitives compete over focus and `aria-hidden` management when the menu remains open, so the dialog can appear visually but be inaccessible or unusable.

**How to apply:** Keep the dialog root outside the dropdown content, open it from the item’s `onSelect`, and avoid `preventDefault()` unless the menu is intentionally staying open.