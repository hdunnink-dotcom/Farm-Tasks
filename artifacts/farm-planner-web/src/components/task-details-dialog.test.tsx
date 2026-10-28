import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FarmTask } from '@workspace/api-client-react';
import { TaskDetailsDialog } from './farm-planner';

vi.mock('@clerk/react', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true }),
}));

vi.mock('@/hooks/use-me', () => ({
  useMe: () => ({ data: undefined }),
}));

const task = {
  id: 'task-a',
  task: 'Prune pear row',
  group: 'Orchards',
  done: false,
  urgency: 'Medium',
  month: 'September',
  location: 'North orchard',
  notes: '',
  link: '',
  subtasks: [],
  source: 'Manual',
  calendarEventId: '',
  calendarRecurringEventId: '',
  calendarStart: '2026-09-03',
  calendarUpdated: '',
  updatedAt: '2026-09-03T00:00:00.000Z',
  assigneeId: '',
  assigneeName: '',
  assigneeIds: [],
  assigneeNames: [],
  attachments: [{
    id: 'photo-a',
    taskId: 'task-a',
    name: 'Pear row.jpg',
    contentType: 'image/jpeg',
    size: 1200,
    downloadUrl: 'https://example.com/pear-row.jpg',
  }],
} as unknown as FarmTask;

describe('TaskDetailsDialog responsive behavior', () => {
  it('keeps the task details sheet mobile until the planner switches to desktop layout', async () => {
    render(<TaskDetailsDialog task={task} onClose={vi.fn()} />);

    const dialog = await screen.findByRole('dialog');
    expect(dialog.className).toContain('bottom-0');
    expect(dialog.className).toContain('lg:max-w-2xl');
    expect(dialog.className).not.toContain('md:max-w-2xl');
  });
});

describe('TaskDetailsDialog keyboard behavior', () => {
  it('moves focus into nested photo details and restores it in order', async () => {
    const onClose = vi.fn();
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();

    render(<TaskDetailsDialog task={task} onClose={onClose} />);

    const closeDetails = await screen.findByRole('button', { name: 'Close task details' });
    await waitFor(() => expect(document.activeElement).toBe(closeDetails));

    const photoButton = screen.getByRole('button', { name: 'Open full-screen photo: Pear row.jpg' });
    fireEvent.click(photoButton);

    const closePhoto = await screen.findByRole('button', { name: 'Close full-screen photo' });
    await waitFor(() => expect(document.activeElement).toBe(closePhoto));

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(closePhoto);

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Close full-screen photo' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(photoButton));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
