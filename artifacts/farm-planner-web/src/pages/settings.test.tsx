import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pageState = vi.hoisted(() => ({
  settings: {
    id: 1,
    groups: ['Orchards', 'Planting', 'Repair'],
    locations: ['North block', 'South block'],
    defaultGroup: 'Orchards',
    defaultUrgency: 'Medium' as const,
    defaultLocation: 'North block',
    updatedAt: '2026-08-30T00:00:00.000Z',
  },
  save: vi.fn(),
}));

vi.mock('@workspace/api-client-react', () => ({
  getGetFarmSettingsQueryKey: () => ['/api/farm-settings'],
  getGetOrchardCalendarSyncStatusQueryKey: () => ['/api/calendar-sync'],
  getListFarmTasksQueryKey: () => ['/api/tasks'],
  useListFarmTasks: () => ({ data: undefined, isFetching: false, isLoading: false, isError: false, refetch: vi.fn() }),
  useGetOrchardCalendarSyncStatus: () => ({ data: undefined, isFetching: false, isLoading: false, isError: false, refetch: vi.fn() }),
  useSyncOrchardCalendar: () => ({ mutate: vi.fn(), isPending: false }),
  useGetFarmSettings: () => ({ data: pageState.settings, isLoading: false, isFetching: false, refetch: vi.fn() }),
  useUpdateFarmSettings: () => ({ mutate: pageState.save, isPending: false }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ setQueryData: vi.fn(), invalidateQueries: vi.fn() }),
}));

vi.mock('@/components/farm-planner', () => ({
  ErrorState: () => null,
  PageHeader: () => null,
  PlannerShell: ({ children }: { children: React.ReactNode }) => children,
  SourcePill: () => null,
  SyncNotice: () => null,
}));

import { moveItem, OptionListEditor } from './settings';
import SettingsPage from './settings';

afterEach(cleanup);

beforeEach(() => {
  pageState.save.mockClear();
  vi.spyOn(global, 'fetch').mockImplementation(async (input) => ({
    ok: true,
    json: async () => String(input).includes('/api/me')
      ? { isManager: true, role: 'manager' }
      : [],
  } as Response));
});

function renderEditor(items = ['Orchards', 'Planting', 'Repair']) {
  const onReorder = vi.fn();
  render(
    <OptionListEditor
      label="Work groups"
      singularLabel="group"
      items={items}
      newValue=""
      onNewValueChange={vi.fn()}
      onAdd={vi.fn()}
      onChange={vi.fn()}
      onReorder={onReorder}
      onRemove={vi.fn()}
      preventLastRemoval
    />,
  );
  return onReorder;
}

describe('Farm Defaults ordering', () => {
  it('moves items without mutating the existing array', () => {
    const groups = ['Orchards', 'Planting', 'Repair'];

    expect(moveItem(groups, 2, 0)).toEqual(['Repair', 'Orchards', 'Planting']);
    expect(groups).toEqual(['Orchards', 'Planting', 'Repair']);
    expect(moveItem(groups, -1, 0)).toBe(groups);
    expect(moveItem(groups, 1, 1)).toBe(groups);
  });

  it('provides keyboard-friendly controls for independent list ordering', () => {
    const onReorder = renderEditor();

    expect(screen.getByRole('button', { name: 'Move Orchards up' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Move Orchards down' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Move Repair down' })).toHaveProperty('disabled', true);

    fireEvent.click(screen.getByRole('button', { name: 'Move Planting up' }));
    expect(onReorder).toHaveBeenCalledWith(1, 0);
  });

  it('exposes touch-safe drag handles and native drop targets', () => {
    renderEditor();

    const handle = screen.getByTestId('handle-group-1');
    expect(handle.getAttribute('draggable')).toBe('true');
    expect(handle.className).toContain('touch-none');
    expect(handle.getAttribute('aria-label')).toBe('Drag group Planting');
    expect(screen.getByTestId('input-group-2').closest('[data-option-index="2"]')).toBeTruthy();
  });

  it('reorders when a handle is dragged across rows with pointer events', () => {
    const onReorder = renderEditor();
    const target = screen.getByTestId('input-group-2');
    const elementFromPoint = vi.fn(() => target);
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: elementFromPoint });

    fireEvent.pointerDown(screen.getByTestId('handle-group-0'), { isPrimary: true, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 10, clientY: 100 });
    fireEvent.pointerUp(window, { clientX: 10, clientY: 100 });

    expect(onReorder).toHaveBeenCalledWith(0, 2);
  });

  it('keeps reordered groups and locations in the shared-options save payload', async () => {
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getByTestId('panel-farm-settings')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Move Planting up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move South block up' }));

    expect(Array.from(screen.getAllByTestId(/^input-group-/), (input) => (input as HTMLInputElement).value))
      .toEqual(['Planting', 'Orchards', 'Repair']);
    expect(Array.from(screen.getAllByTestId(/^input-location-/), (input) => (input as HTMLInputElement).value))
      .toEqual(['South block', 'North block']);

    fireEvent.click(screen.getByTestId('button-save-farm-settings'));
    expect(pageState.save).toHaveBeenCalledWith({
      data: {
        groups: ['Planting', 'Orchards', 'Repair'],
        locations: ['South block', 'North block'],
        defaultGroup: 'Orchards',
        defaultUrgency: 'Medium',
        defaultLocation: 'North block',
      },
    });
  });
});