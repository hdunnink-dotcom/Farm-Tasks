---
name: A4 print layout
description: Durable layout constraints for the farm planner's browser print sheets.
---

The planner's print sheets target A4 portrait and should remain in normal document flow. The interactive planner layout must be removed from print flow, while the print sheet remains visible; otherwise hidden navigation/content can create trailing blank pages. That includes the phone top bar, the phone menu bar and the page's bottom padding: A4 is narrower than the desktop breakpoint, so the phone layout applies in print.

Week prints (Weekly route "Print route" and All tasks "Print" > Week) share `RoutePrintSheet`: a "Week at a glance" table (one row per job per day, time order, empty days folded into one line, numbered references) followed by each job's instructions once, in two columns. Notes are parsed by `lib/print-notes.ts` into headings, lists, steps, a boxed DO NOT section, a quieter WHY section and RECORD lines, which print as a write-in strip (litres, batch, weather, initials). Done work is left off the paper. The month to-do (Monthly overview "Print to-do", and All tasks "Print" > Month) uses the same sheet as an overview only, without instruction pages; for the current month, work still open from days already gone is gathered under Overdue with its due date, and only today onward is listed by day.

**Why:** The owner chose this compact layout (about 9 pt overview, 8 pt instructions, black text) over larger type in November 2026: a week's spray instructions went from 5 pages to 2. Browser print pagination treats visibility-hidden content as layout content.

**How to apply:** Use A4 portrait `@page` rules, static print-sheet positioning, print-only display isolation, `break-inside: avoid` for headers, warnings and record strips, and print with `print-color-adjust: exact` where a filled label carries meaning (Urgent). Check a change by printing a real week to PDF in a browser set to Pacific/Auckland time.
