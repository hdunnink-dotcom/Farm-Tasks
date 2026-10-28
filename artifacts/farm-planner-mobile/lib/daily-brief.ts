import type { DailyPlan, FarmTask } from '@workspace/api-client-react';
import { taskAssignedTo } from './task-assignment';

export type ResolvedDailyPlanGroup = {
  name: string;
  tasks: FarmTask[];
  openCount: number;
};

export function resolveDailyPlan(
  plan: DailyPlan | undefined,
  tasks: FarmTask[],
  member?: { id: string; isOwner: boolean },
): ResolvedDailyPlanGroup[] {
  if (!plan || !member) return [];
  const visibleTasks = member.isOwner ? tasks : tasks.filter((task) => taskAssignedTo(task, member.id));
  const tasksById = new Map(visibleTasks.map((task) => [task.id, task]));
  return plan.groups.flatMap((group) => {
    const resolved = group.items
      .map((item) => tasksById.get(item.taskId))
      .filter((task): task is FarmTask => Boolean(task));
    return resolved.length
      ? [{ name: group.name, tasks: resolved, openCount: resolved.filter((task) => !task.done).length }]
      : [];
  });
}

export function selectDailyBriefState(input: {
  loading: boolean;
  hasCachedPlan: boolean;
  hasError: boolean;
  groups: ResolvedDailyPlanGroup[];
}): 'loading' | 'ready' | 'fallback' | 'empty' {
  if (input.loading && !input.hasCachedPlan) return 'loading';
  if (input.hasError && input.hasCachedPlan) return 'fallback';
  if (input.groups.length) return 'ready';
  return 'empty';
}

export function isDailyPlanCurrent(plan: DailyPlan, now = new Date()): boolean {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: plan.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return plan.planDate === `${values.year}-${values.month}-${values.day}`;
  } catch {
    return false;
  }
}