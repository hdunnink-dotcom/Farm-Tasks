import {
  canonicalScheduledDates,
  createSheetTask,
  listSheetTasks,
  type SheetTask,
  updateSheetTask,
  legacySheetBackingEnabledForTests,
} from "./farm-sheet";
import { logger } from "./logger";
import { parseIcsCalendar } from "./ics";
import { CALENDAR_RATE_LIMIT_MESSAGE, requestGoogleCalendar } from "./calendar-request";

const CALENDAR_SOURCES = [
  { id: "primary", name: "Primary Google Calendar", group: "Admin", kind: "google-primary" },
  { id: "76df9141b280b413eca970598ec55d959234748546ff2ae920654df77c436a63@group.calendar.google.com", name: "Orchard Managment", group: "Orchards", kind: "google" },
  { id: "a2a1ce4d44d42bcc4fbc5c395a384fc19b4a8fe732a614be566ae1ac1a2fe4d1@group.calendar.google.com", name: "Pasture Management", group: "Planting", kind: "google" },
  { id: "info@yurtsforyou.co.nz", name: "Yurtsforyou", group: "Yurts", kind: "google" },
  { id: "14cab9ceb3faee5cd6cdceb5f21937ead7cbd7917bf057227a38021c48c96ca6@group.calendar.google.com", name: "Wwoofers", group: "Admin", kind: "google" },
  { id: "8d2776819bf8484b952aced80d790607121ab0ea4c4dd17adaea5068c95549fd@group.calendar.google.com", name: "Mahakaruna Classroom bookings", group: "Admin", kind: "google" },
  { id: "https://calendar.google.com/calendar/ical/harnold%40hirshberginstitute.com/public/basic.ics", name: "Hirshberg Institute", group: "Admin", kind: "ics" },
] as const;
const REGULAR_SYNC_INTERVAL_MS = 30 * 60 * 1000;
const FAILED_SYNC_RETRY_MS = 2 * 60 * 1000;

// These calendars were replaced rather than renamed. Keep this list explicit:
// only an event with the exact same Google event ID may take over its old row.
const RETIRED_CALENDAR_IDS_BY_NEW_ID: ReadonlyMap<string, readonly string[]> = new Map([
  [
    "76df9141b280b413eca970598ec55d959234748546ff2ae920654df77c436a63@group.calendar.google.com",
    ["c_b42da642624a92be69504f090c9ee09c66f97476265222ebd84182d3d180943b@group.calendar.google.com"],
  ],
  [
    "a2a1ce4d44d42bcc4fbc5c395a384fc19b4a8fe732a614be566ae1ac1a2fe4d1@group.calendar.google.com",
    ["c_051db4338f302689dbad4d9b6b171875567750e97993cf4b5e29b60cf3979d23@group.calendar.google.com"],
  ],
]);

type CalendarSource = (typeof CALENDAR_SOURCES)[number];

type CalendarSyncCounts = {
  created: number;
  updated: number;
  skipped: number;
  cancelled: number;
  errors: number;
};

export type CalendarSyncResult = CalendarSyncCounts & {
  syncedAt: string;
  calendars: Array<CalendarSyncCounts & { name: string; url?: string; state: "synced" | "error"; error?: string; warning?: string; unsupportedRrules?: number }>;
};

export type CalendarSourceLink = {
  name: string;
  url?: string;
  available: boolean;
  message?: string;
};

type CalendarEvent = {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  status?: string;
  updated?: string;
  recurringEventId?: string;
  start?: { dateTime?: string; date?: string };
};

let currentStatus: {
  state: "idle" | "syncing" | "error";
  lastSyncAt: string;
  lastError: string;
  sources: CalendarSourceLink[];
  result?: CalendarSyncResult;
} = {
  state: "idle",
  lastSyncAt: "",
  lastError: "",
  sources: CALENDAR_SOURCES.map((source) => ({
    name: source.name,
    available: false,
    message: "Calendar access has not been verified yet.",
  })),
};

function eventStart(event: CalendarEvent): string {
  return event.start?.dateTime ?? event.start?.date ?? "";
}

function isBeforeToday(value: string, now = new Date()): boolean {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const eventDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return eventDay < today;
}

function eventMonth(value: string): string {
  return value.match(/^(\d{4}-\d{2})/)?.[1] ?? "";
}

function eventIdentity(calendarId: string, eventId: string): string {
  return `${calendarId}:${eventId}`;
}

function startOfCurrentYear(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), 0, 1);
}

function normalizedEventTask(event: CalendarEvent, source: CalendarSource, calendarId: string): Partial<SheetTask> & Pick<SheetTask, "task"> {
  const start = eventStart(event);
  return {
    task: event.summary?.trim() || `Untitled ${source.name} event`,
    group: source.group,
    done: event.status === "cancelled" || isBeforeToday(start),
    urgency: "Medium",
    month: eventMonth(start),
    location: event.location?.trim() ?? "",
    // The provider description is synchronized as the event-owned notes field.
    notes: event.description?.trim() ?? "",
    link: event.htmlLink ?? "",
    subtasks: [],
    attachmentIds: [],
    source: "Google Calendar",
    calendarEventId: eventIdentity(calendarId, event.id ?? ""),
    calendarRecurringEventId: event.recurringEventId ? eventIdentity(calendarId, event.recurringEventId) : "",
    calendarStart: start,
    // Calendar imports always represent one occurrence. Supplying this on
    // every write prevents updateSheetTask from retaining an old crew/manual
    // scheduled date when the provider moves the event.
    scheduledDates: canonicalScheduledDates({
      calendarStart: start,
      source: "Google Calendar",
    }),
    calendarUpdated: event.updated ?? "",
  };
}

function calendarOwnedUpdate(next: ReturnType<typeof normalizedEventTask>): Partial<SheetTask> {
  return {
    task: next.task,
    month: next.month,
    // The linked Calendar description is authoritative for task notes.
    // Crew-owned progress, assignments, attachments, and location capture
    // are intentionally omitted from this update and remain unchanged.
    notes: next.notes,
    link: next.link,
    source: next.source,
    calendarEventId: next.calendarEventId,
    calendarRecurringEventId: next.calendarRecurringEventId,
    calendarStart: next.calendarStart,
    scheduledDates: next.scheduledDates,
    calendarUpdated: next.calendarUpdated,
  };
}

type AvailableCalendar = { id?: string; summary?: string; htmlLink?: string; primary?: boolean };

async function availableCalendars(): Promise<{ ids: Set<string>; availableNames: string[]; items: AvailableCalendar[] }> {
  const response = await requestGoogleCalendar("/calendar/v3/users/me/calendarList?maxResults=50");
  if (!response.ok) throw new Error(`Calendar list request failed (${response.status}).`);
  const body = (await response.json()) as { items?: AvailableCalendar[] };
  const availableNames = (body.items ?? [])
    .map((item) => item.summary?.trim())
    .filter((name): name is string => Boolean(name));
  return {
    ids: new Set((body.items ?? []).flatMap((item) => item.id ? [item.id] : [])),
    availableNames,
    items: body.items ?? [],
  };
}

function calendarSourceUrl(source: CalendarSource, items: AvailableCalendar[]): string | undefined {
  if (source.kind === "ics") {
    try {
      const url = new URL(source.id);
      return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
    } catch {
      return undefined;
    }
  }
  const available = source.kind === "google-primary"
    ? items.find((item) => item.primary === true)
    : items.find((item) => item.id === source.id);
  if (!available) return undefined;
  if (available.htmlLink) return available.htmlLink;
  return source.kind === "google-primary"
    ? "https://calendar.google.com/calendar/u/0/r"
    : `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(source.id)}`;
}

async function calendarEvents(calendarId: string): Promise<CalendarEvent[]> {
  const events: CalendarEvent[] = [];
  const now = new Date();
  const timeMin = startOfCurrentYear().toISOString();
  const timeMax = new Date(Date.UTC(now.getUTCFullYear() + 5, 11, 31, 23, 59, 59)).toISOString();
  let pageToken = "";
  do {
    const query = new URLSearchParams({ singleEvents: "true", orderBy: "startTime", showDeleted: "true", timeMin, timeMax, maxResults: "2500" });
    if (pageToken) query.set("pageToken", pageToken);
    const response = await requestGoogleCalendar(`/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${query}`);
    if (!response.ok) throw new Error(`Calendar events request failed (${response.status}).`);
    const body = (await response.json()) as { items?: CalendarEvent[]; nextPageToken?: string };
    events.push(...(body.items ?? []));
    pageToken = body.nextPageToken ?? "";
  } while (pageToken);
  return events;
}

async function icsEvents(source: CalendarSource): Promise<{ events: CalendarEvent[]; errors: number; unsupportedRrules: number }> {
  const response = await fetch(source.id);
  if (!response.ok) throw new Error(`Hirshberg ICS feed request failed (${response.status}).`);
  const parsed = parseIcsCalendar(await response.text());
  const events = parsed.events.map((event) => ({
    // UID plus RECURRENCE-ID distinguishes the feed's already-expanded instances stably.
    id: `${event.uid}:${event.recurrenceId ?? event.start ?? ""}`,
    summary: event.summary,
    description: event.description,
    location: event.location,
    htmlLink: event.url || source.id,
    status: event.status,
    updated: event.lastModified ?? event.dtstamp ?? "",
    recurringEventId: event.recurrenceId ? event.uid : undefined,
    start: event.start?.includes("T") ? { dateTime: event.start } : event.start ? { date: event.start } : {},
  }));
  return { events, errors: parsed.errors, unsupportedRrules: parsed.unsupportedRrules };
}

function eventChanged(existing: SheetTask, next: ReturnType<typeof normalizedEventTask>): boolean {
  return existing.calendarUpdated !== next.calendarUpdated
    || existing.task !== next.task
    || existing.group !== next.group
    || existing.month !== next.month
    || existing.location !== next.location
    || existing.notes !== next.notes
    || existing.link !== next.link
    || existing.calendarStart !== next.calendarStart
    || existing.calendarRecurringEventId !== next.calendarRecurringEventId
    || JSON.stringify(existing.scheduledDates) !== JSON.stringify(next.scheduledDates);
}

const emptyCounts = (): CalendarSyncCounts => ({ created: 0, updated: 0, skipped: 0, cancelled: 0, errors: 0 });

async function syncSource(source: CalendarSource, calendarId: string, tasks: SheetTask[], loaded?: { events: CalendarEvent[]; errors: number }): Promise<CalendarSyncCounts> {
  const counts = { ...emptyCounts(), errors: loaded?.errors ?? 0 };
  const existingByEventId = new Map(tasks.filter((task) => task.calendarEventId).map((task) => [task.calendarEventId, task]));
  for (const event of loaded?.events ?? await calendarEvents(calendarId)) {
    if (!event.id) {
      counts.errors += 1;
      continue;
    }
    try {
      const next = normalizedEventTask(event, source, calendarId);
      const sourceEventId = eventIdentity(calendarId, event.id);
       // A replacement calendar can take over only its explicitly mapped
       // predecessor's identical event ID. Other retired rows are history.
      const existing = existingByEventId.get(sourceEventId)
         ?? RETIRED_CALENDAR_IDS_BY_NEW_ID.get(calendarId)
           ?.map((retiredCalendarId) => existingByEventId.get(eventIdentity(retiredCalendarId, event.id!)))
           .find((task): task is SheetTask => Boolean(task));
      if (!existing) {
        await createSheetTask({
          ...next,
          id: source.kind === "ics"
            ? `ics-${encodeURIComponent(calendarId)}-${encodeURIComponent(event.id)}`
            : `gcal-${calendarId}-${event.id}`,
        });
        counts.created += 1;
      } else if (event.status === "cancelled") {
        if (eventChanged(existing, next) || existing.calendarEventId !== next.calendarEventId || !existing.done) {
          // Cancellation is authoritative even when the provider supplied no
          // timestamp/content change (a common Google and ICS feed behavior).
          await updateSheetTask(existing.id, { ...calendarOwnedUpdate(next), done: true });
          counts.cancelled += 1;
        } else {
          counts.skipped += 1;
        }
      } else if (eventChanged(existing, next) || existing.calendarEventId !== sourceEventId) {
        await updateSheetTask(existing.id, calendarOwnedUpdate(next));
        counts.updated += 1;
      } else {
        counts.skipped += 1;
      }
    } catch (error) {
      counts.errors += 1;
      logger.warn({
        err: error,
        calendarName: source.name,
        eventId: event.id,
      }, "Could not import Google Calendar event");
    }
  }
  return counts;
}

export async function syncOrchardCalendar(): Promise<CalendarSyncResult> {
  if (currentStatus.state === "syncing") throw new Error("A calendar sync is already running.");
  currentStatus = { ...currentStatus, state: "syncing", lastError: "" };
  const syncedAt = new Date().toISOString();
  const result: CalendarSyncResult = { ...emptyCounts(), syncedAt, calendars: [] };
  try {
    const tasks = await listSheetTasks();
    const { ids, availableNames, items } = await availableCalendars();
    for (const source of CALENDAR_SOURCES) {
      // The connected account's own calendar. On Replit that was the Yurts For
      // You account; with the Hirshberg account connected it would pull in
      // personal meetings, so hosts can switch it off.
      if (source.kind === "google-primary" && process.env.FARM_SYNC_PRIMARY_CALENDAR === "false") continue;
      const calendarId = source.id;
      const sourceUrl = calendarSourceUrl(source, items);
      if (source.kind !== "ics" && source.kind !== "google-primary" && !ids.has(calendarId)) {
        const visibleCalendars = availableNames.length ? availableNames.join(", ") : "none";
        const error = `The configured calendar "${source.name}" is not shared with the connected account. Calendars currently visible: ${visibleCalendars}.`;
        result.errors += 1;
        result.calendars.push({ name: source.name, ...emptyCounts(), errors: 1, state: "error", error });
        continue;
      }
      try {
        const loaded = source.kind === "ics" ? await icsEvents(source) : undefined;
        const counts = await syncSource(source, calendarId, tasks, loaded);
        Object.keys(counts).forEach((key) => { result[key as keyof CalendarSyncCounts] += counts[key as keyof CalendarSyncCounts]; });
        result.calendars.push({
          name: source.name, ...(sourceUrl ? { url: sourceUrl } : {}), ...counts, state: counts.errors ? "error" : "synced",
          ...(counts.errors ? { error: "One or more events could not be imported." } : {}),
          ...(loaded?.unsupportedRrules ? {
            unsupportedRrules: loaded.unsupportedRrules,
            warning: `${loaded.unsupportedRrules} unsupported RRULE master${loaded.unsupportedRrules === 1 ? "" : "s"} skipped; expanded instances were imported.`,
          } : {}),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Calendar synchronization failed.";
        result.errors += 1;
        result.calendars.push({
          name: source.name,
          ...(sourceUrl ? { url: sourceUrl } : {}),
          ...emptyCounts(),
          errors: 1,
          state: "error",
          error: message,
        });
      }
    }
    const hasErrors = result.errors > 0;
    const hasRateLimit = result.calendars.some((calendar) => calendar.error === CALENDAR_RATE_LIMIT_MESSAGE);
    currentStatus = {
      state: hasErrors ? "error" : "idle",
      lastSyncAt: syncedAt,
      lastError: hasRateLimit
        ? CALENDAR_RATE_LIMIT_MESSAGE
        : hasErrors ? "One or more calendars could not be fully imported." : "",
      sources: result.calendars.map((calendar) => ({
        name: calendar.name,
        ...(calendar.url ? { url: calendar.url } : {}),
        available: Boolean(calendar.url),
        ...(!calendar.url ? { message: calendar.error ?? "No usable agenda destination is available." } : {}),
      })),
      result,
    };
    return result;
  } catch (error) {
    currentStatus = {
      ...currentStatus,
      state: "error",
      lastError: error instanceof Error && error.message === CALENDAR_RATE_LIMIT_MESSAGE
        ? CALENDAR_RATE_LIMIT_MESSAGE
        : error instanceof Error ? error.message : "Calendar synchronization failed.",
    };
    throw error;
  }
}

export function getOrchardCalendarStatus() {
  return currentStatus;
}

export function startOrchardCalendarSchedule(): void {
  const run = async (): Promise<void> => {
    let nextDelay = REGULAR_SYNC_INTERVAL_MS;
    try {
      const result = await syncOrchardCalendar();
      logger.info({
        syncedAt: result.syncedAt,
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        cancelled: result.cancelled,
        errors: result.errors,
      }, "Scheduled calendar synchronization completed");
    } catch (error) {
      nextDelay = FAILED_SYNC_RETRY_MS;
      logger.warn({ err: error, retryInMs: nextDelay }, "Scheduled calendar synchronization failed");
    } finally {
      setTimeout(() => void run(), nextDelay).unref();
    }
  };
  void run();
}