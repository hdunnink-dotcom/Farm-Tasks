import { createHash } from "node:crypto";
import { GoogleConnectors } from "./google-connectors";
import { pool } from "@workspace/db";

const MAX_RETRIES = 2;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 5_000;
const MIN_DELAY_MS = 100;
const RATE_LIMIT_COOLDOWN_MS = 10_000;
const AUTH_RETRY_DELAY_MS = 250;
const COORDINATION_NAMESPACE = "google-calendar-request:v1:";

export const CALENDAR_RATE_LIMIT_MESSAGE = "Google Calendar is temporarily rate-limited; try again shortly.";

const inFlightRequests = new Map<string, Promise<Response>>();
const rateLimitCooldowns = new Map<string, number>();

export type CalendarRequestLease = {
  release: () => Promise<void>;
  releaseAfter: (delayMs: number) => void;
};

export type CalendarRequestCoordinator = {
  acquire: (path: string) => Promise<CalendarRequestLease | undefined>;
};

export class CalendarRateLimitError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(CALENDAR_RATE_LIMIT_MESSAGE);
    this.name = "CalendarRateLimitError";
    this.path = path;
  }
}

function coordinationKey(path: string): string {
  return `${COORDINATION_NAMESPACE}${createHash("sha256").update(path).digest("hex")}`;
}

function immediateLease(): CalendarRequestLease {
  let released = false;
  return {
    release: async () => {
      released = true;
    },
    releaseAfter: () => {
      released = true;
    },
  };
}

const localCalendarCoordinator: CalendarRequestCoordinator = {
  acquire: async () => immediateLease(),
};

const postgresCalendarCoordinator: CalendarRequestCoordinator = {
  async acquire(path) {
    // The API's database pool is shared by all instances. A session-level
    // advisory lock lets a worker hold the path lease through the short
    // provider cooldown without adding a table or persisting calendar data.
    if (!pool) {
      throw new Error("Calendar request coordination is unavailable.");
    }

    const client = await pool.connect();
    const key = coordinationKey(path);
    try {
      const result = await client.query<{ locked: boolean }>(
        "select pg_try_advisory_lock(hashtext($1)) as locked",
        [key],
      );
      if (!result.rows[0]?.locked) {
        client.release();
        return undefined;
      }

      let released = false;
      let releaseTimer: NodeJS.Timeout | undefined;
      const release = async () => {
        if (released) return;
        released = true;
        if (releaseTimer) clearTimeout(releaseTimer);
        try {
          await client.query(
            "select pg_advisory_unlock(hashtext($1))",
            [key],
          );
          client.release();
        } catch (error) {
          client.release(error instanceof Error ? error : undefined);
          throw error;
        }
      };

      return {
        release,
        releaseAfter: (delayMs: number) => {
          if (released || releaseTimer) return;
          releaseTimer = setTimeout(() => {
            void release().catch(() => undefined);
          }, delayMs);
          releaseTimer.unref?.();
        },
      };
    } catch (error) {
      client.release();
      throw error;
    }
  },
};

let calendarCoordinator: CalendarRequestCoordinator =
  process.env.NODE_ENV === "test"
    || process.env.VITEST === "true"
    || process.argv.some((argument) => argument.includes("vitest"))
    ? localCalendarCoordinator
    : postgresCalendarCoordinator;

function retryAfterDelay(response: Response): number | undefined {
  const value = response.headers?.get("retry-after")?.trim();
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, seconds * 1_000));
  }

  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, date - Date.now()));
}

function retryDelay(response: Response, attempt: number): number {
  return retryAfterDelay(response)
    ?? Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, BASE_DELAY_MS * 2 ** attempt));
}

function cloneResponse(response: Response): Response {
  // Some unit-test connector doubles are response-shaped objects rather than
  // native Response instances. Real connector responses are always cloneable.
  return typeof response.clone === "function" ? response.clone() : response;
}

async function requestWithRetry(path: string): Promise<Response> {
  const cooldownUntil = rateLimitCooldowns.get(path) ?? 0;
  if (cooldownUntil > Date.now()) throw new CalendarRateLimitError(path);
  if (cooldownUntil) rateLimitCooldowns.delete(path);

  const lease = await calendarCoordinator.acquire(path);
  if (!lease) throw new CalendarRateLimitError(path);

  let keepLeaseForCooldown = false;
  try {
    let response = await new GoogleConnectors().proxy("google-calendar", path, { method: "GET" });
    if (response.status === 401) {
      await new Promise((resolve) => setTimeout(resolve, AUTH_RETRY_DELAY_MS));
      response = await new GoogleConnectors().proxy("google-calendar", path, { method: "GET" });
    }
    for (let attempt = 0; response.status === 429 && attempt < MAX_RETRIES; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
      response = await new GoogleConnectors().proxy("google-calendar", path, { method: "GET" });
    }

    if (response.status === 429) {
      rateLimitCooldowns.set(path, Date.now() + RATE_LIMIT_COOLDOWN_MS);
      keepLeaseForCooldown = true;
      lease.releaseAfter(RATE_LIMIT_COOLDOWN_MS);
      throw new CalendarRateLimitError(path);
    }
    return response;
  } finally {
    if (!keepLeaseForCooldown) await lease.release();
  }
}

export function requestGoogleCalendar(path: string): Promise<Response> {
  const existing = inFlightRequests.get(path);
  if (existing) return existing.then(cloneResponse);

  const request = requestWithRetry(path);
  inFlightRequests.set(path, request);
  void request.then(() => {
    if (inFlightRequests.get(path) === request) inFlightRequests.delete(path);
  }, () => {
    if (inFlightRequests.get(path) === request) inFlightRequests.delete(path);
  });
  return request.then(cloneResponse);
}

export const calendarRequestTestables = {
  retryAfterDelay,
  retryDelay,
  rateLimitCooldowns,
  inFlightRequests,
  localCalendarCoordinator,
  postgresCalendarCoordinator,
  setCoordinator: (coordinator?: CalendarRequestCoordinator) => {
    calendarCoordinator = coordinator ?? localCalendarCoordinator;
  },
};