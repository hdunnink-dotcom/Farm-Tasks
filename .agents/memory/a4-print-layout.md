---
name: A4 print layout
description: Durable layout constraints for the farm planner's browser print sheets.
---

The planner's print sheets target A4 portrait and should remain in normal document flow. The interactive planner layout must be removed from print flow, while the print sheet remains visible; otherwise hidden navigation/content can create trailing blank pages. Task notes must stay separate from metadata and use preserved whitespace so paragraphs, line breaks, indentation, and user-entered bullet characters remain readable. Structured steps belong in an explicit list.

**Why:** Browser print pagination treats visibility-hidden content as layout content, and flattening notes into a metadata line loses the order and spacing needed on a paper field route.

**How to apply:** Use A4 portrait `@page` rules, static print-sheet positioning, print-only display isolation, `break-inside: avoid` for task/group blocks, readable 10pt-or-larger body text, and render only populated route groups plus a meaningful empty-state message.