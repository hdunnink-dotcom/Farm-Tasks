import { expect, test } from '@playwright/test';

const taskNames = [
  'Backgrounded irrigation check',
  'Open the south gate',
  'Check the lambing paddock',
];

test('flushes multiple queued tasks after mobile Chrome backgrounds and restores the tab', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  let createAttempts = 0;
  let blockFirstTask = true;
  let serverTasks: Array<Record<string, unknown>> = [];
  let mainFrameNavigations = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) mainFrameNavigations += 1;
  });

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === '/api/me') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          clerkId: 'test-master',
          role: 'master',
          isManager: true,
          isHarnold: false,
        }),
      });
      return;
    }

    if (url.pathname === '/api/team') {
      await route.fulfill({ contentType: 'application/json', body: '[]' });
      return;
    }

    if (url.pathname === '/api/tasks/summary') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ total: serverTasks.length, open: serverTasks.length, done: 0, highPriority: 0, dueThisMonth: 0 }),
      });
      return;
    }

    if (url.pathname !== '/api/tasks') {
      await route.fulfill({ contentType: 'application/json', body: '{}' });
      return;
    }

    if (request.method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          tasks: serverTasks,
          source: 'Google Sheets',
          sourceUrl: 'https://docs.google.com/spreadsheets/d/test-sheet/edit',
        }),
      });
      return;
    }

    if (request.method() === 'POST') {
      const input = JSON.parse(request.postData() || '{}') as Record<string, unknown>;
      createAttempts += 1;
      if (blockFirstTask && input.task === taskNames[0]) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Google Sheets is temporarily unavailable' }),
        });
        return;
      }

      const created = {
        id: input.clientTaskId,
        task: input.task,
        group: input.group || 'Orchards',
        done: input.done || false,
        urgency: input.urgency || 'Medium',
        month: input.month || '',
        location: input.location || '',
        notes: input.notes || '',
        link: input.link || '',
        subtasks: input.subtasks || [],
        attachments: [],
        source: 'Manual',
        calendarEventId: '',
        calendarRecurringEventId: '',
        calendarStart: input.calendarStart || '',
        recurrence: input.recurrence || 'none',
        repeatWeekly: input.repeatWeekly || false,
        calendarUpdated: '',
        updatedAt: '2026-09-06T10:00:00.000Z',
        assigneeId: '',
        assigneeName: '',
        assigneeIds: [],
        assigneeNames: [],
      };
      serverTasks = [...serverTasks, created];
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(created) });
      return;
    }

    await route.fulfill({ status: 405, body: 'Method not allowed' });
  });

  try {
    await page.goto('/tasks');
    const initialNavigationCount = mainFrameNavigations;
    await expect(page.getByRole('heading', { name: 'All tasks.' })).toBeVisible();
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
      window.dispatchEvent(new Event('offline'));
    });
    for (const taskName of taskNames) {
      await page.getByTestId('button-add-task').click();
      await page.getByRole('dialog').getByLabel('Task title').fill(taskName);
      await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
      await expect(page.getByText(taskName, { exact: true })).toBeVisible();
    }
    await expect(page.getByTestId('mobile-sync-status')).toContainText('3 pending');
    expect(createAttempts).toBe(0);

    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
      window.dispatchEvent(new Event('online'));
    });
    await expect.poll(() => createAttempts).toBe(3);
    await expect(page.getByTestId('mobile-sync-status')).toContainText('1 pending');
    expect(serverTasks).toHaveLength(2);

    const backgroundTab = await context.newPage();
    await backgroundTab.goto('about:blank');
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('hidden');
    await backgroundTab.close();
    blockFirstTask = false;
    await page.bringToFront();
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('visible');

    await expect.poll(() => createAttempts, { timeout: 15_000 }).toBe(4);
    for (const taskName of taskNames) {
      await expect(page.getByText(taskName, { exact: true })).toBeVisible();
    }
    await expect(page.getByTestId('mobile-sync-status')).toContainText('Up to date');
    expect(page.url()).toContain('/tasks');
    expect(mainFrameNavigations).toBe(initialNavigationCount);
    expect(serverTasks).toHaveLength(3);
  } finally {
    await context.close();
  }
});