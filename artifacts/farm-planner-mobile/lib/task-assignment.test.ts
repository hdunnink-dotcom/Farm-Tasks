import { describe, expect, it } from 'vitest';
import type { FarmTask, TaskInput } from '@workspace/api-client-react';
import { taskAssignedTo, taskAssigneeIds, taskAssigneeNames, withTeamAssignment } from './task-assignment';

describe('mobile task team assignments', () => {
  it('prefers team arrays and retains legacy fallback', () => {
    const team = { assigneeIds: ['tom', 'jason'], assigneeNames: ['Tom', 'Jason'], assigneeId: 'tom', assigneeName: 'Tom' } as FarmTask;
    expect(taskAssigneeIds(team)).toEqual(['tom', 'jason']);
    expect(taskAssigneeNames(team)).toEqual(['Tom', 'Jason']);
    expect(taskAssignedTo(team, 'jason')).toBe(true);
    expect(taskAssigneeIds({ assigneeId: 'legacy' } as FarmTask)).toEqual(['legacy']);
    expect(taskAssigneeIds({ ...team, assigneeIds: [], assigneeId: 'legacy' })).toEqual(['legacy']);
  });

  it('constructs array and legacy assignment fields together for offline compatibility', () => {
    const input = withTeamAssignment(
      { task: 'Prune trees' } as TaskInput,
      ['tom', 'jason'],
      ['Tom', 'Jason'],
    ) as TaskInput & { assigneeIds: string[]; assigneeNames: string[] };
    expect(input).toMatchObject({
      assigneeIds: ['tom', 'jason'],
      assigneeNames: ['Tom', 'Jason'],
      assigneeId: 'tom',
      assigneeName: 'Tom',
    });
  });
});