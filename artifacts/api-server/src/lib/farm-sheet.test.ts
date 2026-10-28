import { beforeEach, describe, expect, it, vi } from "vitest";
import { enableLegacySheetBackingForTests } from "./farm-sheet";
enableLegacySheetBackingForTests();

process.env.FARM_SHEET_DISABLE_PACING = "true";

const legacyHeader = [
    "Task ID", "Group", "Task", "Done", "Urgency", "Month", "Location/Block",
    "Latitude", "Longitude", "Location Captured At", "Atlas Map Link", "Notes",
    "Link", "Subtasks", "Attachment IDs", "Source", "Calendar Event ID",
    "Calendar Recurring Event ID", "Calendar Start", "Calendar Updated", "Updated At",
    "Assignee Clerk ID", "Assignee Name",
];
const rows: string[][] = [[...legacyHeader]];
const completionRows: string[][] = [];
let columnCount = 29;
let completionSheetExists = false;
let transientMetadata401s = 0;

const proxy = vi.fn(async (_provider: string, path: string, options?: { method?: string; body?: string }) => {
  if (path.includes("?fields=sheets.properties")) {
    if (transientMetadata401s > 0) {
      transientMetadata401s -= 1;
      return new Response(JSON.stringify({ error: { message: "Unauthorized" } }), { status: 401 });
    }
    return new Response(JSON.stringify({ sheets: [
      { properties: { sheetId: 42, title: "Planner", gridProperties: { columnCount } } },
      ...(completionSheetExists ? [{ properties: { sheetId: 43, title: "Completion History", gridProperties: { columnCount: 13 } } }] : []),
    ] }));
  }
  if (path.includes(":batchUpdate") && options?.method === "POST") {
    const body = JSON.parse(options.body ?? "{}") as { requests?: Array<{ appendDimension?: { length?: number }; addSheet?: unknown }> };
    if (body.requests?.[0]?.addSheet) completionSheetExists = true;
    columnCount += body.requests?.[0]?.appendDimension?.length ?? 0;
    return new Response(JSON.stringify({ replies: [{}] }));
  }
  if (path.includes("/values/") && options?.method === "PUT") {
    const body = JSON.parse(options.body ?? "{}") as { values: string[][] };
    const decoded = decodeURIComponent(path);
    if (decoded.includes("Completion History!")) {
      completionRows[0] = body.values[0] ?? [];
      return new Response(JSON.stringify({ updates: { updatedRows: 1 } }));
    }
    const xMatch = decoded.match(/!X(\d+):X\d+/);
    const afMatch = decoded.match(/!AF(\d+):AF\d+/);
    const agMatch = decoded.match(/!AG(\d+):AG\d+/);
    const rowNumber = Number((xMatch ?? decoded.match(/!A(\d+):W\d+/))?.[1]);
    if (agMatch) {
      const start = Number(agMatch[1]);
      body.values.forEach((value, index) => {
        rows[start - 1 + index] ??= [];
        rows[start - 1 + index][32] = value[0] ?? "[]";
      });
    } else if (afMatch) {
      const start = Number(afMatch[1]);
      body.values.forEach((value, index) => {
        rows[start - 1 + index] ??= [];
        rows[start - 1 + index][31] = value[0] ?? "";
      });
    } else if (xMatch) {
      rows[rowNumber - 1] ??= [];
      rows[rowNumber - 1][23] = body.values[0]?.[0] ?? "";
    } else {
      const repeat = rows[rowNumber - 1]?.[23];
      rows[rowNumber - 1] = body.values[0] ?? [];
      if (repeat !== undefined) rows[rowNumber - 1][23] = repeat;
    }
    return new Response(JSON.stringify({ updates: { updatedRows: body.values.length } }));
  }
  if (path.includes(":append") && options?.method === "POST") {
    const body = JSON.parse(options.body ?? "{}") as { values: string[][] };
    completionRows.push(...body.values);
    return new Response(JSON.stringify({ updates: { updatedRows: body.values.length } }));
  }
  if (path.includes("/values/") && options?.method === "GET") {
    if (decodeURIComponent(path).includes("Completion History!")) {
      return new Response(JSON.stringify({ values: completionRows }));
    }
    return new Response(JSON.stringify({ values: rows }));
  }
  return new Response(JSON.stringify({}), { status: 404 });
});

vi.mock("./google-connectors", () => ({
  GoogleConnectors: class { proxy = proxy; },
}));

vi.mock("./task-idempotency", () => ({
  withTaskCreationLock: async <T>(_lockKey: string, operation: () => Promise<T>) => operation(),
}));

describe("farm sheet task reads", () => {
  beforeEach(() => {
    rows.splice(0, rows.length, [...legacyHeader]);
    completionRows.splice(0, completionRows.length);
    columnCount = 29;
    completionSheetExists = false;
    transientMetadata401s = 0;
    proxy.mockClear();
    vi.resetModules();
  });

  it("returns an approved Claude task through the same list read used by the task API", async () => {
    const { createSheetTask, findSheetTask, listSheetTasks } = await import("./farm-sheet");

    await createSheetTask({
      id: "claude-42",
      task: "Check irrigation before pruning",
      group: "Orchards",
      urgency: "High",
      month: "2026-08",
      repeatWeekly: true,
    });

    await expect(findSheetTask("claude-42", { verifyWrite: true })).resolves.toEqual(
      expect.objectContaining({ id: "claude-42", task: "Check irrigation before pruning" }),
    );
    await expect(listSheetTasks()).resolves.toEqual([
      expect.objectContaining({ id: "claude-42", task: "Check irrigation before pruning", repeatWeekly: true }),
    ]);
    expect(rows[0][23]).toBe("Repeat Weekly");
    expect(rows[1][23]).toBe("TRUE");
  });

  it("preserves a date-only calendar start through a raw Sheet write and read", async () => {
    const { createSheetTask, listSheetTasks } = await import("./farm-sheet");

    await createSheetTask({
      id: "crew-plan-all-day",
      task: "BioGro Audit",
      calendarStart: "2026-09-14",
    });

    await expect(listSheetTasks()).resolves.toEqual([
      expect.objectContaining({
        id: "crew-plan-all-day",
        calendarStart: "2026-09-14",
        month: "2026-09",
      }),
    ]);
    expect(proxy.mock.calls.some(([, path, options]) =>
      decodeURIComponent(String(path)).includes("!A2:W2")
      && String(path).includes("valueInputOption=RAW")
      && (options as { method?: string } | undefined)?.method === "PUT",
    )).toBe(true);
  });

  it("preserves a timed calendar anchor while its Auckland day remains linked", async () => {
    const { createSheetTask, updateSheetTask } = await import("./farm-sheet");

    const created = await createSheetTask({
      id: "timed-linked-task",
      task: "Timed harvest",
      calendarStart: "2026-08-30T09:00:00.000Z",
      scheduledDates: ["2026-08-30", "2026-09-01"],
    });
    expect(created).toMatchObject({
      calendarStart: "2026-08-30T09:00:00.000Z",
      scheduledDates: ["2026-08-30", "2026-09-01"],
    });

    await expect(updateSheetTask("timed-linked-task", {
      calendarStart: "2026-08-30T09:00:00.000Z",
      scheduledDates: ["2026-08-30", "2026-09-02"],
    })).resolves.toMatchObject({
      calendarStart: "2026-08-30T09:00:00.000Z",
      scheduledDates: ["2026-08-30", "2026-09-02"],
    });
  });

  it("treats an old 23-column row as a one-time task", async () => {
    rows.push(["old-task", "Admin", "Legacy task", "FALSE", "Medium", "", "", "", "", "", "", "", "", "[]", "[]", "Manual", "", "", "", "", "", "", ""]);
    const { listSheetTasks } = await import("./farm-sheet");
    await expect(listSheetTasks()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "old-task",
        repeatWeekly: false,
        assigneeIds: [],
        assigneeNames: [],
      }),
    ]));
  });

  it("recovers from one transient Google Sheets authorization response", async () => {
    transientMetadata401s = 1;
    const { listSheetTasks } = await import("./farm-sheet");

    await expect(listSheetTasks()).resolves.toEqual([]);
    expect(proxy.mock.calls.filter(([, path]) => String(path).includes("?fields=sheets.properties"))).toHaveLength(2);
  });

  it("interprets a legacy weekly cell as canonical weekly recurrence", async () => {
    rows[0] = [...legacyHeader, "Repeat Weekly"];
    rows.push(["legacy-weekly", "Admin", "Legacy weekly task", "FALSE", "Medium", "", "", "", "", "", "", "", "", "[]", "[]", "Manual", "", "", "2026-09-14", "", "", "", "", "TRUE"]);
    const { listSheetTasks } = await import("./farm-sheet");
    await expect(listSheetTasks()).resolves.toEqual([
      expect.objectContaining({ id: "legacy-weekly", recurrence: "weekly", repeatWeekly: true }),
    ]);
  });

  it("writes and reads the canonical recurrence column without changing legacy column positions", async () => {
    const { createSheetTask, listSheetTasks } = await import("./farm-sheet");
    await createSheetTask({
      id: "quarterly-task",
      task: "Service the pump",
      calendarStart: "2026-09-14",
      recurrence: "quarterly",
    });
    await expect(listSheetTasks()).resolves.toEqual([
      expect.objectContaining({ id: "quarterly-task", recurrence: "quarterly", repeatWeekly: false }),
    ]);
    expect(rows[0][23]).toBe("Repeat Weekly");
    expect(rows[0][31]).toBe("Recurrence");
    expect(rows[1][23]).toBe("FALSE");
    expect(rows[1][31]).toBe("quarterly");
  });

  it("preserves non-weekly recurrence when an older client sends only repeatWeekly false", async () => {
    const { createSheetTask, updateSheetTask } = await import("./farm-sheet");
    await createSheetTask({
      id: "legacy-edit-quarterly",
      task: "Service the pump",
      calendarStart: "2026-09-14",
      recurrence: "quarterly",
    });
    await expect(updateSheetTask("legacy-edit-quarterly", {
      task: "Service the main pump",
      repeatWeekly: false,
    })).resolves.toEqual(expect.objectContaining({
      task: "Service the main pump",
      recurrence: "quarterly",
      repeatWeekly: false,
    }));
  });

  it("prefers expanded assignment lists while preserving legacy assignment fields", async () => {
    rows[0] = [...legacyHeader, "Repeat Weekly", "Review Status", "Submitted By Clerk ID", "Submitted By Name", "Review Note", "Reviewed At", "Assignee Clerk IDs", "Assignee Names"];
    rows.push([
      "shared-task", "Admin", "Shared task", "FALSE", "Medium", "", "", "", "", "", "", "", "", "[]", "[]", "Manual",
      "", "", "", "", "", "legacy-worker", "Legacy Worker", "FALSE", "approved", "", "", "", "",
      JSON.stringify(["worker-1", "worker-2"]), JSON.stringify(["Tom", "Jason"]),
    ]);
    const { listSheetTasks } = await import("./farm-sheet");
    await expect(listSheetTasks()).resolves.toEqual([
      expect.objectContaining({
        id: "shared-task",
        assigneeId: "worker-1",
        assigneeName: "Tom",
        assigneeIds: ["worker-1", "worker-2"],
        assigneeNames: ["Tom", "Jason"],
      }),
    ]);
  });

  it("migrates a legacy 29-column planner with five review cells and dedicated AD:AE assignments", async () => {
    rows[0] = [
      ...legacyHeader,
      "Repeat Weekly", "Review Status", "Submitted By Clerk ID", "Submitted By Name", "Review Note", "Reviewed At",
    ];
    rows.push([
      "legacy-29", "Admin", "Keep legacy task", "FALSE", "Medium", "", "", "", "", "", "", "", "", "[]", "[]", "Manual",
      "", "", "", "", "", "worker-1", "Tom", "FALSE", "approved", "", "", "", "",
    ]);
    const { createSheetTask } = await import("./farm-sheet");
    await createSheetTask({ task: "Task after migration" });

    expect(proxy.mock.calls.some(([, path, options]) =>
      String(path).includes(":batchUpdate")
      && (options as { method?: string } | undefined)?.method === "POST",
    )).toBe(true);
    expect(columnCount).toBe(33);
    const writeFor = (range: string) => proxy.mock.calls.find(([, path, options]) =>
      decodeURIComponent(String(path)).includes(range)
      && (options as { method?: string } | undefined)?.method === "PUT",
    )?.[2] as { body?: string } | undefined;
    const review = JSON.parse(writeFor("!Y1:AC2")?.body ?? "{}") as { values: string[][] };
    const assignments = JSON.parse(writeFor("!AD1:AE2")?.body ?? "{}") as { values: string[][] };
    expect(review.values).toHaveLength(2);
    expect(review.values.every((row) => row.length === 5)).toBe(true);
    expect(review.values[0]).toEqual(["Review Status", "Submitted By Clerk ID", "Submitted By Name", "Review Note", "Reviewed At"]);
    expect(assignments.values).toHaveLength(2);
    expect(assignments.values.every((row) => row.length === 2)).toBe(true);
    expect(assignments.values[0]).toEqual(["Assignee Clerk IDs", "Assignee Names"]);
  });

  it("returns the existing task instead of appending a duplicate stable task ID", async () => {
    const { createSheetTask, listSheetTasks } = await import("./farm-sheet");
    const input = { id: "mobile-stable-1", task: "Inspect the south fence", group: "Repair" };

    await createSheetTask(input);
    await createSheetTask(input);

    const matching = (await listSheetTasks()).filter((task) => task.id === input.id);
    expect(matching).toHaveLength(1);
    expect(proxy.mock.calls.some(([, path]) => decodeURIComponent(String(path)).includes("!X1:X"))).toBe(true);
    expect(rows[0][23]).toBe("Repeat Weekly");
    expect(rows[1][23]).toBe("FALSE");
  });

  it("creates append-only completion history and deduplicates a retried event", async () => {
    const { appendCompletionRecord, listCompletionRecords } = await import("./farm-sheet");
    const completion = {
      eventId: "completion:offline-op-1",
      taskId: "task-1",
      taskTitle: "Inspect south block",
      scheduledDate: "2026-09-03",
      completedAt: "2026-09-03T14:30:00+12:00",
      completedById: "worker-1",
      completedByName: "Tom",
      group: "Orchards",
      location: "South block",
      source: "Manual" as const,
      recurrence: "weekly" as const,
      assigneeIds: ["worker-1"],
      assigneeNames: ["Tom"],
    };

    await appendCompletionRecord(completion);
    await appendCompletionRecord(completion);

    await expect(listCompletionRecords()).resolves.toEqual([completion]);
    expect(completionRows[0]).toEqual([
      "Completion Event ID", "Task ID", "Task", "Scheduled Date", "Completed At",
      "Completed By Clerk ID", "Completed By Name", "Group", "Location/Block",
      "Source", "Recurrence", "Assignee Clerk IDs", "Assignee Names",
    ]);
    expect(completionRows).toHaveLength(2);
    expect(proxy.mock.calls.filter(([, path]) => String(path).includes(":append"))).toHaveLength(1);
  });

  it("retries only pending assignments after a partial migration failure", async () => {
    rows.push(
      ["task-1", "Admin", "First task", "FALSE", "Medium", "", "", "", "", "", "", "", "", "[]", "[]", "Manual", "", "", "", "", "", "pending:invite-1", "Invited worker"],
      ["task-2", "Admin", "Second task", "FALSE", "Medium", "", "", "", "", "", "", "", "", "[]", "[]", "Manual", "", "", "", "", "", "pending:invite-1", "Invited worker"],
    );
    let failSecondWrite = true;
    proxy.mockImplementation(async (_provider, path, options) => {
      if (path.includes("?fields=sheets.properties")) return new Response(JSON.stringify({ sheets: [{ properties: { title: "Planner" } }] }));
      if (path.includes("/values/") && options?.method === "PUT") {
        const decoded = decodeURIComponent(path);
        const rowNumber = Number(decoded.match(/![AU](\d+):W\d+/)?.[1]);
        if (rowNumber === 3 && failSecondWrite) {
          failSecondWrite = false;
          return new Response(JSON.stringify({}), { status: 400 });
        }
        const body = JSON.parse(options.body ?? "{}") as { values: string[][] };
        if (decoded.includes(`!U${rowNumber}:W${rowNumber}`)) {
          rows[rowNumber - 1].splice(20, 3, ...(body.values[0] ?? []));
        } else {
          rows[rowNumber - 1] = body.values[0] ?? [];
        }
        return new Response(JSON.stringify({}));
      }
      if (path.includes("/values/") && options?.method === "GET") {
          const rowMatch = decodeURIComponent(path).match(/!A(\d+):(W|AE|AF)\d+/);
        return new Response(JSON.stringify({
          values: rowMatch ? [rows[Number(rowMatch[1]) - 1] ?? []] : rows,
        }));
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });

    const { listSheetTasks, migrateSheetTaskAssignee } = await import("./farm-sheet");
    await expect(migrateSheetTaskAssignee("pending:invite-1", "user-1", "Verified worker")).rejects.toThrow();
    await migrateSheetTaskAssignee("pending:invite-1", "user-1", "Verified worker");

    await expect(listSheetTasks()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "task-1", assigneeId: "user-1", assigneeName: "Verified worker" }),
      expect.objectContaining({ id: "task-2", assigneeId: "user-1", assigneeName: "Verified worker" }),
    ]));
  });

  it("re-reads an assignment candidate and writes only U:W after an interleaved task edit", async () => {
    rows.push(
      ["task-1", "Admin", "Original task", "FALSE", "Medium", "", "", "", "", "", "", "Old notes", "https://old.example", "[]", "[]", "Manual", "", "", "", "", "old-time", "pending:invite-1", "Invited worker"],
    );
    let rowReadCount = 0;
    proxy.mockImplementation(async (_provider, path, options) => {
      if (path.includes("?fields=sheets.properties")) return new Response(JSON.stringify({ sheets: [{ properties: { title: "Planner" } }] }));
      if (path.includes("/values/") && options?.method === "GET") {
        if (decodeURIComponent(path).includes("!A2:AF2") && ++rowReadCount === 1) {
          rows[1][2] = "Edited concurrently";
          rows[1][11] = "New crew notes";
        }
        const rowMatch = decodeURIComponent(path).match(/!A(\d+):(W|AE|AF)(\d+)/);
        const values = rowMatch
          ? [rows[Number(rowMatch[1]) - 1] ?? []]
          : rows;
        return new Response(JSON.stringify({ values }));
      }
      if (path.includes("/values/") && options?.method === "PUT") {
        const decoded = decodeURIComponent(path);
        const body = JSON.parse(options.body ?? "{}") as { values: string[][] };
        const narrowMatch = decoded.match(/!U(\d+):W\d+/);
        if (narrowMatch) {
          rows[Number(narrowMatch[1]) - 1].splice(20, 3, ...(body.values[0] ?? []));
        } else {
          const rowNumber = Number(decoded.match(/!A(\d+):W\d+/)?.[1]);
          rows[rowNumber - 1] = body.values[0] ?? [];
        }
        return new Response(JSON.stringify({}));
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });

    const { migrateSheetTaskAssignee } = await import("./farm-sheet");
    await migrateSheetTaskAssignee("pending:invite-1", "user-1", "Verified worker");

    expect(rows[1]).toMatchObject({
      2: "Edited concurrently",
      11: "New crew notes",
      21: "user-1",
      22: "Verified worker",
    });
    expect(proxy.mock.calls.some(([, path, options]) =>
      decodeURIComponent(String(path)).includes("!U2:W2")
        && (options as { method?: string } | undefined)?.method === "PUT",
    )).toBe(true);
    expect(proxy.mock.calls.some(([, path, options]) =>
      decodeURIComponent(String(path)).includes("!A2:W2")
        && (options as { method?: string } | undefined)?.method === "PUT",
    )).toBe(false);
  });
});