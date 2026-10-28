import type { FarmTask, TaskInput } from '@workspace/api-client-react';

type TeamAssignment = {
  assigneeIds?: string[];
  assigneeNames?: string[];
  assigneeId?: string;
  assigneeName?: string;
};

export function taskAssigneeIds(task: FarmTask | TaskInput): string[] {
  const assignment = task as TeamAssignment;
  if (Array.isArray(assignment.assigneeIds) && assignment.assigneeIds.length) {
    return [...new Set(assignment.assigneeIds.filter(Boolean))];
  }
  return assignment.assigneeId ? [assignment.assigneeId] : [];
}

export function taskAssigneeNames(task: FarmTask | TaskInput): string[] {
  const assignment = task as TeamAssignment;
  if (Array.isArray(assignment.assigneeNames) && assignment.assigneeNames.length) {
    return [...new Set(assignment.assigneeNames.filter(Boolean))];
  }
  return assignment.assigneeName ? [assignment.assigneeName] : [];
}

export function taskAssignedTo(task: FarmTask, clerkId: string): boolean {
  return taskAssigneeIds(task).includes(clerkId);
}

export function withTeamAssignment<T extends TaskInput>(
  task: T,
  assigneeIds: string[],
  assigneeNames: string[],
): T {
  const ids = [...new Set(assigneeIds.filter(Boolean))];
  const names = ids.map((_, index) => assigneeNames[index] ?? '').filter(Boolean);
  return {
    ...task,
    assigneeIds: ids,
    assigneeNames: names,
    assigneeId: ids[0] ?? '',
    assigneeName: names[0] ?? '',
  } as T;
}