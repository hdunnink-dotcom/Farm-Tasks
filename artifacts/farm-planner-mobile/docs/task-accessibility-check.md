# Mobile task selection accessibility check

This is a device-level smoke check for the native selection announcements on the
Tasks screen. Run it on a physical iOS or Android device because the browser
preview cannot verify VoiceOver or TalkBack announcements.

## Before you start

1. Start the `artifacts/farm-planner-mobile` Expo workflow.
2. Open **Preview on your phone** in Replit and scan the QR code with Expo Go.
3. Sign in to an account with at least one task.
4. Turn on the platform screen reader:
   - **iOS:** Settings → Accessibility → VoiceOver, then use the VoiceOver
     rotor or swipe right to move between controls.
   - **Android:** Settings → Accessibility → TalkBack, then swipe right to
     move between controls.

## Selection and announcement check

On the **Tasks** tab, move focus to each control and activate it. The exact
wording can vary by OS and screen-reader version, but every control must be
identified by its label and its selected/not-selected state.

| Area | Control to activate | Expected accessible label |
| --- | --- | --- |
| Task view | Open | “Open work tasks” |
| Task view | Everything | “Everything tasks” |
| Task view | Completed | “Completed tasks” |
| Calendar scope | Month | “Show tasks by month” |
| Calendar scope | Week | “Show tasks by week” |
| Month filter | Unscheduled | “Filter by Unscheduled” |
| Week filter | Unscheduled | “Filter unscheduled tasks” |

Verify all of the following:

- The active task-view control is announced as selected; activating
  Everything and Completed moves the selected state to that control, and
  activating Open moves it back.
- Month and Week expose one selected calendar scope at a time.
- In Month mode, activate **Unscheduled** and confirm it is announced selected.
- In Week mode, activate **Unscheduled** and confirm it is announced selected;
  activating **Scheduled this week** moves the selected state to its peer.
- The task list changes as it normally does after each choice. This check is
  only verifying the control announcement and selected state, not changing
  filtering behavior.

## Restored selection check

1. Select **Week**, **Unscheduled**, and **Completed**.
2. Leave the Tasks tab by opening another tab.
3. Return to **Tasks** and wait for the task list to finish loading.
4. Move screen-reader focus through the same controls again.
5. Confirm that Week, Unscheduled, and Completed are still announced selected,
   while their peer controls are announced not selected.
6. Optional stronger check: fully close and relaunch Expo Go, return to the
   same account, and repeat step 5. The selections should remain account-scoped
   and unchanged.

## Result

Record the device, OS version, screen reader, and pass/fail result with the
release check. If a selected state is not announced, capture the focused
control's label and OS version before changing the accessibility props.

The controls are covered by stable test IDs in
`app/(tabs)/tasks.tsx`: `task-view-open`, `task-view-all`,
`task-view-done`, `calendar-scope-month`, `calendar-scope-week`,
`month-filter-unscheduled`, and `week-filter-unscheduled`.