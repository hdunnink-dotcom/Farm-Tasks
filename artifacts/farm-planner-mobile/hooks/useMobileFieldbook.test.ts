// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { storage } = vi.hoisted(() => ({ storage: new Map<string, string>() }));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { storage.set(key, value); }),
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  createFarmTask: vi.fn(),
  listFarmTasks: vi.fn(),
  updateFarmTask: vi.fn(),
}));

import {
  defaultMobileTaskViewPreferences,
  normalizeMobileTaskViewPreferences,
  readMobileTaskViewPreferences,
  useMobileTaskViewPreferences,
  useMobileFieldbook,
  writeMobileTaskViewPreferences,
} from './useMobileFieldbook';
import { listFarmTasks, type FarmTask } from '@workspace/api-client-react';

beforeEach(() => {
  storage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

const task = {
  id: 'task-shared',
  task: 'Inspect the north orchard',
  group: 'Orchards',
  done: false,
  urgency: 'Medium',
  month: '',
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
  sourceUrl: '',
  calendarEventId: '',
  calendarRecurringEventId: '',
  calendarStart: '',
  scheduledDates: [],
  recurrence: 'none',
  calendarUpdated: '',
  updatedAt: '2026-09-02T08:00:00.000Z',
  assigneeId: '',
  assigneeName: '',
  assigneeIds: [],
  assigneeNames: [],
  repeatWeekly: false,
} as FarmTask;

describe('mobile task view preferences', () => {
  it('persists calendar, period, filters, and sort separately for each account', async () => {
    const ownerPreferences = {
      ...defaultMobileTaskViewPreferences(),
      view: 'All' as const,
      calendarScope: 'week' as const,
      weekFilter: 'unscheduled' as const,
      weekStart: '2026-09-07',
      sort: 'title' as const,
    };
    const workerPreferences = {
      ...defaultMobileTaskViewPreferences(),
      monthFilter: '2026-10',
      sort: 'updated' as const,
    };

    await writeMobileTaskViewPreferences('owner-a', ownerPreferences);
    await writeMobileTaskViewPreferences('worker-b', workerPreferences);

    expect(await readMobileTaskViewPreferences('owner-a')).toEqual(ownerPreferences);
    expect(await readMobileTaskViewPreferences('worker-b')).toEqual(workerPreferences);
  });

  it('restores selections through the task view hook after returning to the screen', async () => {
    const savedPreferences = {
      ...defaultMobileTaskViewPreferences(),
      view: 'Done' as const,
      calendarScope: 'week' as const,
      monthFilter: '2026-10',
      weekFilter: 'unscheduled' as const,
      weekStart: '2026-09-07',
    };
    await writeMobileTaskViewPreferences('owner-a', savedPreferences);

    const { result } = renderHook(() => useMobileTaskViewPreferences('owner-a'));

    await waitFor(() => expect(result.current.readyForScope).toBe(true));

    expect(result.current.preferences).toEqual(savedPreferences);
  });

  it('falls back safely for invalid or obsolete saved values', () => {
    expect(normalizeMobileTaskViewPreferences({
      view: 'Archived',
      calendarScope: 'quarter',
      monthFilter: '2026-99',
      weekFilter: 'fortnight',
      weekStart: '2026-02-31',
      sort: 'magic',
    })).toEqual(defaultMobileTaskViewPreferences());
  });
});


describe('mobile fieldbook task hydration', () => {
  it('reuses the successful home task response without fetching tasks again', async () => {
    const { result } = renderHook(() => useMobileFieldbook('owner-a', [task], true));

    await waitFor(() => expect(result.current.tasks).toEqual([task]));

    expect(result.current.readyForScope).toBe(true);
    expect(listFarmTasks).not.toHaveBeenCalled();
  });

  it('falls back to its authenticated refresh when the shared task query fails', async () => {
    vi.mocked(listFarmTasks).mockResolvedValue({ tasks: [task], source: 'Google Sheets', sourceUrl: '' });
    const { result } = renderHook(() => useMobileFieldbook('owner-a', undefined, true));

    await waitFor(() => expect(result.current.tasks).toEqual([task]));

    expect(result.current.readyForScope).toBe(true);
    expect(listFarmTasks).toHaveBeenCalledTimes(1);
    expect(listFarmTasks).toHaveBeenCalledWith({ includeDone: true });
  });

  it('keeps the fieldbook unavailable until an account is verified', async () => {
    const { result } = renderHook(() => useMobileFieldbook(null, [task], true));

    await waitFor(() => expect(result.current.readyForScope).toBe(false));

    expect(result.current.tasks).toEqual([]);
    expect(listFarmTasks).not.toHaveBeenCalled();
  });

  it('does not hydrate a cached fieldbook from another account', async () => {
    storage.set('farm-planner-mobile-fieldbook:owner-a', JSON.stringify({
      tasks: [task],
      updates: [],
      conflicts: [],
    }));
    const { result } = renderHook(() => useMobileFieldbook('worker-b', undefined, false));

    await waitFor(() => expect(result.current.readyForScope).toBe(true));

    expect(result.current.tasks).toEqual([]);
    expect(listFarmTasks).not.toHaveBeenCalled();
  });
});