import { describe, expect, it, vi } from "vitest";

vi.mock("./google-connectors", () => ({ GoogleConnectors: class {} }));

describe("calendar write-back", () => {
  it("parses Google calendar/event ids and refuses ICS feeds", async () => {
    const { parseCalendarEventId } = await import("./calendar-writeback");
    expect(parseCalendarEventId("76df@group.calendar.google.com:1smtea5ch0k")).toEqual({ calendarId: "76df@group.calendar.google.com", eventId: "1smtea5ch0k" });
    expect(parseCalendarEventId("info@yurtsforyou.co.nz:abc_20261022T000000Z")).toEqual({ calendarId: "info@yurtsforyou.co.nz", eventId: "abc_20261022T000000Z" });
    expect(parseCalendarEventId("https://calendar.google.com/x/basic.ics:uid@google.com:2026-10-21")).toBeNull();
  });

  it("moves an all-day event keeping its length", async () => {
    const { movedEventTimes } = await import("./calendar-writeback");
    expect(movedEventTimes({ start: { date: "2026-10-22" }, end: { date: "2026-10-24" } }, "2026-11-03"))
      .toEqual({ start: { date: "2026-11-03" }, end: { date: "2026-11-05" } });
  });

  it("moves a timed event to another day keeping its time and duration", async () => {
    const { movedEventTimes } = await import("./calendar-writeback");
    expect(movedEventTimes({ start: { dateTime: "2026-10-22T13:00:00+13:00" }, end: { dateTime: "2026-10-22T15:30:00+13:00" } }, "2026-10-29"))
      .toEqual({ start: { dateTime: "2026-10-29T13:00:00", timeZone: "Pacific/Auckland" }, end: { dateTime: "2026-10-29T15:30:00", timeZone: "Pacific/Auckland" } });
  });

  it("keeps the local time across the April daylight-saving change", async () => {
    const { movedEventTimes } = await import("./calendar-writeback");
    expect(movedEventTimes({ start: { dateTime: "2027-03-30T09:00:00+13:00" }, end: { dateTime: "2027-03-30T10:00:00+13:00" } }, "2027-04-12").start)
      .toEqual({ dateTime: "2027-04-12T09:00:00", timeZone: "Pacific/Auckland" });
  });

  it("uses a chosen time and keeps the duration", async () => {
    const { movedEventTimes } = await import("./calendar-writeback");
    expect(movedEventTimes({ start: { dateTime: "2026-10-22T13:00:00+13:00" }, end: { dateTime: "2026-10-22T14:00:00+13:00" } }, "2026-10-23T19:30:00.000Z"))
      .toEqual({ start: { dateTime: "2026-10-24T08:30:00", timeZone: "Pacific/Auckland" }, end: { dateTime: "2026-10-24T09:30:00", timeZone: "Pacific/Auckland" } });
  });
});

describe("clearing the date of a calendar task", () => {
  it("drops a cleared date so the rest of the edit still saves", async () => {
    const { withoutClearedCalendarDate } = await import("./calendar-writeback");
    expect(withoutClearedCalendarDate({ task: "CITRUS ground", done: true, calendarStart: "", scheduledDates: [] }))
      .toEqual({ task: "CITRUS ground", done: true });
    expect(withoutClearedCalendarDate({ task: "Orchard pruning", calendarStart: "" })).toEqual({ task: "Orchard pruning" });
  });

  it("keeps a real date or an edit without dates as sent", async () => {
    const { withoutClearedCalendarDate } = await import("./calendar-writeback");
    const move = { task: "CITRUS foliar", calendarStart: "2026-11-03", scheduledDates: ["2026-11-03"] };
    expect(withoutClearedCalendarDate(move)).toBe(move);
    const fromDays = { task: "CITRUS foliar", calendarStart: "", scheduledDates: ["2026-11-04"] };
    expect(withoutClearedCalendarDate(fromDays)).toBe(fromDays);
    const doneOnly: { task: string; done: boolean; calendarStart?: string } = { task: "CITRUS foliar", done: true };
    expect(withoutClearedCalendarDate(doneOnly)).toBe(doneOnly);
  });
});
