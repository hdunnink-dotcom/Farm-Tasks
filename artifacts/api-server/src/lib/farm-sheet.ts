import { GoogleConnectors } from "./google-connectors";
import { withTaskCreationLock } from "./task-idempotency";
import { normalizeConfiguredTaskCategory } from "./task-categories";
import { logger } from "./logger";
import {
  appendAuthoritativeCompletion,
  createAuthoritativeTask,
  deleteAuthoritativeTask,
  findAuthoritativeTask,
  listAuthoritativeCompletions,
  listAuthoritativeTasks,
  migrateAuthoritativeTaskAssignee,
  updateAuthoritativeTask,
  importLegacySheetData,
} from "./task-repository";

const SPREADSHEET_ID =
  process.env.FARM_TASK_SHEET_ID ??
  "1wb0i3-NVEyoUBoSzzoiw6KE_qS3nxeOT6E8vbpmzPwQ";
const AUTH_RETRY_DELAY_MS = 250;

const REQUIRED_HEADERS = [
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
  "Repeat Weekly",
  "Review Status",
  "Submitted By Clerk ID",
  "Submitted By Name",
  "Review Note",
  "Reviewed At",
  "Assignee Clerk IDs",
  "Assignee Names",
  "Recurrence",
  "Scheduled Dates",
];

const COMPLETION_SHEET_NAME = "Completion History";
const COMPLETION_HEADERS = [
  "Completion Event ID",
  "Task ID",
  "Task",
  "Scheduled Date",
  "Completed At",
  "Completed By Clerk ID",
  "Completed By Name",
  "Group",
  "Location/Block",
  "Source",
  "Recurrence",
  "Assignee Clerk IDs",
  "Assignee Names",
];

export type SheetSubtask = { id: string; title: string; done: boolean };
export const TASK_RECURRENCES = ["none", "weekly", "biweekly", "every4weeks", "monthly", "quarterly", "yearly"] as const;
export type TaskRecurrence = typeof TASK_RECURRENCES[number];

export type SheetTask = {
  id: string;
  group: string;
  task: string;
  done: boolean;
  urgency: "Urgent" | "High" | "Medium" | "Low";
  month: string;
  location: string;
  latitude: number | null;
  longitude: number | null;
  locationCapturedAt: string;
  atlasLink: string;
  notes: string;
  link: string;
  subtasks: SheetSubtask[];
  attachmentIds: string[];
  source: "Manual" | "Google Calendar";
  calendarEventId: string;
  calendarRecurringEventId: string;
  calendarStart: string;
  /** Canonical sorted Auckland date keys. calendarStart remains the legacy anchor. */
  scheduledDates?: string[];
  calendarUpdated: string;
  updatedAt: string;
  assigneeId: string;
  assigneeName: string;
  assigneeIds?: string[];
  assigneeNames?: string[];
  /** Manual recurrence is stored on each materialized occurrence. */
  recurrence?: TaskRecurrence;
  /** @deprecated Legacy weekly-only Sheet column and API field. */
  repeatWeekly: boolean;
  reviewStatus?: "approved" | "pending" | "rejected";
  submittedById?: string;
  submittedByName?: string;
  reviewNote?: string;
  reviewedAt?: string;
};

export type CompletionRecord = {
  eventId: string;
  taskId: string;
  taskTitle: string;
  scheduledDate: string;
  completedAt: string;
  completedById: string;
  completedByName: string;
  group: string;
  location: string;
  source: SheetTask["source"];
  recurrence: TaskRecurrence;
  assigneeIds: string[];
  assigneeNames: string[];
};

type SheetSnapshot = {
  sheetId?: number;
  sheetName: string;
  columnCount?: number;
  header: string[];
  rows: string[][];
};

let snapshotCache: { value: SheetSnapshot; expiresAt: number } | null = null;
let snapshotInFlight: Promise<SheetSnapshot> | null = null;
let nextSheetWriteAt = 0;
let sheetWriteQueue = Promise.resolve();
let knownColumnCount = 0;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function paceSheetWrite(): Promise<void> {
  const interval = process.env.FARM_SHEET_DISABLE_PACING === "true" ? 0 : 1_100;
  const scheduled = sheetWriteQueue.then(async () => {
    const delay = Math.max(0, nextSheetWriteAt - Date.now());
    if (delay) await wait(delay);
    nextSheetWriteAt = Date.now() + interval;
  });
  sheetWriteQueue = scheduled.catch(() => undefined);
  await scheduled;
}

function escapeRange(range: string): string {
  return encodeURIComponent(range);
}

async function sheetsRequest(
  path: string,
  options?: { method?: string; body?: unknown },
): Promise<Response> {
  const connectors = new GoogleConnectors();
  const method = options?.method ?? "GET";
  const isWrite = method !== "GET";
  const attempts = 6;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (isWrite) await paceSheetWrite();
    const response = await connectors.proxy("google-sheet", path, {
      method,
      headers: options?.body ? { "content-type": "application/json" } : undefined,
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });
    const transientAuthorizationFailure = response.status === 401 && attempt === 0;
    if (response.status !== 429 && response.status < 500 && !transientAuthorizationFailure) return response;
    if (attempt + 1 === attempts) return response;
    if (transientAuthorizationFailure) {
      await wait(AUTH_RETRY_DELAY_MS);
      continue;
    }
    const retryAfter = Number(response.headers.get("retry-after"));
    await wait(Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1_000
      : Math.min(30_000, 1_000 * 2 ** attempt));
  }
  throw new Error("Google Sheets request retry loop ended unexpectedly.");
}

type WorksheetProperties = { sheetId?: number; sheetName: string; columnCount?: number };

async function listSheetProperties(): Promise<WorksheetProperties[]> {
  const response = await sheetsRequest(
    `/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties`,
  );
  if (!response.ok) {
    throw new Error(`Google Sheets metadata request failed (${response.status})`);
  }

  const body = (await response.json()) as {
    sheets?: Array<{
      properties?: {
        sheetId?: number;
        title?: string;
        gridProperties?: { columnCount?: number };
      };
    }>;
  };
  return (body.sheets ?? []).flatMap(({ properties }) => properties?.title ? [{
    sheetId: properties.sheetId,
    sheetName: properties.title,
    columnCount: properties.gridProperties?.columnCount,
  }] : []);
}

async function getSheetProperties(): Promise<WorksheetProperties> {
  const properties = (await listSheetProperties())[0];
  if (!properties?.sheetName) {
    throw new Error("No worksheet was found in the connected task spreadsheet.");
  }
  const columnCount = properties.columnCount;
  if (columnCount) knownColumnCount = Math.max(knownColumnCount, columnCount);
  return properties;
}

async function readSnapshot(): Promise<SheetSnapshot> {
  if (snapshotCache && snapshotCache.expiresAt > Date.now()) return snapshotCache.value;
  if (snapshotInFlight) return snapshotInFlight;

  snapshotInFlight = (async () => {
    const properties = await getSheetProperties();
    const response = await sheetsRequest(
    `/v4/spreadsheets/${SPREADSHEET_ID}/values/${escapeRange(`${properties.sheetName}!A:AG`)}`,
    );
    if (!response.ok) {
      throw new Error(`Google Sheets values request failed (${response.status})`);
    }

    const body = (await response.json()) as { values?: unknown[][] };
    const values = (body.values ?? []).map((row) => row.map((cell) => String(cell ?? "")));
    const snapshot = {
      ...properties,
      header: values[0] ?? [],
      rows: values.slice(1),
    };
    snapshotCache = { value: snapshot, expiresAt: Date.now() + 500 };
    return snapshot;
  })();

  try {
    return await snapshotInFlight;
  } finally {
    snapshotInFlight = null;
  }
}

function invalidateSnapshotCache(): void {
  snapshotCache = null;
}

function normalizedHeader(header: string): string {
  return header.trim().toLowerCase();
}

function headerIndex(header: string[], name: string): number {
  return header.findIndex((item) => normalizedHeader(item) === normalizedHeader(name));
}

function getCell(row: string[], header: string[], names: string[]): string {
  for (const name of names) {
    const index = headerIndex(header, name);
    if (index >= 0) return row[index] ?? "";
  }
  return "";
}

function parseDone(value: string): boolean {
  return ["true", "yes", "done", "1", "✓"].includes(value.trim().toLowerCase());
}

function parseRecurrence(value: string, legacyWeekly: boolean): TaskRecurrence {
  const recurrence = value.trim().toLowerCase() as TaskRecurrence;
  return TASK_RECURRENCES.includes(recurrence) ? recurrence : legacyWeekly ? "weekly" : "none";
}

function normalizeReviewStatus(value: string): SheetTask["reviewStatus"] {
  const status = value.trim().toLowerCase();
  return status === "pending" || status === "rejected" ? status : "approved";
}

function parseCoordinate(value: string): number | null {
  if (!value.trim()) return null;
  const coordinate = Number(value);
  return Number.isFinite(coordinate) ? coordinate : null;
}

function normalizeUrgency(value: string): SheetTask["urgency"] {
  const lower = value.trim().toLowerCase();
  if (lower === "urgent" || lower === "critical") return "Urgent";
  if (lower === "high") return "High";
  if (lower === "low") return "Low";
  return "Medium";
}

function stableSubtaskId(index: number, title: string): string {
  return `step-${index}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "work"}`;
}

function parseSubtasks(raw: string): SheetSubtask[] {
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .map((item, index) => {
          if (typeof item === "string") {
            const title = item.trim();
            return title ? { id: stableSubtaskId(index, title), title, done: false } : null;
          }
          if (item && typeof item === "object") {
            const value = item as { id?: unknown; title?: unknown; done?: unknown };
            const title = typeof value.title === "string" ? value.title.trim() : "";
            return title
              ? { id: typeof value.id === "string" && value.id ? value.id : stableSubtaskId(index, title), title, done: value.done === true }
              : null;
          }
          return null;
        })
        .filter((item): item is SheetSubtask => item !== null);
    }
  } catch {
    // Legacy rows use a pipe-separated list and are migrated on their next write.
  }
  return raw.split("|").map((title, index) => {
    const value = title.trim();
    return value ? { id: stableSubtaskId(index, value), title: value, done: false } : null;
  }).filter((item): item is SheetSubtask => item !== null);
}

function parseList(raw: string): string[] {
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === "string" && Boolean(item));
  } catch {
    // Allow a simple comma separated cell for sheet edits.
  }
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}

function normalizedAssignments(
  assigneeIds: string[],
  assigneeNames: string[],
  legacyId = "",
  legacyName = "",
): { assigneeId: string; assigneeName: string; assigneeIds: string[]; assigneeNames: string[] } {
  const ids = assigneeIds.map((id) => id.trim()).filter(Boolean);
  if (!ids.length && legacyId.trim()) ids.push(legacyId.trim());
  const names = ids.map((_, index) => (assigneeNames[index] ?? (index === 0 ? legacyName : "")).trim());
  return {
    assigneeId: ids[0] ?? "",
    assigneeName: names[0] ?? "",
    assigneeIds: ids,
    assigneeNames: names,
  };
}

function monthFromCalendarStart(value: string): string {
  return value.match(/^(\d{4}-\d{2})/)?.[1] ?? "";
}

function validDateKey(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() === Number(match[2]) - 1
    && date.getUTCDate() === Number(match[3]);
}

function calendarDateKey(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(instant).reduce<Record<string, string>>((result, part) => {
    if (part.type !== "literal") result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function scheduledCalendarAnchor(
  calendarStart: string,
  scheduledDates: string[],
  scheduleProvided: boolean,
): string {
  if (!scheduleProvided) return calendarStart;
  if (!scheduledDates.length) return "";
  return calendarStart.includes("T") && scheduledDates.includes(calendarDateKey(calendarStart))
    ? calendarStart
    : scheduledDates[0] ?? "";
}

export function canonicalScheduledDates(input: {
  scheduledDates?: string[];
  calendarStart?: string;
  source?: SheetTask["source"];
  recurrence?: TaskRecurrence;
  repeatWeekly?: boolean;
}): string[] {
  const dates = [...new Set((input.scheduledDates ?? []).filter(validDateKey))].sort();
  const fallback = calendarDateKey(input.calendarStart ?? "");
  if (!dates.length && validDateKey(fallback)) dates.push(fallback);
  const recurrence = input.recurrence ?? (input.repeatWeekly ? "weekly" : "none");
  // Imported instances and recurring rows are a single occurrence, not a
  // manual linked-day schedule.
  return input.source === "Google Calendar" || recurrence !== "none" ? dates.slice(0, 1) : dates;
}

function toTask(row: string[], header: string[], rowNumber: number): SheetTask | null {
  const task = getCell(row, header, ["Task"]).trim();
  if (!task) return null;

  const dateValue = getCell(row, header, ["Updated At"]);
  const calendarStart = getCell(row, header, ["Calendar Start"]);
  const source = getCell(row, header, ["Source"]).trim() === "Google Calendar" ? "Google Calendar" : "Manual";
  const recurrence = parseRecurrence(
    getCell(row, header, ["Recurrence"]),
    parseDone(getCell(row, header, ["Repeat Weekly"])),
  );
  const assignments = normalizedAssignments(
    parseList(getCell(row, header, ["Assignee Clerk IDs", "Assignee IDs"])),
    parseList(getCell(row, header, ["Assignee Names"])),
    getCell(row, header, ["Assignee Clerk ID", "Assignee ID"]),
    getCell(row, header, ["Assignee Name", "Assignee"]),
  );
  return {
    id: getCell(row, header, ["Task ID"]).trim() || `sheet-row-${rowNumber}`,
    group: normalizeConfiguredTaskCategory(getCell(row, header, ["Group"])),
    task,
    done: parseDone(getCell(row, header, ["Done"])),
    urgency: normalizeUrgency(getCell(row, header, ["Urgency"])),
    month: getCell(row, header, ["Month"]).trim() || monthFromCalendarStart(calendarStart),
    location: getCell(row, header, ["Location/Block", "Location", "Block"]),
    latitude: parseCoordinate(getCell(row, header, ["Latitude"])),
    longitude: parseCoordinate(getCell(row, header, ["Longitude"])),
    locationCapturedAt: getCell(row, header, ["Location Captured At"]),
    atlasLink: getCell(row, header, ["Atlas Map Link", "Atlas Link"]),
    notes: getCell(row, header, ["Notes"]),
    link: getCell(row, header, ["Link"]),
    subtasks: parseSubtasks(getCell(row, header, ["Subtasks"])),
    attachmentIds: parseList(getCell(row, header, ["Attachment IDs"])),
    source,
    calendarEventId: getCell(row, header, ["Calendar Event ID"]),
    calendarRecurringEventId: getCell(row, header, ["Calendar Recurring Event ID"]),
    calendarStart,
    scheduledDates: canonicalScheduledDates({
      scheduledDates: parseList(getCell(row, header, ["Scheduled Dates"])),
      calendarStart,
      source,
      recurrence,
    }),
    calendarUpdated: getCell(row, header, ["Calendar Updated"]),
    updatedAt: dateValue || new Date(0).toISOString(),
    ...assignments,
      recurrence,
     repeatWeekly: parseDone(getCell(row, header, ["Repeat Weekly"])),
    reviewStatus: normalizeReviewStatus(getCell(row, header, ["Review Status"])),
    submittedById: getCell(row, header, ["Submitted By Clerk ID"]),
    submittedByName: getCell(row, header, ["Submitted By Name"]),
    reviewNote: getCell(row, header, ["Review Note"]),
    reviewedAt: getCell(row, header, ["Reviewed At"]),
  };
}

function taskToRow(task: SheetTask): string[] {
  return [
    task.id,
    task.group,
    task.task,
    task.done ? "TRUE" : "FALSE",
    task.urgency,
    task.month,
    task.location,
    task.latitude === null ? "" : String(task.latitude),
    task.longitude === null ? "" : String(task.longitude),
    task.locationCapturedAt,
    task.atlasLink,
    task.notes,
    task.link,
    JSON.stringify(task.subtasks),
    JSON.stringify(task.attachmentIds),
    task.source,
    task.calendarEventId,
    task.calendarRecurringEventId,
    task.calendarStart,
    task.calendarUpdated,
    task.updatedAt,
    task.assigneeId,
    task.assigneeName,
    task.repeatWeekly ? "TRUE" : "FALSE",
    task.reviewStatus ?? "approved",
    task.submittedById ?? "",
    task.submittedByName ?? "",
    task.reviewNote ?? "",
    task.reviewedAt ?? "",
    JSON.stringify(task.assigneeIds ?? (task.assigneeId ? [task.assigneeId] : [])),
    JSON.stringify(task.assigneeNames ?? (task.assigneeName ? [task.assigneeName] : [])),
    task.recurrence ?? (task.repeatWeekly ? "weekly" : "none"),
    JSON.stringify(canonicalScheduledDates(task)),
  ];
}

function completionToRow(record: CompletionRecord): string[] {
  return [
    record.eventId,
    record.taskId,
    record.taskTitle,
    record.scheduledDate,
    record.completedAt,
    record.completedById,
    record.completedByName,
    record.group,
    record.location,
    record.source,
    record.recurrence,
    JSON.stringify(record.assigneeIds),
    JSON.stringify(record.assigneeNames),
  ];
}

function toCompletionRecord(row: string[], header: string[]): CompletionRecord | null {
  const eventId = getCell(row, header, ["Completion Event ID"]).trim();
  const taskId = getCell(row, header, ["Task ID"]).trim();
  const completedAt = getCell(row, header, ["Completed At"]).trim();
  if (!eventId || !taskId || !completedAt) return null;
  return {
    eventId,
    taskId,
    taskTitle: getCell(row, header, ["Task"]),
    scheduledDate: getCell(row, header, ["Scheduled Date"]),
    completedAt,
    completedById: getCell(row, header, ["Completed By Clerk ID"]),
    completedByName: getCell(row, header, ["Completed By Name"]),
    group: getCell(row, header, ["Group"]),
    location: getCell(row, header, ["Location/Block"]),
    source: getCell(row, header, ["Source"]).trim() === "Google Calendar" ? "Google Calendar" : "Manual",
    recurrence: parseRecurrence(getCell(row, header, ["Recurrence"]), false),
    assigneeIds: parseList(getCell(row, header, ["Assignee Clerk IDs"])),
    assigneeNames: parseList(getCell(row, header, ["Assignee Names"])),
  };
}

function taskToBaseRow(task: SheetTask): string[] {
  return taskToRow(task).slice(0, 23);
}

async function ensureColumnCapacity(snapshot: SheetSnapshot, requiredColumns: number): Promise<SheetSnapshot> {
  const availableColumns = Math.max(snapshot.columnCount ?? 0, knownColumnCount);
  if (!snapshot.columnCount || snapshot.sheetId === undefined || availableColumns >= requiredColumns) {
    return {
      ...snapshot,
      columnCount: snapshot.columnCount ? availableColumns : undefined,
    };
  }

  const response = await sheetsRequest(
    `/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate`,
    {
      method: "POST",
      body: {
        requests: [{
          appendDimension: {
            sheetId: snapshot.sheetId,
            dimension: "COLUMNS",
            length: requiredColumns - availableColumns,
          },
        }],
      },
    },
  );
  if (!response.ok) {
    throw new Error(`Google Sheets column expansion failed (${response.status})`);
  }
  knownColumnCount = requiredColumns;
  return { ...snapshot, columnCount: requiredColumns };
}

async function ensurePlannerHeader(snapshot: SheetSnapshot): Promise<SheetSnapshot> {
  const existing = snapshot.header.map(normalizedHeader);
  const needsHeader = REQUIRED_HEADERS.some(
    (header) => !existing.includes(normalizedHeader(header)),
  );
  if (!needsHeader) return snapshot;

  snapshot = await ensureColumnCapacity(snapshot, REQUIRED_HEADERS.length);
  const migratedRows = snapshot.rows.map((row, index) => {
    const existing = toTask(row, snapshot.header, index + 2);
    return taskToRow(
      existing ?? {
        id: createId(),
        group: "Admin",
        task: "",
        done: false,
        urgency: "Medium",
        month: "",
        location: "",
        latitude: null,
        longitude: null,
        locationCapturedAt: "",
        atlasLink: "",
        notes: "",
        link: "",
        subtasks: [],
        attachmentIds: [],
        source: "Manual",
        calendarEventId: "",
        calendarRecurringEventId: "",
        calendarStart: "",
        scheduledDates: [],
        calendarUpdated: "",
        updatedAt: new Date().toISOString(),
        assigneeId: "",
        assigneeName: "",
        assigneeIds: [],
        assigneeNames: [],
        repeatWeekly: false,
        reviewStatus: "approved",
        submittedById: "",
        submittedByName: "",
        reviewNote: "",
        reviewedAt: "",
        recurrence: "none",
      },
    );
  });
  const range = `${snapshot.sheetName}!A1:W${Math.max(1, migratedRows.length + 1)}`;
  const response = await sheetsRequest(
    `/v4/spreadsheets/${SPREADSHEET_ID}/values/${escapeRange(range)}?valueInputOption=RAW`,
    { method: "PUT", body: { values: [REQUIRED_HEADERS.slice(0, 23), ...migratedRows.map((row) => row.slice(0, 23))] } },
  );
  if (!response.ok) {
    throw new Error(`Google Sheets header update failed (${response.status})`);
  }
  const repeatResponse = await sheetsRequest(
    `/v4/spreadsheets/${SPREADSHEET_ID}/values/${escapeRange(`${snapshot.sheetName}!X1:X${Math.max(1, migratedRows.length + 1)}`)}?valueInputOption=RAW`,
    { method: "PUT", body: { values: [[REQUIRED_HEADERS[23]], ...migratedRows.map((row) => [row[23] ?? "FALSE"])] } },
  );
  if (!repeatResponse.ok) throw new Error(`Google Sheets repeat column update failed (${repeatResponse.status})`);
  const reviewResponse = await sheetsRequest(
    `/v4/spreadsheets/${SPREADSHEET_ID}/values/${escapeRange(`${snapshot.sheetName}!Y1:AC${Math.max(1, migratedRows.length + 1)}`)}?valueInputOption=RAW`,
    { method: "PUT", body: { values: [REQUIRED_HEADERS.slice(24, 29), ...migratedRows.map((row) => row.slice(24, 29))] } },
  );
  if (!reviewResponse.ok) throw new Error(`Google Sheets review columns update failed (${reviewResponse.status})`);
  const assignmentsResponse = await sheetsRequest(
    `/v4/spreadsheets/${SPREADSHEET_ID}/values/${escapeRange(`${snapshot.sheetName}!AD1:AE${Math.max(1, migratedRows.length + 1)}`)}?valueInputOption=RAW`,
    { method: "PUT", body: { values: [REQUIRED_HEADERS.slice(29, 31), ...migratedRows.map((row) => row.slice(29, 31))] } },
  );
  if (!assignmentsResponse.ok) throw new Error(`Google Sheets assignment columns update failed (${assignmentsResponse.status})`);
  const recurrenceResponse = await sheetsRequest(
    `/v4/spreadsheets/${SPREADSHEET_ID}/values/${escapeRange(`${snapshot.sheetName}!AF1:AF${Math.max(1, migratedRows.length + 1)}`)}?valueInputOption=RAW`,
    { method: "PUT", body: { values: [[REQUIRED_HEADERS[31]], ...migratedRows.map((row) => [row[31] ?? "none"])] } },
  );
  if (!recurrenceResponse.ok) throw new Error(`Google Sheets recurrence column update failed (${recurrenceResponse.status})`);
  const scheduledDatesResponse = await sheetsRequest(
    `/v4/spreadsheets/${SPREADSHEET_ID}/values/${escapeRange(`${snapshot.sheetName}!AG1:AG${Math.max(1, migratedRows.length + 1)}`)}?valueInputOption=RAW`,
    { method: "PUT", body: { values: [[REQUIRED_HEADERS[32]], ...migratedRows.map((row) => [row[32] ?? "[]"])] } },
  );
  if (!scheduledDatesResponse.ok) throw new Error(`Google Sheets scheduled dates column update failed (${scheduledDatesResponse.status})`);
  invalidateSnapshotCache();
  return { ...snapshot, header: REQUIRED_HEADERS, rows: migratedRows };
}

async function ensureCompletionSheet(): Promise<WorksheetProperties> {
  const existing = (await listSheetProperties()).find(({ sheetName }) => sheetName === COMPLETION_SHEET_NAME);
  if (existing) return existing;
  const response = await sheetsRequest(
    `/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate`,
    {
      method: "POST",
      body: {
        requests: [{
          addSheet: {
            properties: {
              title: COMPLETION_SHEET_NAME,
              gridProperties: { columnCount: COMPLETION_HEADERS.length },
            },
          },
        }],
      },
    },
  );
  if (!response.ok) {
    throw new Error(`Google Sheets completion history creation failed (${response.status})`);
  }
  return { sheetName: COMPLETION_SHEET_NAME, columnCount: COMPLETION_HEADERS.length };
}

async function ensureCompletionHeader(sheetName: string): Promise<void> {
  const headerRange = `${sheetName}!A1:M1`;
  const readResponse = await sheetsRequest(
    `/v4/spreadsheets/${SPREADSHEET_ID}/values/${escapeRange(headerRange)}`,
  );
  if (!readResponse.ok) {
    throw new Error(`Google Sheets completion history header read failed (${readResponse.status})`);
  }
  const body = (await readResponse.json()) as { values?: unknown[][] };
  const current = (body.values?.[0] ?? []).map((cell) => String(cell ?? ""));
  const matches = COMPLETION_HEADERS.every((header, index) =>
    normalizedHeader(current[index] ?? "") === normalizedHeader(header));
  if (matches) return;
  const writeResponse = await sheetsRequest(
    `/v4/spreadsheets/${SPREADSHEET_ID}/values/${escapeRange(headerRange)}?valueInputOption=RAW`,
    { method: "PUT", body: { values: [COMPLETION_HEADERS] } },
  );
  if (!writeResponse.ok) {
    throw new Error(`Google Sheets completion history header update failed (${writeResponse.status})`);
  }
}

async function writeRow(sheetName: string, rowNumber: number, task: SheetTask): Promise<void> {
  const range = `${sheetName}!A${rowNumber}:W${rowNumber}`;
  const response = await sheetsRequest(
    `/v4/spreadsheets/${SPREADSHEET_ID}/values/${escapeRange(range)}?valueInputOption=RAW`,
    { method: "PUT", body: { values: [taskToBaseRow(task)] } },
  );
  if (!response.ok) {
    throw new Error(`Google Sheets task update failed (${response.status})`);
  }
  const repeatResponse = await sheetsRequest(
    `/v4/spreadsheets/${SPREADSHEET_ID}/values/${escapeRange(`${sheetName}!X${rowNumber}:X${rowNumber}`)}?valueInputOption=USER_ENTERED`,
    { method: "PUT", body: { values: [[task.repeatWeekly ? "TRUE" : "FALSE"]] } },
  );
  if (!repeatResponse.ok) throw new Error(`Google Sheets weekly repeat update failed (${repeatResponse.status})`);
  const reviewResponse = await sheetsRequest(
    `/v4/spreadsheets/${SPREADSHEET_ID}/values/${escapeRange(`${sheetName}!Y${rowNumber}:AC${rowNumber}`)}?valueInputOption=USER_ENTERED`,
    { method: "PUT", body: { values: [[task.reviewStatus, task.submittedById, task.submittedByName, task.reviewNote, task.reviewedAt]] } },
  );
  if (!reviewResponse.ok) throw new Error(`Google Sheets review update failed (${reviewResponse.status})`);
  const assignmentsResponse = await sheetsRequest(
    `/v4/spreadsheets/${SPREADSHEET_ID}/values/${escapeRange(`${sheetName}!AD${rowNumber}:AE${rowNumber}`)}?valueInputOption=USER_ENTERED`,
    { method: "PUT", body: { values: [[
      JSON.stringify(task.assigneeIds ?? (task.assigneeId ? [task.assigneeId] : [])),
      JSON.stringify(task.assigneeNames ?? (task.assigneeName ? [task.assigneeName] : [])),
    ]] } },
  );
  if (!assignmentsResponse.ok) throw new Error(`Google Sheets assignments update failed (${assignmentsResponse.status})`);
  const recurrenceResponse = await sheetsRequest(
    `/v4/spreadsheets/${SPREADSHEET_ID}/values/${escapeRange(`${sheetName}!AF${rowNumber}:AF${rowNumber}`)}?valueInputOption=USER_ENTERED`,
    { method: "PUT", body: { values: [[task.recurrence]] } },
  );
  if (!recurrenceResponse.ok) throw new Error(`Google Sheets recurrence update failed (${recurrenceResponse.status})`);
  const scheduledDatesResponse = await sheetsRequest(
    `/v4/spreadsheets/${SPREADSHEET_ID}/values/${escapeRange(`${sheetName}!AG${rowNumber}:AG${rowNumber}`)}?valueInputOption=USER_ENTERED`,
    { method: "PUT", body: { values: [[JSON.stringify(canonicalScheduledDates(task))]] } },
  );
  if (!scheduledDatesResponse.ok) throw new Error(`Google Sheets scheduled dates update failed (${scheduledDatesResponse.status})`);
  invalidateSnapshotCache();
}

async function readRow(sheetName: string, rowNumber: number): Promise<string[]> {
  // Assignment migration owns only assignee cells, so it need not depend on
  // the appended Scheduled Dates column when reading a legacy row.
  const range = `${sheetName}!A${rowNumber}:AF${rowNumber}`;
  const response = await sheetsRequest(
    `/v4/spreadsheets/${SPREADSHEET_ID}/values/${escapeRange(range)}`,
  );
  if (!response.ok) {
    throw new Error(`Google Sheets task row read failed (${response.status})`);
  }
  const body = (await response.json()) as { values?: unknown[][] };
  return (body.values?.[0] ?? []).map((cell) => String(cell ?? ""));
}

async function writeAssigneeCells(
  sheetName: string,
  rowNumber: number,
  updatedAt: string,
  assigneeIds: string[],
  assigneeNames: string[],
): Promise<void> {
  const range = `${sheetName}!U${rowNumber}:W${rowNumber}`;
  const response = await sheetsRequest(
    `/v4/spreadsheets/${SPREADSHEET_ID}/values/${escapeRange(range)}?valueInputOption=USER_ENTERED`,
    { method: "PUT", body: { values: [[updatedAt, assigneeIds[0] ?? "", assigneeNames[0] ?? ""]] } },
  );
  if (!response.ok) {
    throw new Error(`Google Sheets assignee update failed (${response.status})`);
  }
  const arraysResponse = await sheetsRequest(
    `/v4/spreadsheets/${SPREADSHEET_ID}/values/${escapeRange(`${sheetName}!AD${rowNumber}:AE${rowNumber}`)}?valueInputOption=USER_ENTERED`,
    { method: "PUT", body: { values: [[JSON.stringify(assigneeIds), JSON.stringify(assigneeNames)]] } },
  );
  if (!arraysResponse.ok) throw new Error(`Google Sheets assignee list update failed (${arraysResponse.status})`);
  invalidateSnapshotCache();
}

function createId(): string {
  return `farm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function listSheetTasksSheetBacking(): Promise<SheetTask[]> {
  const snapshot = await readSnapshot();
  return snapshot.rows
    .map((row, index) => toTask(row, snapshot.header, index + 2))
    .filter((task): task is SheetTask => task !== null);
}

export async function listCompletionRecordsSheetBacking(): Promise<CompletionRecord[]> {
  const sheet = (await listSheetProperties()).find(({ sheetName }) => sheetName === COMPLETION_SHEET_NAME);
  if (!sheet) return [];
  const response = await sheetsRequest(
    `/v4/spreadsheets/${SPREADSHEET_ID}/values/${escapeRange(`${sheet.sheetName}!A:M`)}`,
  );
  if (!response.ok) {
    throw new Error(`Google Sheets completion history read failed (${response.status})`);
  }
  const body = (await response.json()) as { values?: unknown[][] };
  const values = (body.values ?? []).map((row) => row.map((cell) => String(cell ?? "")));
  const header = values[0] ?? [];
  return values.slice(1)
    .map((row) => toCompletionRecord(row, header))
    .filter((record): record is CompletionRecord => record !== null);
}

export async function appendCompletionRecordSheetBacking(record: CompletionRecord): Promise<CompletionRecord> {
  return withTaskCreationLock("farm-sheet-completion-history", async () => {
    const existing = (await listCompletionRecordsSheetBacking()).find(({ eventId }) => eventId === record.eventId);
    if (existing) return existing;
    const sheet = await ensureCompletionSheet();
    await ensureCompletionHeader(sheet.sheetName);
    const response = await sheetsRequest(
      `/v4/spreadsheets/${SPREADSHEET_ID}/values/${escapeRange(`${sheet.sheetName}!A:M`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { method: "POST", body: { values: [completionToRow(record)] } },
    );
    if (!response.ok) {
      throw new Error(`Google Sheets completion history append failed (${response.status})`);
    }
    return record;
  });
}

export function taskAssignedTo(task: { assigneeIds?: string[]; assigneeId?: string }, memberId: string): boolean {
  return task.assigneeIds?.includes(memberId) === true || task.assigneeId === memberId;
}

const SHEET_WRITE_READ_ATTEMPTS = 3;
const SHEET_WRITE_READ_DELAY_MS = 150;

function waitForSheetRead(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, SHEET_WRITE_READ_DELAY_MS));
}

/**
 * Confirms a just-written task is available through the same read path used
 * by the task API. Google Sheets can briefly serve a stale values snapshot
 * after an append, so retry only the bounded read-after-write window.
 */
export async function findSheetTaskSheetBacking(id: string, options?: { verifyWrite?: boolean }): Promise<SheetTask | undefined> {
  const attempts = options?.verifyWrite ? SHEET_WRITE_READ_ATTEMPTS : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    invalidateSnapshotCache();
    const task = (await listSheetTasksSheetBacking()).find((item) => item.id === id);
    if (task) return task;
    if (attempt + 1 < attempts) await waitForSheetRead();
  }
  return undefined;
}

export async function createSheetTaskSheetBacking(
  input: Partial<Omit<SheetTask, "updatedAt">> & Pick<SheetTask, "task">,
): Promise<SheetTask> {
  return withTaskCreationLock("farm-sheet-task-creation", () => createSheetTaskOnce(input));
}

async function createSheetTaskOnce(
  input: Partial<Omit<SheetTask, "updatedAt">> & Pick<SheetTask, "task">,
): Promise<SheetTask> {
  const snapshot = await ensurePlannerHeader(await readSnapshot());
  if (input.id) {
    const existing = snapshot.rows
      .map((row, index) => toTask(row, snapshot.header, index + 2))
      .find((task) => task?.id === input.id);
    if (existing) return existing;
  }
  const scheduledDates = canonicalScheduledDates(input);
  const task: SheetTask = {
    id: input.id ?? createId(),
    group: normalizeConfiguredTaskCategory(input.group),
    task: input.task.trim(),
    done: input.done ?? false,
    urgency: input.urgency ?? "Medium",
    month: input.month ?? "",
    location: input.location ?? "",
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    locationCapturedAt: input.locationCapturedAt ?? "",
    atlasLink: input.atlasLink ?? "",
    notes: input.notes ?? "",
    link: input.link ?? "",
    subtasks: input.subtasks ?? [],
    attachmentIds: input.attachmentIds ?? [],
    source: input.source ?? "Manual",
    calendarEventId: input.calendarEventId ?? "",
    calendarRecurringEventId: input.calendarRecurringEventId ?? "",
    // Imported events retain their exact provider timestamp; scheduledDates is
    // its Auckland-day projection rather than a replacement calendar anchor.
    calendarStart: input.source === "Google Calendar"
      ? input.calendarStart ?? ""
      : scheduledCalendarAnchor(input.calendarStart ?? "", scheduledDates, input.scheduledDates !== undefined),
    scheduledDates,
    calendarUpdated: input.calendarUpdated ?? "",
    updatedAt: new Date().toISOString(),
    ...normalizedAssignments(
      input.assigneeIds ?? [],
      input.assigneeNames ?? [],
      input.assigneeId,
      input.assigneeName,
    ),
    recurrence: parseRecurrence(input.recurrence ?? "", input.repeatWeekly ?? false),
    repeatWeekly: input.repeatWeekly ?? input.recurrence === "weekly",
    reviewStatus: input.reviewStatus ?? "approved",
    submittedById: input.submittedById ?? "",
    submittedByName: input.submittedByName ?? "",
    reviewNote: input.reviewNote ?? "",
    reviewedAt: input.reviewedAt ?? "",
  };

  let lastTaskIndex = -1;
  for (let index = snapshot.rows.length - 1; index >= 0; index -= 1) {
    if (toTask(snapshot.rows[index] ?? [], snapshot.header, index + 2)) {
      lastTaskIndex = index;
      break;
    }
  }
  await writeRow(snapshot.sheetName, lastTaskIndex + 3, task);
  return task;
}

export async function updateSheetTaskSheetBacking(
  id: string,
  input: Partial<Omit<SheetTask, "id" | "updatedAt">>,
): Promise<SheetTask | null> {
  const snapshot = await ensurePlannerHeader(await readSnapshot());
  const rowIndex = snapshot.rows.findIndex((row, index) => {
    const task = toTask(row, snapshot.header, index + 2);
    return task?.id === id;
  });
  if (rowIndex < 0) return null;

  const current = toTask(snapshot.rows[rowIndex], snapshot.header, rowIndex + 2);
  if (!current) return null;
  const assignments = normalizedAssignments(
    input.assigneeIds ?? (input.assigneeId !== undefined ? [] : current.assigneeIds ?? []),
    input.assigneeNames ?? (input.assigneeName !== undefined ? [] : current.assigneeNames ?? []),
    input.assigneeId ?? (input.assigneeIds === undefined ? current.assigneeId : ""),
    input.assigneeName ?? (input.assigneeNames === undefined ? current.assigneeName : ""),
  );
  const scheduledDates = canonicalScheduledDates({
    scheduledDates: input.scheduledDates ?? current.scheduledDates,
    calendarStart: input.calendarStart ?? current.calendarStart,
    source: input.source ?? current.source,
    recurrence: input.recurrence ?? current.recurrence,
    repeatWeekly: input.repeatWeekly ?? current.repeatWeekly,
  });
  const source = input.source ?? current.source;
  const updated: SheetTask = {
    ...current,
    ...input,
    id: current.id,
    task: input.task?.trim() ?? current.task,
    group: input.group === undefined ? normalizeConfiguredTaskCategory(current.group) : normalizeConfiguredTaskCategory(input.group),
    subtasks: input.subtasks ?? current.subtasks,
    attachmentIds: input.attachmentIds ?? current.attachmentIds,
    source,
    calendarEventId: input.calendarEventId ?? current.calendarEventId,
    calendarRecurringEventId: input.calendarRecurringEventId ?? current.calendarRecurringEventId,
    // As on creation, a Google Calendar scheduled date is a projection of
    // calendarStart, not an instruction to replace the original timestamp.
    calendarStart: source === "Google Calendar"
      ? input.calendarStart ?? current.calendarStart
      : scheduledCalendarAnchor(
        input.calendarStart ?? current.calendarStart,
        scheduledDates,
        input.scheduledDates !== undefined,
      ),
    scheduledDates,
    calendarUpdated: input.calendarUpdated ?? current.calendarUpdated,
    updatedAt: new Date().toISOString(),
    ...assignments,
    reviewStatus: input.reviewStatus ?? current.reviewStatus,
    submittedById: input.submittedById ?? current.submittedById,
    submittedByName: input.submittedByName ?? current.submittedByName,
    reviewNote: input.reviewNote ?? current.reviewNote,
    reviewedAt: input.reviewedAt ?? current.reviewedAt,
    recurrence: (() => {
      const currentRecurrence = parseRecurrence(current.recurrence ?? "", current.repeatWeekly);
      if (input.recurrence !== undefined) return parseRecurrence(input.recurrence, input.repeatWeekly ?? false);
      if (input.repeatWeekly === true) return "weekly";
      if (input.repeatWeekly === false && currentRecurrence === "weekly") return "none";
      return currentRecurrence;
    })(),
  };
  updated.repeatWeekly = updated.recurrence === "weekly";
  await writeRow(snapshot.sheetName, rowIndex + 2, updated);
  return updated;
}

/**
 * Moves assignments from an invitation's stable pending ID to its Clerk ID.
 * Rows are written independently: if a Sheets write fails, the member record
 * remains pending and a later attempt only processes the rows still carrying
 * the pending ID. This makes retries safe without overwriting task changes.
 */
export async function migrateSheetTaskAssignee(
  pendingAssigneeId: string | string[],
  clerkId: string,
  displayName: string,
): Promise<void> {
  if (!legacyBackingForTests) {
    await ensureAuthorityReady();
    await migrateAuthoritativeTaskAssignee(
      Array.isArray(pendingAssigneeId) ? pendingAssigneeId : [pendingAssigneeId],
      clerkId,
      displayName,
    );
    return;
  }
  const pendingIds = new Set(Array.isArray(pendingAssigneeId) ? pendingAssigneeId : [pendingAssigneeId]);
  const snapshot = await readSnapshot();
  for (let rowIndex = 0; rowIndex < snapshot.rows.length; rowIndex += 1) {
    const task = toTask(snapshot.rows[rowIndex] ?? [], snapshot.header, rowIndex + 2);
    if (!task || !(task.assigneeIds ?? [task.assigneeId]).some((id) => pendingIds.has(id))) continue;
    const rowNumber = rowIndex + 2;
    // The snapshot may be stale while an invitation is accepted. Re-read the
    // candidate and touch only assignment-owned cells so concurrent task edits
    // cannot be written back from the stale A:X snapshot.
    const current = toTask(await readRow(snapshot.sheetName, rowNumber), snapshot.header, rowNumber);
    if (!current || !(current.assigneeIds ?? [current.assigneeId]).some((id) => pendingIds.has(id))) continue;
    const currentIds = current.assigneeIds ?? [current.assigneeId];
    const currentNames = current.assigneeNames ?? [current.assigneeName];
    const migratedIds = currentIds.map((id) => pendingIds.has(id) ? clerkId : id);
    const migratedNames = migratedIds.map((_, index) =>
      pendingIds.has(currentIds[index] ?? "") ? displayName : (currentNames[index] ?? ""),
    );
    const uniqueAssignments = migratedIds.reduce<Array<{ id: string; name: string }>>((result, id, index) => {
      if (!result.some((assignment) => assignment.id === id)) result.push({ id, name: migratedNames[index] ?? "" });
      return result;
    }, []);
    await writeAssigneeCells(
      snapshot.sheetName,
      rowNumber,
      new Date().toISOString(),
      uniqueAssignments.map(({ id }) => id),
      uniqueAssignments.map(({ name }) => name),
    );
  }
}

export async function deleteSheetTaskSheetBacking(id: string): Promise<boolean> {
  const snapshot = await ensurePlannerHeader(await readSnapshot());
  const rowIndex = snapshot.rows.findIndex((row, index) => {
    const task = toTask(row, snapshot.header, index + 2);
    return task?.id === id;
  });
  if (rowIndex < 0) return false;

  const range = `${snapshot.sheetName}!A${rowIndex + 2}:AG${rowIndex + 2}`;
  const response = await sheetsRequest(
    `/v4/spreadsheets/${SPREADSHEET_ID}/values/${escapeRange(range)}:clear`,
    { method: "POST", body: {} },
  );
  if (!response.ok) {
    throw new Error(`Google Sheets task deletion failed (${response.status})`);
  }
  invalidateSnapshotCache();
  return true;
}

export const farmSheetSource = "Google Sheets";
export const farmSheetSourceUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`;

/**
 * Compatibility API retained for routes and clients. PostgreSQL is authoritative;
 * these names intentionally remain Sheet-prefixed until the public API is migrated.
 * The outbox written by the repository is the only path that may publish changes
 * to Sheets, so a provider outage cannot roll back a task mutation.
 */
let authorityReady: Promise<void> | null = null;
const LEGACY_TEST_FLAG = "__farmLegacySheetBackingTests";
let legacyBackingForTests = (globalThis as Record<string, unknown>)[LEGACY_TEST_FLAG] === true;
/** Explicit opt-in used by legacy projection contract tests only. */
export function enableLegacySheetBackingForTests(): void {
  legacyBackingForTests = true;
  (globalThis as Record<string, unknown>)[LEGACY_TEST_FLAG] = true;
}
export function legacySheetBackingEnabledForTests(): boolean {
  return legacyBackingForTests;
}
async function ensureAuthorityReady(): Promise<void> {
  if (!authorityReady) {
    authorityReady = importLegacySheetData(listSheetTasksSheetBacking, listCompletionRecordsSheetBacking)
      .then(({ tasks, completions }) => logger.info({ tasks, completions }, "Task authority initialized from Sheet"))
      .then(() => undefined)
      .catch((error) => { authorityReady = null; throw error; });
  }
  await authorityReady;
}
export async function listSheetTasks(): Promise<SheetTask[]> {
  if (legacyBackingForTests) return listSheetTasksSheetBacking();
  await ensureAuthorityReady();
  return listAuthoritativeTasks();
}
export async function listCompletionRecords(): Promise<CompletionRecord[]> {
  if (legacyBackingForTests) return listCompletionRecordsSheetBacking();
  await ensureAuthorityReady();
  return listAuthoritativeCompletions();
}
export async function appendCompletionRecord(record: CompletionRecord) {
  if (legacyBackingForTests) return appendCompletionRecordSheetBacking(record);
  await ensureAuthorityReady();
  return appendAuthoritativeCompletion(record);
}
export async function findSheetTask(id: string, _options?: { verifyWrite?: boolean }) {
  if (legacyBackingForTests) return findSheetTaskSheetBacking(id, _options);
  await ensureAuthorityReady();
  return findAuthoritativeTask(id);
}
export async function createSheetTask(input: Partial<Omit<SheetTask, "updatedAt">> & Pick<SheetTask, "task">) {
  if (legacyBackingForTests) return createSheetTaskSheetBacking(input);
  await ensureAuthorityReady();
  return createAuthoritativeTask(input);
}
export async function updateSheetTask(
  id: string,
  input: Partial<Omit<SheetTask, "id" | "updatedAt">>,
  receipt?: { operationId: string; memberId: string },
) {
  if (legacyBackingForTests) return updateSheetTaskSheetBacking(id, input);
  await ensureAuthorityReady();
  return updateAuthoritativeTask(id, input, receipt);
}
export async function deleteSheetTask(id: string, receipt?: { operationId: string; memberId: string }) {
  if (legacyBackingForTests) return deleteSheetTaskSheetBacking(id);
  await ensureAuthorityReady();
  return deleteAuthoritativeTask(id, receipt);
}