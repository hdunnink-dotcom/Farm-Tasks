import { describe, expect, it } from 'vitest';
import type { DailyPlan, FarmTask } from '@workspace/api-client-react';
import { isDailyPlanCurrent, resolveDailyPlan, selectDailyBriefState } from './daily-brief';
import { createScopeSerializer, reconcileServerTasks } from './mobile-fieldbook';

const task = (id: string, assigneeId = 'worker-1', done = false): FarmTask => ({
  id,
  task: `Task ${id}`,
  group: 'Orchards',
  done,
  urgency: 'Medium',
  month: '2026-08',
  location: '',
  latitude: null,
  longitude: null,
  locationCapturedAt: null,
  atlasLink: '',
  notes: '',
  link: '',
  subtasks: [],
  attachments: [],
  source: 'Manual',
  calendarEventId: '',
  calendarRecurringEventId: '',
  calendarStart: '',
  scheduledDates: [],
  calendarUpdated: '',
  updatedAt: '2026-08-28T08:00:00.000Z',
  assigneeId,
  assigneeName: assigneeId,
  assigneeIds: assigneeId ? [assigneeId] : [],
  assigneeNames: assigneeId ? [assigneeId] : [],
});

const plan = (taskIds: string[], generatedBy: DailyPlan['generatedBy'] = 'claude'): DailyPlan => ({
  id: 1,
  planDate: '2026-08-28',
  timezone: 'Pacific/Auckland',
  status: 'ready',
  groups: [{
    name: 'Orchards',
    items: taskIds.map((taskId, rank) => ({
      taskId,
      title: `Task ${taskId}`,
      category: 'Orchards',
      urgency: 'Medium',
      month: '2026-08',
      reason: 'today',
      rank,
    })),
  }],
  taskCount: taskIds.length,
  generatedBy,
  error: '',
  startedAt: '2026-08-28T07:59:00.000Z',
  generatedAt: '2026-08-28T08:00:00.000Z',
  updatedAt: '2026-08-28T08:00:00.000Z',
});
const owner = { id: 'owner-1', isOwner: true };

describe('mobile daily brief', () => {
  it('resolves ready plans by real task ID and counts open work', () => {
    const groups = resolveDailyPlan(plan(['real-1', 'real-2']), [task('real-1'), task('real-2', 'worker-1', true)], owner);
    expect(groups).toHaveLength(1);
    expect(groups[0].tasks.map((item) => item.id)).toEqual(['real-1', 'real-2']);
    expect(groups[0].openCount).toBe(1);
    expect(selectDailyBriefState({ loading: false, hasCachedPlan: true, hasError: false, groups })).toBe('ready');
  });

  it('ignores unresolved IDs rather than matching by title', () => {
    const groups = resolveDailyPlan(plan(['missing-id']), [task('real-id')], owner);
    expect(groups).toEqual([]);
  });

  it('shows the cached brief as fallback while offline', () => {
    const groups = resolveDailyPlan(plan(['real-1'], 'deterministic'), [task('real-1')], owner);
    expect(selectDailyBriefState({ loading: false, hasCachedPlan: true, hasError: true, groups })).toBe('fallback');
  });

  it('rejects an offline plan from a previous local day', () => {
    expect(isDailyPlanCurrent(plan(['real-1']), new Date('2026-08-29T12:00:00.000Z'))).toBe(false);
  });

  it('preserves the worker-scoped task set supplied by the API', () => {
    const groups = resolveDailyPlan(
      plan(['worker-task', 'owner-task']),
      [task('worker-task', 'worker-1'), task('owner-task', 'owner-1')],
      { id: 'worker-1', isOwner: false },
    );
    expect(groups.flatMap((group) => group.tasks).map((item) => item.id)).toEqual(['worker-task']);
  });

  it('includes a worker assigned as any member of a task team', () => {
    const teamTask = {
      ...task('team-task', 'worker-1'),
      assigneeIds: ['worker-1', 'worker-2'],
      assigneeNames: ['Tom', 'Jason'],
    } as FarmTask;
    const groups = resolveDailyPlan(
      plan(['team-task']),
      [teamTask],
      { id: 'worker-2', isOwner: false },
    );
    expect(groups[0].tasks).toEqual([teamTask]);
  });

  it('fails closed before member identity is verified', () => {
    expect(resolveDailyPlan(plan(['owner-task']), [task('owner-task', 'owner-1')])).toEqual([]);
  });

  it('resolves newly approved remote work after background reconciliation', () => {
    const localTasks = [task('existing-task', 'owner-1')];
    const refreshedTasks = reconcileServerTasks(
      [...localTasks, task('approved-task', 'owner-1')],
      localTasks,
      new Set(),
    );
    const groups = resolveDailyPlan(
      plan(['existing-task', 'approved-task']),
      refreshedTasks,
      owner,
    );
    expect(groups[0].tasks.map((item) => item.id)).toEqual(['existing-task', 'approved-task']);
  });

  it('keeps pending offline edits while accepting unrelated remote tasks', () => {
    const pendingLocal = { ...task('pending-task', 'owner-1'), done: true };
    const reconciled = reconcileServerTasks(
      [task('pending-task', 'owner-1'), task('remote-task', 'owner-1')],
      [pendingLocal],
      new Set(['pending-task']),
    );
    expect(reconciled.find((item) => item.id === 'pending-task')?.done).toBe(true);
    expect(reconciled.some((item) => item.id === 'remote-task')).toBe(true);
  });

  it('serializes a completion behind an in-flight background sync', async () => {
    const serialize = createScopeSerializer();
    const events: string[] = [];
    let releaseSync: () => void = () => {};
    let markSyncStarted: () => void = () => {};
    const syncBarrier = new Promise<void>((resolve) => { releaseSync = () => resolve(); });
    const syncStarted = new Promise<void>((resolve) => { markSyncStarted = () => resolve(); });
    const sync = serialize('owner-1', async () => {
      events.push('sync-read');
      markSyncStarted();
      await syncBarrier;
      events.push('sync-write');
    });
    const completion = serialize('owner-1', async () => {
      events.push('completion-write');
    });
    await syncStarted;
    expect(events).toEqual(['sync-read']);
    releaseSync();
    await Promise.all([sync, completion]);
    expect(events).toEqual(['sync-read', 'sync-write', 'completion-write']);
  });
});