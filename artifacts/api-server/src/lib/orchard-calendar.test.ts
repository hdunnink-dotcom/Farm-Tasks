import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseIcsCalendar } from "./ics";
import { enableLegacySheetBackingForTests } from "./farm-sheet";
enableLegacySheetBackingForTests();

const headers = [
  "Task ID",
  "Group",
  "Task",
  "Done",
  "Urgency",
  "Month",
  "Location/Block",
  "Latitude",
  "Longitude",
  "Location Captured At",
  "Atlas Map Link",
  "Notes",
  "Link",
  "Subtasks",
  "Attachment IDs",
  "Source",
  "Calendar Event ID",
  "Calendar Recurring Event ID",
  "Calendar Start",
  "Calendar Updated",
  "Updated At",
  "Assignee Clerk ID",
  "Assignee Name",
];

const sources = [
  ["Orchard Managment", "76df9141b280b413eca970598ec55d959234748546ff2ae920654df77c436a63@group.calendar.google.com", "Orchard pruning"],
  ["Pasture Management", "a2a1ce4d44d42bcc4fbc5c395a384fc19b4a8fe732a614be566ae1ac1a2fe4d1@group.calendar.google.com", "Move the sheep"],
  ["Yurtsforyou", "info@yurtsforyou.co.nz", "Prepare a yurt"],
  ["Wwoofers", "14cab9ceb3faee5cd6cdceb5f21937ead7cbd7917bf057227a38021c48c96ca6@group.calendar.google.com", "Welcome the wwoofers"],
  ["Mahakaruna Classroom bookings", "8d2776819bf8484b952aced80d790607121ab0ea4c4dd17adaea5068c95549fd@group.calendar.google.com", "Prepare the classroom"],
] as const;

type Event = {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  status?: string;
  updated: string;
  start: { dateTime?: string; date?: string };
};

type FakeSheet = {
  rows: string[][];
  appendCount: number;
  updateCount: number;
  deleteCount: number;
};

const sheet: FakeSheet = { rows: [], appendCount: 0, updateCount: 0, deleteCount: 0 };
const events = new Map<string, Event[]>();
let failedCalendarId: string | null = null;
let rateLimitedCalendarList = false;
let rateLimitedCalendarId: string | null = null;
const calendarEventPaths: string[] = [];
const testDate = new Date().toISOString().slice(0, 10);
let icsFeed = "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n";

vi.stubGlobal("fetch", vi.fn(async () => new Response(icsFeed)));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function rowForEvent(event: Event, calendarId: string, taskId: string): string[] {
  return [
    taskId,
    "Farm work",
    event.summary,
    event.status === "cancelled" ? "TRUE" : "FALSE",
    "Medium",
    "2026-08",
    "",
    "",
    "",
    "",
    "",
    event.description ?? "",
    event.htmlLink ?? "",
    "[]",
    "[]",
    "Google Calendar",
    `${calendarId}:${event.id}`,
    "",
    event.start.dateTime ?? event.start.date ?? "",
    event.updated,
    new Date(0).toISOString(),
    "",
    "",
  ];
}

vi.mock("./google-connectors", () => ({
  GoogleConnectors: class {
    proxy(_provider: string, path: string, options?: { method?: string; body?: string }): Promise<Response> {
      if (path.startsWith("/calendar/v3/users/me/calendarList")) {
        if (rateLimitedCalendarList) return Promise.resolve(jsonResponse({}, 429));
        return Promise.resolve({
          ok: true,
          json: async () => ({ items: sources.map(([summary, id]) => ({ summary, id })) }),
        } as Response);
      }

      const calendarMatch = path.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events/);
      if (calendarMatch) {
        calendarEventPaths.push(path);
        const calendarId = decodeURIComponent(calendarMatch[1]);
        if (calendarId === failedCalendarId) return Promise.resolve(jsonResponse({}, 503));
        if (calendarId === rateLimitedCalendarId) return Promise.resolve(jsonResponse({}, 429));
        return Promise.resolve(jsonResponse({ items: events.get(calendarId) ?? [] }));
      }

      if (path.includes("/v4/spreadsheets/") && path.includes("/values/")) {
        const decodedPath = decodeURIComponent(path);
        const method = options?.method ?? "GET";
        if (method === "GET") {
          return Promise.resolve(jsonResponse({ values: [headers, ...sheet.rows] }));
        }

        const body = JSON.parse(options?.body ?? "{}") as { values?: string[][] };
        if (decodedPath.includes(":append")) {
          sheet.rows.push(...(body.values ?? []));
          sheet.appendCount += body.values?.length ?? 0;
        } else if (decodedPath.includes(":clear")) {
          const rowMatch = decodedPath.match(/!A(\d+):(?:W|AG)\d+:clear/);
          if (rowMatch) {
            sheet.rows.splice(Number(rowMatch[1]) - 2, 1);
            sheet.deleteCount += 1;
          }
        } else if (method === "PUT") {
          const rowMatch = decodedPath.match(/!A(\d+):W\d+/);
          const scheduledDatesMatch = decodedPath.match(/!AG(\d+):AG\d+/);
          if (scheduledDatesMatch && body.values?.[0]) {
            const rowIndex = Number(scheduledDatesMatch[1]) - 2;
            if (sheet.rows[rowIndex]) sheet.rows[rowIndex][32] = body.values[0][0] ?? "";
          } else if (rowMatch && body.values?.[0]) {
            const rowIndex = Number(rowMatch[1]) - 2;
            const isCreate = !sheet.rows[rowIndex];
            sheet.rows[rowIndex] = body.values[0];
            if (isCreate) sheet.appendCount += 1;
            else sheet.updateCount += 1;
          }
        }
        return Promise.resolve(jsonResponse({}));
      }

      if (path.includes("/v4/spreadsheets/")) {
        return Promise.resolve(jsonResponse({ sheets: [{ properties: { title: "Tasks" } }] }));
      }

      throw new Error(`Unexpected connector request: ${path}`);
    }
  },
}));

const baseEvent = (id: string, summary: string, updated: string): Event => ({
  id,
  summary,
  updated,
  start: { dateTime: `${testDate}T09:00:00Z` },
});

describe("orchard calendar sync", () => {
  it("parses folded Hirshberg-style expanded ICS instances with stable recurrence identities", () => {
    const result = parseIcsCalendar([
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:hirshberg-event",
      "SUMMARY:Farm\\, planning",
      "DESCRIPTION:First line\\n",
      " second folded line",
      "LOCATION:North\\; orchard",
      "URL:https://calendar.example/event",
      "DTSTAMP:20260901T010203Z",
      "LAST-MODIFIED:20260901T010204Z",
      "DTSTART;TZID=Pacific/Auckland:20260915T090000",
      "RECURRENCE-ID;TZID=Pacific/Auckland:20260915T090000",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:unexpanded-rule",
      "DTSTART:20260916T090000Z",
      "RRULE:FREQ=WEEKLY",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n"));
    expect(result.errors).toBe(0);
    expect(result.unsupportedRrules).toBe(1);
    expect(result.events).toEqual([expect.objectContaining({
      uid: "hirshberg-event",
      summary: "Farm, planning",
      description: "First line\nsecond folded line",
      location: "North; orchard",
      recurrenceId: "2026-09-14T21:00:00.000Z",
      start: "2026-09-14T21:00:00.000Z",
    })]);
  });

  beforeEach(() => {
    vi.resetModules();
    sheet.rows = [];
    sheet.appendCount = 0;
    sheet.updateCount = 0;
    sheet.deleteCount = 0;
    failedCalendarId = null;
    rateLimitedCalendarList = false;
    rateLimitedCalendarId = null;
    icsFeed = "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n";
    calendarEventPaths.length = 0;
    events.clear();
    for (const [, calendarId, summary] of sources) {
      events.set(calendarId, [baseEvent("event-1", summary, "2026-08-23T08:00:00Z")]);
    }
  });

  it("imports all configured shared calendars by stable ID and skips identical events on rerun", async () => {
    const { syncOrchardCalendar } = await import("./orchard-calendar");

    const first = await syncOrchardCalendar();
    expect(first.created).toBe(5);
    expect(first.skipped).toBe(0);
    expect(first.calendars).toHaveLength(7);
    expect(first.calendars.every((calendar) => calendar.state === "synced")).toBe(true);
    expect(sheet.rows).toHaveLength(5);

    const second = await syncOrchardCalendar();
    expect(second.created).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.skipped).toBe(5);
    expect(sheet.appendCount).toBe(6);
    expect(sheet.updateCount).toBe(4);
    const request = new URL(calendarEventPaths[0], "https://example.test");
    expect(request.searchParams.get("timeMin")).toMatch(new RegExp(`^${new Date().getFullYear()}-01-01`));
  });

  it("persists exact timed starts and date-only all-day starts from Google Calendar", async () => {
    const [, orchardId] = sources[0];
    const timedStart = "2099-02-03T04:05:00-11:00";
    events.set(orchardId, [{
      ...baseEvent("timed-event", "Timed orchard work", "2099-01-01T00:00:00Z"),
      start: { dateTime: timedStart },
    }]);
    const [, pastureId] = sources[1];
    events.set(pastureId, [{
      ...baseEvent("all-day-event", "All-day pasture work", "2099-01-01T00:00:00Z"),
      start: { date: "2099-02-04" },
    }]);

    const { syncOrchardCalendar } = await import("./orchard-calendar");
    await syncOrchardCalendar();

    const timed = sheet.rows.find((row) => row[16] === `${orchardId}:timed-event`);
    const allDay = sheet.rows.find((row) => row[16] === `${pastureId}:all-day-event`);
    expect(timed?.[18]).toBe(timedStart);
    expect(timed?.[5]).toBe("2099-02");
    expect(allDay?.[18]).toBe("2099-02-04");
    expect(allDay?.[5]).toBe("2099-02");
  });

  it("updates Calendar-owned title, notes, and dates without overwriting crew-owned task progress", async () => {
    const { syncOrchardCalendar } = await import("./orchard-calendar");
    await syncOrchardCalendar();

    const orchardRow = sheet.rows.find((row) => row[0].includes("Orchard") || row[2] === "Orchard pruning");
    const pastureRow = sheet.rows.find((row) => row[2] === "Move the sheep");
    if (!orchardRow || !pastureRow) throw new Error("Expected imported calendar rows.");
    for (const row of [orchardRow, pastureRow]) {
      row[7] = "-41.123";
      row[8] = "174.456";
      row[9] = "2026-08-23T09:30:00Z";
      row[10] = "https://atlas.example/crew-pin";
      row[11] = "Crew notes";
      row[13] = JSON.stringify([{ id: "sub-1", title: "Crew step", done: true }]);
      row[14] = JSON.stringify(["att-1"]);
      row[21] = "worker-1";
      row[22] = "Field Worker";
    }
    orchardRow[3] = "TRUE";
    pastureRow[3] = "FALSE";

    const changed = baseEvent("event-1", "Orchard pruning moved", "2026-08-23T10:00:00Z");
    changed.location = "North orchard";
    changed.description = "Prune the northern rows first.";
    events.set("76df9141b280b413eca970598ec55d959234748546ff2ae920654df77c436a63@group.calendar.google.com", [changed]);
    events.set("a2a1ce4d44d42bcc4fbc5c395a384fc19b4a8fe732a614be566ae1ac1a2fe4d1@group.calendar.google.com", [{
      ...baseEvent("event-1", "Move the sheep", "2026-08-23T11:00:00Z"),
      status: "cancelled",
    }]);

    const result = await syncOrchardCalendar();
    expect(result.updated).toBe(1);
    expect(result.cancelled).toBe(1);
    expect(result.skipped).toBe(3);
    const updatedOrchard = sheet.rows.find((row) => row[0] === "gcal-76df9141b280b413eca970598ec55d959234748546ff2ae920654df77c436a63@group.calendar.google.com-event-1");
    expect(updatedOrchard?.[2]).toBe("Orchard pruning moved");
    expect(updatedOrchard?.[3]).toBe("TRUE");
    expect(updatedOrchard?.[11]).toBe("Prune the northern rows first.");
    const cancelled = sheet.rows.find((row) => row[0] === "gcal-a2a1ce4d44d42bcc4fbc5c395a384fc19b4a8fe732a614be566ae1ac1a2fe4d1@group.calendar.google.com-event-1");
    expect(cancelled?.[3]).toBe("TRUE");
    for (const row of [updatedOrchard, cancelled]) {
      expect(row?.[7]).toBe("-41.123");
      expect(row?.[8]).toBe("174.456");
      expect(row?.[9]).toBe("2026-08-23T09:30:00Z");
      expect(row?.[10]).toBe("https://atlas.example/crew-pin");
      expect(row?.[13]).toBe(JSON.stringify([{ id: "sub-1", title: "Crew step", done: true }]));
      expect(row?.[14]).toBe(JSON.stringify(["att-1"]));
      expect(row?.[21]).toBe("worker-1");
      expect(row?.[22]).toBe("Field Worker");
    }
    expect(cancelled?.[11]).toBe("");
  });

  it("synchronizes an imported event's singleton Auckland scheduled date after it moves", async () => {
    const [, orchardId] = sources[0];
    events.set(orchardId, [{
      ...baseEvent("moved-event", "Move irrigation", "2099-02-01T00:00:00Z"),
      start: { dateTime: "2099-02-03T12:00:00Z" },
    }]);
    const { syncOrchardCalendar } = await import("./orchard-calendar");
    await syncOrchardCalendar();

    const imported = sheet.rows.find((row) => row[16] === `${orchardId}:moved-event`);
    expect(imported?.[32]).toBe(JSON.stringify(["2099-02-04"]));
    if (!imported) throw new Error("Expected moved imported event.");
    events.set(orchardId, [{
      ...baseEvent("moved-event", "Move irrigation", "2099-02-02T00:00:00Z"),
      start: { dateTime: "2099-02-05T12:00:00Z" },
    }]);

    const result = await syncOrchardCalendar();
    const moved = sheet.rows.find((row) => row[16] === `${orchardId}:moved-event`);
    expect(result.updated).toBe(1);
    expect(moved?.[18]).toBe("2099-02-05T12:00:00Z");
    expect(moved?.[32]).toBe(JSON.stringify(["2099-02-06"]));
  });

  it("treats unchanged Google and ICS cancellations as authoritative while preserving crew-owned work", async () => {
    const [, orchardId] = sources[0];
    events.set(orchardId, [baseEvent("cancel-google", "Google booking", "2026-08-23T08:00:00Z")]);
    icsFeed = [
      "BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:cancel-ics", "SUMMARY:ICS booking",
      "DESCRIPTION:Original calendar description", `DTSTART:${testDate.replaceAll("-", "")}T090000Z`,
      "DTSTAMP:20260823T080000Z", "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
    const { syncOrchardCalendar } = await import("./orchard-calendar");
    await syncOrchardCalendar();
    const google = sheet.rows.find((row) => row[16] === `${orchardId}:cancel-google`);
    const ics = sheet.rows.find((row) => row[16].includes("cancel-ics"));
    if (!google || !ics) throw new Error("Expected imported cancellation fixtures.");
    for (const row of [google, ics]) {
      row[11] = "Crew notes";
      row[13] = JSON.stringify([{ id: "crew-step", title: "Complete", done: false }]);
      row[14] = JSON.stringify(["crew-attachment"]);
      row[21] = "worker-1";
    }
    // The cancellation carries the same external content/version: done must still change.
    events.set(orchardId, [{ ...baseEvent("cancel-google", "Google booking", "2026-08-23T08:00:00Z"), status: "cancelled" }]);
    icsFeed = [
      "BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:cancel-ics", "SUMMARY:ICS booking",
      "DESCRIPTION:Original calendar description", `DTSTART:${testDate.replaceAll("-", "")}T090000Z`,
      "STATUS:CANCELLED", "DTSTAMP:20260823T080000Z", "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
    const result = await syncOrchardCalendar();
    expect(result.cancelled).toBe(2);
    const cancelledGoogle = sheet.rows.find((row) => row[16] === `${orchardId}:cancel-google`);
    const cancelledIcs = sheet.rows.find((row) => row[16].includes("cancel-ics"));
    if (!cancelledGoogle || !cancelledIcs) throw new Error("Expected updated cancellation fixtures.");
    for (const row of [cancelledGoogle, cancelledIcs]) {
      expect(row[3]).toBe("TRUE");
      expect(row[13]).toBe(JSON.stringify([{ id: "crew-step", title: "Complete", done: false }]));
      expect(row[14]).toBe(JSON.stringify(["crew-attachment"]));
      expect(row[21]).toBe("worker-1");
    }
    expect(cancelledGoogle[11]).toBe("");
    expect(cancelledIcs[11]).toBe("Original calendar description");
  });

  it("leaves Busy blocks from the free/busy feed out of the task list and removes earlier imports", async () => {
    const busyEvent = (summary: string) => [
      "BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:busy-block", `SUMMARY:${summary}`,
      `DTSTART:${testDate.replaceAll("-", "")}T090000Z`, "DTSTAMP:20260823T080000Z", "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
    icsFeed = busyEvent("Hirshberg meeting");
    const { syncOrchardCalendar } = await import("./orchard-calendar");
    await syncOrchardCalendar();
    expect(sheet.rows.some((row) => row[16].includes("busy-block"))).toBe(true);

    icsFeed = busyEvent("Busy");
    const result = await syncOrchardCalendar();
    expect(sheet.rows.some((row) => row[16].includes("busy-block"))).toBe(false);
    expect(result.calendars.find((calendar) => calendar.name === "Hirshberg Institute")).toMatchObject({ created: 0, cancelled: 1 });

    await syncOrchardCalendar();
    expect(sheet.rows.some((row) => row[16].includes("busy-block"))).toBe(false);
  });

  it("reports unsupported ICS RRULE masters as a synced warning while importing expanded instances", async () => {
    icsFeed = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT", "UID:rule-master", "SUMMARY:Master", `DTSTART:${testDate.replaceAll("-", "")}T090000Z`, "RRULE:FREQ=WEEKLY", "END:VEVENT",
      "BEGIN:VEVENT", "UID:rule-master", "SUMMARY:Expanded instance", `DTSTART:${testDate.replaceAll("-", "")}T090000Z`, `RECURRENCE-ID:${testDate.replaceAll("-", "")}T090000Z`, "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const { syncOrchardCalendar } = await import("./orchard-calendar");
    const result = await syncOrchardCalendar();
    const hirshberg = result.calendars.find((calendar) => calendar.name === "Hirshberg Institute");
    expect(hirshberg).toMatchObject({ state: "synced", errors: 0, created: 1, unsupportedRrules: 1 });
    expect(hirshberg?.warning).toContain("unsupported RRULE master");
  });

  it("rekeys an explicitly retired Orchard calendar row without duplicating or losing progress", async () => {
    const retiredOrchardId = "c_b42da642624a92be69504f090c9ee09c66f97476265222ebd84182d3d180943b@group.calendar.google.com";
    const [, orchardId, orchardSummary] = sources[0];
    const oldRow = rowForEvent(baseEvent("event-1", "Old orchard title", "2026-08-01T08:00:00Z"), retiredOrchardId, "old-orchard-task");
    oldRow[3] = "TRUE";
    oldRow[7] = "-41.123";
    oldRow[13] = JSON.stringify([{ id: "crew-step", title: "Prune", done: true }]);
    oldRow[21] = "worker-1";
    oldRow[22] = "Field Worker";
    sheet.rows.push(oldRow);

    const { syncOrchardCalendar } = await import("./orchard-calendar");
    const result = await syncOrchardCalendar();

    expect(result.created).toBe(4);
    expect(result.updated).toBe(1);
    expect(sheet.rows.filter((row) => row[16] === `${orchardId}:event-1`)).toHaveLength(1);
    expect(sheet.rows.some((row) => row[16] === `${retiredOrchardId}:event-1`)).toBe(false);
    const rekeyed = sheet.rows.find((row) => row[0] === "old-orchard-task");
    expect(rekeyed).toMatchObject({
      2: orchardSummary,
      3: "TRUE",
      7: "-41.123",
      13: JSON.stringify([{ id: "crew-step", title: "Prune", done: true }]),
      21: "worker-1",
      22: "Field Worker",
    });
  });

  it("reports a failed source while preserving successful imports", async () => {
    const { syncOrchardCalendar } = await import("./orchard-calendar");
    failedCalendarId = "14cab9ceb3faee5cd6cdceb5f21937ead7cbd7917bf057227a38021c48c96ca6@group.calendar.google.com";

    const result = await syncOrchardCalendar();
    const failed = result.calendars.find((calendar) => calendar.name === "Wwoofers");
    const successful = result.calendars.filter((calendar) => calendar.name !== "Wwoofers");

    expect(failed).toMatchObject({ state: "error", errors: 1 });
    expect(failed?.error).toContain("Calendar events request failed (503)");
    expect(successful).toHaveLength(6);
    expect(successful.filter((calendar) => ["Primary Google Calendar", "Hirshberg Institute"].includes(calendar.name)).every((calendar) => calendar.created === 0)).toBe(true);
    expect(successful.filter((calendar) => !["Primary Google Calendar", "Hirshberg Institute"].includes(calendar.name)).every((calendar) => calendar.created === 1)).toBe(true);
    expect(sheet.rows).toHaveLength(4);
    expect(result.created).toBe(4);
    expect(result.errors).toBe(1);
  });

  it("retries a rate-limited calendar event request and preserves prior task data when a refresh stays rate-limited", async () => {
    const { syncOrchardCalendar, getOrchardCalendarStatus } = await import("./orchard-calendar");
    await syncOrchardCalendar();
    const previousStatus = getOrchardCalendarStatus();
    const previousRows = sheet.rows.map((row) => [...row]);

    rateLimitedCalendarList = true;
    await expect(syncOrchardCalendar()).rejects.toThrow("Google Calendar is temporarily rate-limited; try again shortly.");

    const status = getOrchardCalendarStatus();
    expect(status.state).toBe("error");
    expect(status.lastError).toBe("Google Calendar is temporarily rate-limited; try again shortly.");
    expect(status.lastSyncAt).toBe(previousStatus.lastSyncAt);
    expect(status.result).toEqual(previousStatus.result);
    expect(sheet.rows).toHaveLength(previousRows.length);
    expect(sheet.rows.map((row) => row[0])).toEqual(previousRows.map((row) => row[0]));
  });

  it("keeps successful calendar imports while reporting a rate-limited event source", async () => {
    const { syncOrchardCalendar, getOrchardCalendarStatus } = await import("./orchard-calendar");
    rateLimitedCalendarId = sources[3][1];

    const result = await syncOrchardCalendar();
    const throttled = result.calendars.find((calendar) => calendar.name === "Wwoofers");
    expect(throttled).toMatchObject({
      state: "error",
      errors: 1,
      error: "Google Calendar is temporarily rate-limited; try again shortly.",
    });
    expect(getOrchardCalendarStatus().lastError).toBe("Google Calendar is temporarily rate-limited; try again shortly.");
    expect(result.created).toBe(4);
    expect(sheet.rows).toHaveLength(4);
  });

  it("preserves past imported and manual task history", async () => {
    const importedPastEvent = {
      ...baseEvent("past-event", "Past calendar work", "2026-08-20T08:00:00Z"),
      start: { dateTime: "2026-08-20T09:00:00Z" },
    };
    const manualPastEvent = {
      ...baseEvent("manual-past", "Manual history", "2026-08-20T08:00:00Z"),
      start: { dateTime: "2026-08-20T09:00:00Z" },
    };
    const manualRow = rowForEvent(manualPastEvent, "manual", "manual-past");
    manualRow[15] = "Google Sheets";
    sheet.rows.push(
      rowForEvent(importedPastEvent, "orchard-id", "gcal-orchard-id-past-event"),
      manualRow,
    );

    const { syncOrchardCalendar } = await import("./orchard-calendar");
    await syncOrchardCalendar();

    expect(sheet.deleteCount).toBe(0);
    expect(sheet.rows.some((row) => row[0] === "gcal-orchard-id-past-event")).toBe(true);
    expect(sheet.rows.some((row) => row[0] === "manual-past")).toBe(true);
  });
});