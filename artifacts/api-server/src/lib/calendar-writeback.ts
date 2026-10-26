import { GoogleConnectors } from "./google-connectors";
import type { SheetTask } from "./farm-sheet";

/**
 * Write changes made in the planner back to the Google Calendar event a task
 * was imported from (date/time, title, notes, location), so the next calendar
 * sync agrees with the planner instead of reverting it.
 */

const TIME_ZONE = "Pacific/Auckland";

export class CalendarWritebackError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "CalendarWritebackError";
  }
}

type EventTime = { date?: string; dateTime?: string; timeZone?: string };
type GoogleEvent = {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: EventTime;
  end?: EventTime;
  updated?: string;
  htmlLink?: string;
  status?: string;
};

/** "calendarId:eventId" (Google) — ICS feeds are read-only and not handled here. */
export function parseCalendarEventId(calendarEventId: string): { calendarId: string; eventId: string } | null {
  if (!calendarEventId || /^https?:/i.test(calendarEventId)) return null;
  const split = calendarEventId.lastIndexOf(":");
  if (split <= 0 || split === calendarEventId.length - 1) return null;
  return { calendarId: calendarEventId.slice(0, split), eventId: calendarEventId.slice(split + 1) };
}

function aucklandParts(instant: Date): { date: string; time: string } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(instant).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}:${parts.second}` };
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Auckland wall-clock "YYYY-MM-DD" + "HH:MM:SS" as an RFC3339 local time (Google applies timeZone). */
function localDateTime(date: string, time: string): string {
  return `${date}T${time}`;
}

/**
 * New start/end for the event when the planner moves it to `target`
 * (a date key, or an ISO instant when a time was chosen). Duration is kept.
 */
export function movedEventTimes(event: GoogleEvent, target: string): { start: EventTime; end: EventTime } {
  const targetHasTime = target.includes("T");
  const targetDay = targetHasTime ? aucklandParts(new Date(target)).date : target;

  if (event.start?.date) {
    const lengthDays = event.end?.date ? Math.max(1, daysBetween(event.start.date, event.end.date)) : 1;
    if (!targetHasTime) {
      return { start: { date: targetDay }, end: { date: addDays(targetDay, lengthDays) } };
    }
    // An all-day event given a time becomes a one-hour timed event.
    const start = aucklandParts(new Date(target));
    const end = aucklandParts(new Date(Date.parse(target) + 3_600_000));
    return {
      start: { dateTime: localDateTime(start.date, start.time), timeZone: TIME_ZONE },
      end: { dateTime: localDateTime(end.date, end.time), timeZone: TIME_ZONE },
    };
  }

  const originalStart = event.start?.dateTime ? new Date(event.start.dateTime) : null;
  const originalEnd = event.end?.dateTime ? new Date(event.end.dateTime) : null;
  const durationMs = originalStart && originalEnd ? Math.max(0, originalEnd.getTime() - originalStart.getTime()) : 3_600_000;
  // A date-only move of a timed event keeps its time of day.
  const startInstant = targetHasTime
    ? new Date(target)
    : originalStart
      ? new Date(aucklandInstantMs(targetDay, aucklandParts(originalStart).time))
      : new Date(aucklandInstantMs(targetDay, "09:00:00"));
  const start = aucklandParts(startInstant);
  const end = aucklandParts(new Date(startInstant.getTime() + durationMs));
  return {
    start: { dateTime: localDateTime(start.date, start.time), timeZone: TIME_ZONE },
    end: { dateTime: localDateTime(end.date, end.time), timeZone: TIME_ZONE },
  };
}

function aucklandInstantMs(date: string, time: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm, ss] = time.split(":").map(Number);
  const guess = Date.UTC(y!, m! - 1, d!, hh!, mm!, ss ?? 0);
  const offsetAt = (instant: number) => {
    const parts = aucklandParts(new Date(instant));
    const [py, pm, pd] = parts.date.split("-").map(Number);
    const [ph, pmin, ps] = parts.time.split(":").map(Number);
    return Date.UTC(py!, pm! - 1, pd!, ph!, pmin!, ps!) - instant;
  };
  let instant = guess - offsetAt(guess);
  instant = guess - offsetAt(instant);
  return instant;
}

export type CalendarChange = {
  /** New calendarStart (date key or ISO instant), when the task moved. */
  start?: string;
  task?: string;
  notes?: string;
  location?: string;
};

function eventPath(calendarId: string, eventId: string): string {
  return `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
}

async function readError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: { message?: string; errors?: Array<{ reason?: string }> } } | null;
  const reason = body?.error?.errors?.[0]?.reason ?? "";
  if (response.status === 403 && /insufficient|scope/i.test(`${reason} ${body?.error?.message ?? ""}`)) {
    return "The farm Google account has not allowed calendar changes yet. Open /api/google/connect once to grant it.";
  }
  if (response.status === 403 || response.status === 404) {
    return "This calendar can't be changed from the planner (no edit access to it). Move it in Google Calendar instead.";
  }
  return body?.error?.message ? `Google Calendar: ${body.error.message}` : `Google Calendar update failed (${response.status}).`;
}

/** Patch the source event; returns the task fields that mirror the updated event. */
export async function writeBackToCalendar(task: SheetTask, change: CalendarChange): Promise<Partial<SheetTask>> {
  if (task.source !== "Google Calendar") return {};
  const ids = parseCalendarEventId(task.calendarEventId);
  if (!ids) {
    throw new CalendarWritebackError("This task comes from the read-only Hirshberg public calendar feed. Change it in Google Calendar instead.");
  }
  const connectors = new GoogleConnectors();
  const path = eventPath(ids.calendarId, ids.eventId);
  const current = await connectors.proxy("google-calendar", path, { method: "GET" });
  if (!current.ok) throw new CalendarWritebackError(await readError(current), current.status === 403 ? 403 : 400);
  const event = (await current.json()) as GoogleEvent;

  const patch: Record<string, unknown> = {};
  if (change.start) Object.assign(patch, movedEventTimes(event, change.start));
  if (change.task !== undefined && change.task.trim() && change.task.trim() !== (event.summary ?? "").trim()) patch.summary = change.task.trim();
  if (change.notes !== undefined && change.notes.trim() !== (event.description ?? "").trim()) patch.description = change.notes;
  if (change.location !== undefined && change.location.trim() !== (event.location ?? "").trim()) patch.location = change.location;
  if (!Object.keys(patch).length) return {};

  const response = await connectors.proxy("google-calendar", `${path}?sendUpdates=none`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new CalendarWritebackError(await readError(response), response.status === 403 ? 403 : 400);
  const updated = (await response.json()) as GoogleEvent;

  // Mirror exactly what the calendar sync would store, so it sees no change.
  const start = updated.start?.dateTime ?? updated.start?.date ?? task.calendarStart;
  const startDay = updated.start?.date ?? (updated.start?.dateTime ? aucklandParts(new Date(updated.start.dateTime)).date : "");
  return {
    ...(patch.start ? { calendarStart: start, scheduledDates: startDay ? [startDay] : [], month: startDay.slice(0, 7) } : {}),
    ...(patch.summary ? { task: updated.summary ?? task.task } : {}),
    ...(patch.description !== undefined ? { notes: updated.description ?? "" } : {}),
    ...(patch.location !== undefined ? { location: updated.location ?? "" } : {}),
    calendarUpdated: updated.updated ?? task.calendarUpdated,
  };
}
