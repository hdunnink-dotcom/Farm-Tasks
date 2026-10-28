import { describe, expect, it } from "vitest";
import { normalizeCalendarStart, normalizeScheduledDates, normalizeSheetTaskInput } from "./task-input-normalization";

describe("normalizeSheetTaskInput", () => {
  it("preserves existing GPS metadata on unrelated partial updates", () => {
    expect(normalizeSheetTaskInput({ task: "Prune pears", done: true })).toEqual({
      task: "Prune pears",
      done: true,
    });
    expect(normalizeSheetTaskInput({ task: "Prune pears", month: "2026-09" })).toEqual({
      task: "Prune pears",
      month: "2026-09",
    });
  });

  it("keeps a supplied capture timestamp and turns an explicit null into a sheet clear", () => {
    expect(normalizeSheetTaskInput({ task: "Prune pears", locationCapturedAt: "2026-08-23T09:00:00.000Z" })).toEqual({
      task: "Prune pears",
      locationCapturedAt: "2026-08-23T09:00:00.000Z",
    });
    expect(normalizeSheetTaskInput({ task: "Prune pears", locationCapturedAt: null })).toEqual({
      task: "Prune pears",
      locationCapturedAt: "",
    });
  });

  it("preserves valid all-day dates, canonicalizes instants, and rejects invalid values", () => {
    expect(normalizeSheetTaskInput({ task: "Check traps", calendarStart: "2026-04-05T09:30:00+12:00", repeatWeekly: true }))
      .toMatchObject({ calendarStart: "2026-04-04T21:30:00.000Z", recurrence: "weekly", repeatWeekly: true });
    expect(normalizeSheetTaskInput({ task: "Crew Plan audit", calendarStart: "2026-04-05" }))
      .toMatchObject({ calendarStart: "2026-04-05" });
    expect(normalizeCalendarStart("")).toBe("");
    expect(normalizeCalendarStart(" 2026-04-05 ")).toBe("2026-04-05");
    expect(() => normalizeCalendarStart("2026-02-30")).toThrow(/valid ISO date/);
    expect(() => normalizeCalendarStart("2026-04-05T09:30")).toThrow(/valid ISO date/);
    expect(() => normalizeCalendarStart("2026-02-30T09:30:00Z")).toThrow(/valid ISO date/);
    expect(() => normalizeSheetTaskInput({ task: "Check traps", calendarStart: "", repeatWeekly: true })).toThrow(/Weekly tasks require/);
    expect(() => normalizeSheetTaskInput({ task: "Check traps", calendarStart: "", recurrence: "monthly" })).toThrow(/Recurring tasks require/);
  });

  it("normalizes every recurrence value while retaining the weekly compatibility field", () => {
    for (const recurrence of ["none", "weekly", "biweekly", "every4weeks", "monthly", "quarterly", "yearly"] as const) {
      expect(normalizeSheetTaskInput({ task: "Routine", calendarStart: recurrence === "none" ? "" : "2026-09-14", recurrence }))
        .toMatchObject({ recurrence, repeatWeekly: recurrence === "weekly" });
    }
  });

  it("does not let legacy false invent a canonical recurrence during partial updates", () => {
    expect(normalizeSheetTaskInput({ task: "Routine", repeatWeekly: false }))
      .toEqual({ task: "Routine", repeatWeekly: false });
  });

  it("canonicalizes linked Auckland dates and uses the first as the legacy anchor", () => {
    expect(normalizeSheetTaskInput({
      task: "Harvest block",
      calendarStart: "2026-09-30",
      scheduledDates: ["2026-10-03", "2026-10-01", "2026-10-03"],
    })).toMatchObject({
      calendarStart: "2026-10-01",
      scheduledDates: ["2026-10-01", "2026-10-03"],
    });
    expect(normalizeSheetTaskInput({ task: "Unschedule", calendarStart: "2026-10-01", scheduledDates: [] }))
      .toMatchObject({ calendarStart: "", scheduledDates: [] });
    expect(() => normalizeScheduledDates(["2026-02-30"])).toThrow(/Scheduled dates/);
  });

  it("preserves a primary timestamp when its Auckland day remains scheduled", () => {
    expect(normalizeSheetTaskInput({
      task: "Timed harvest",
      calendarStart: "2026-08-30T09:00:00.000Z",
      scheduledDates: ["2026-08-30", "2026-09-01"],
    })).toMatchObject({
      calendarStart: "2026-08-30T09:00:00.000Z",
      scheduledDates: ["2026-08-30", "2026-09-01"],
    });
  });
});
describe("partial edits of repeating tasks", () => {
  it("accepts an edit that carries the recurrence but not the dates", async () => {
    const { normalizeSheetTaskInput } = await import("./task-input-normalization");
    expect(() => normalizeSheetTaskInput({ task: "Reply yurt emails", done: true, recurrence: "weekly" as const, repeatWeekly: true })).not.toThrow();
  });
  it("still rejects clearing the date of a weekly task", async () => {
    const { normalizeSheetTaskInput } = await import("./task-input-normalization");
    expect(() => normalizeSheetTaskInput({ task: "Reply yurt emails", calendarStart: "", scheduledDates: [], recurrence: "weekly" as const }))
      .toThrow("Weekly tasks require a scheduled calendar start.");
  });
});
