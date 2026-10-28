import { normalizeTaskCategory } from "./task-categories";
import type { TaskRecurrence } from "./farm-sheet";

type LocationTimestampInput = {
  locationCapturedAt?: string | null;
  group?: string;
  calendarStart?: string;
  scheduledDates?: string[];
  recurrence?: TaskRecurrence;
  repeatWeekly?: boolean;
};

function validDatePart(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|$)/);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() === Number(match[2]) - 1
    && date.getUTCDate() === Number(match[3]);
}

/** Empty is an intentional unschedule; date-only values are all-day tasks and timestamps identify an instant. */
export function normalizeCalendarStart(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized === "") return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    if (validDatePart(normalized)) return normalized;
    throw new Error("Calendar start must be a valid ISO date or an instant with a Z or UTC offset.");
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) || !validDatePart(normalized)) {
    throw new Error("Calendar start must be a valid ISO date or an instant with a Z or UTC offset.");
  }
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) throw new Error("Calendar start must be a valid ISO date or an instant with a Z or UTC offset.");
  return date.toISOString();
}

export const MAX_SCHEDULED_DATES = 366;

/** Validates canonical Auckland date keys and makes one deterministic schedule. */
export function normalizeScheduledDates(value: string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  if (value.length > MAX_SCHEDULED_DATES) {
    throw new Error(`A task can be scheduled on at most ${MAX_SCHEDULED_DATES} dates.`);
  }
  const dates = value.map((date) => date.trim());
  if (dates.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date) || !validDatePart(date))) {
    throw new Error("Scheduled dates must be valid Auckland YYYY-MM-DD date keys.");
  }
  return [...new Set(dates)].sort();
}

function aucklandDateKey(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * Sheet rows use an empty string for a deliberately cleared timestamp.
 * An omitted property must stay omitted so partial task updates preserve
 * the existing GPS capture metadata.
 */
export function normalizeSheetTaskInput<T extends object>(
  input: T & LocationTimestampInput,
): Omit<T, "locationCapturedAt"> & { locationCapturedAt?: string } {
  const { locationCapturedAt, calendarStart, scheduledDates, recurrence, repeatWeekly, ...rest } = input;
  const normalized = "group" in rest
    ? { ...rest, group: normalizeTaskCategory(rest.group) }
    : rest;
  const withLocation = locationCapturedAt === undefined
    ? normalized
    : { ...normalized, locationCapturedAt: locationCapturedAt ?? "" };
  const canonicalStart = normalizeCalendarStart(calendarStart);
  const canonicalSchedule = normalizeScheduledDates(scheduledDates);
  const canonicalRecurrence = recurrence ?? (
    repeatWeekly === true ? "weekly" : undefined
  );
  // Only judge the schedule when this input actually sets one. A partial edit
  // that carries the recurrence but not the dates (e.g. marking done or
  // reassigning) keeps the task's saved start; the route checks that.
  const setsSchedule = calendarStart !== undefined || scheduledDates !== undefined;
  if (setsSchedule && canonicalRecurrence && canonicalRecurrence !== "none" && !(canonicalSchedule?.[0] ?? canonicalStart)) {
    throw new Error(canonicalRecurrence === "weekly"
      ? "Weekly tasks require a scheduled calendar start."
      : "Recurring tasks require a scheduled calendar start.");
  }
  return {
    ...withLocation,
    ...(canonicalSchedule === undefined
      ? (canonicalStart === undefined ? {} : { calendarStart: canonicalStart })
      : {
        scheduledDates: canonicalSchedule,
        // Keep a primary task's valid instant (and therefore its time of day)
        // while that Auckland day remains selected. Date-only and stale
        // anchors continue to use the earliest selected linked day.
        calendarStart: canonicalStart?.includes("T")
          && canonicalSchedule.includes(aucklandDateKey(canonicalStart))
          ? canonicalStart
          : canonicalSchedule[0] ?? "",
      }),
    ...(canonicalRecurrence === undefined ? (repeatWeekly === undefined ? {} : { repeatWeekly }) : {
      recurrence: canonicalRecurrence,
      repeatWeekly: canonicalRecurrence === "weekly",
    }),
  } as Omit<T, "locationCapturedAt"> & { locationCapturedAt?: string };
}