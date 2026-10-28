# Team planner overview preview

This sandbox is a decision preview only. It does not replace the existing
30-day planner or change task authorization, assignment rules, or storage.

## Preview

- Live component: `src/components/mockups/TeamPlannerOverview.tsx`
- Preview path: `/__mockup/preview/TeamPlannerOverview`
- Desktop and phone treatments are shown together for each direction.
- The initial selection is the recommended **selected-day crew board**.

## Directions

1. **Worker-by-day roster** — best for the start-of-day huddle and spotting
   workload gaps by person.
2. **Selected-day crew board** — best for field dispatch because a manager can
   scan the chosen day by worker, spot unassigned work, and open a task for
   move, assign, or edit actions without losing the day context.
3. **Compact week summary** — best for a quick weekly handoff; intentionally
   lighter on task detail.

## Access and sync checks represented

- Manager mode shows Mara, Jon, and Unassigned work.
- Worker mode shows only Mara's assigned work and removes teammate names,
  crew columns, and manager-only assignment actions.
- Task cards expose priority, date/time, location, open/overdue/unassigned/
  completed state, local pending/offline copy, and explicit conflict/failed
  sync recovery copy.
- The small completion control saves locally in the preview; opening the task
  exposes the detail/action surface.

## Integration boundary after approval

The approved direction should be integrated into the responsive web surface in
`artifacts/farm-planner-web/src/components/mobile-crew-agenda.tsx`, called from
`artifacts/farm-planner-web/src/pages/crew-plan.tsx` at the `/crew-plan` route.
The desktop 30-day board in `crew-plan.tsx` remains the desktop planning
surface; this preview is specifically for the responsive manager overview.

The production follow-up must preserve the existing API and offline contracts:
`useOfflineFieldbook` remains the source of local task state and sync status,
and worker isolation must continue to be enforced by the API rather than by
the presentation filter alone. Existing full-editor and move/assign handlers
should be wired into the approved task detail surface rather than replaced by
preview notices.