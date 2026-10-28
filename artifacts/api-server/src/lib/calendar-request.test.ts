import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  calendarRequestTestables,
  requestGoogleCalendar,
  type CalendarRequestCoordinator,
} from "./calendar-request";

const proxy = vi.hoisted(() => vi.fn());

vi.mock("./google-connectors", () => ({
  GoogleConnectors: class { proxy = proxy; },
}));

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("Google Calendar request policy", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    calendarRequestTestables.inFlightRequests.clear();
    calendarRequestTestables.rateLimitCooldowns.clear();
    calendarRequestTestables.setCoordinator();
  });

  it("retries a 429 using the server Retry-After delay", async () => {
    vi.useFakeTimers();
    proxy
      .mockResolvedValueOnce(jsonResponse({}, 429, { "Retry-After": "2" }))
      .mockResolvedValueOnce(jsonResponse({ items: [] }));

    const request = requestGoogleCalendar("/calendar/v3/users/me/calendarList?maxResults=50");
    await vi.advanceTimersByTimeAsync(1_999);
    expect(proxy).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await expect(request).resolves.toMatchObject({ status: 200 });
    expect(proxy).toHaveBeenCalledTimes(2);
  });

  it("retries one transient authorization response", async () => {
    vi.useFakeTimers();
    proxy
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({ items: [] }));

    const request = requestGoogleCalendar("/calendar/v3/users/me/calendarList?maxResults=50");
    await vi.advanceTimersByTimeAsync(249);
    expect(proxy).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await expect(request).resolves.toMatchObject({ status: 200 });
    expect(proxy).toHaveBeenCalledTimes(2);
  });

  it("does not loop on a persistent authorization failure", async () => {
    vi.useFakeTimers();
    proxy.mockResolvedValue(jsonResponse({}, 401));

    const request = requestGoogleCalendar("/calendar/v3/users/me/calendarList?maxResults=50");
    await vi.advanceTimersByTimeAsync(250);
    await expect(request).resolves.toMatchObject({ status: 401 });
    expect(proxy).toHaveBeenCalledTimes(2);
  });

  it("bounds repeated 429 responses and suppresses an immediate retry storm", async () => {
    vi.useFakeTimers();
    proxy.mockResolvedValue(jsonResponse({}, 429));

    const request = requestGoogleCalendar("/calendar/v3/users/me/calendarList?maxResults=50");
    const rejection = expect(request).rejects.toThrow("Google Calendar is temporarily rate-limited; try again shortly.");
    await vi.runAllTimersAsync();
    await rejection;
    expect(proxy).toHaveBeenCalledTimes(3);

    await expect(requestGoogleCalendar("/calendar/v3/users/me/calendarList?maxResults=50"))
      .rejects.toThrow("Google Calendar is temporarily rate-limited; try again shortly.");
    expect(proxy).toHaveBeenCalledTimes(3);
  });

  it("coalesces concurrent requests for the same calendar path", async () => {
    let resolve: (response: Response) => void = () => undefined;
    proxy.mockReturnValue(new Promise<Response>((nextResolve) => { resolve = nextResolve; }));

    const first = requestGoogleCalendar("/calendar/v3/users/me/calendarList?maxResults=50");
    const second = requestGoogleCalendar("/calendar/v3/users/me/calendarList?maxResults=50");
    resolve(jsonResponse({ items: [] }));

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ status: 200 }),
      expect.objectContaining({ status: 200 }),
    ]);
    expect(proxy).toHaveBeenCalledOnce();
  });

  it("coordinates concurrent requests from independent API workers", async () => {
    const activePaths = new Set<string>();
    const sharedCoordinator: CalendarRequestCoordinator = {
      acquire: async (path) => {
        if (activePaths.has(path)) return undefined;
        activePaths.add(path);
        return {
          release: async () => {
            activePaths.delete(path);
          },
          releaseAfter: (delayMs) => {
            setTimeout(() => activePaths.delete(path), delayMs);
          },
        };
      },
    };

    vi.resetModules();
    const workerOne = await import("./calendar-request");
    vi.resetModules();
    const workerTwo = await import("./calendar-request");
    workerOne.calendarRequestTestables.setCoordinator(sharedCoordinator);
    workerTwo.calendarRequestTestables.setCoordinator(sharedCoordinator);

    let resolve: (response: Response) => void = () => undefined;
    proxy.mockReturnValue(new Promise<Response>((nextResolve) => { resolve = nextResolve; }));

    const path = "/calendar/v3/users/me/calendarList?maxResults=50";
    const first = workerOne.requestGoogleCalendar(path);
    const second = workerTwo.requestGoogleCalendar(path);

    await expect(second).rejects.toThrow("Google Calendar is temporarily rate-limited; try again shortly.");
    expect(proxy).toHaveBeenCalledOnce();

    resolve(jsonResponse({ items: [] }));
    await expect(first).resolves.toMatchObject({ status: 200 });
  });

  it("shares a throttled path cooldown across independent API workers", async () => {
    vi.useFakeTimers();
    const activePaths = new Set<string>();
    const sharedCoordinator: CalendarRequestCoordinator = {
      acquire: async (path) => {
        if (activePaths.has(path)) return undefined;
        activePaths.add(path);
        return {
          release: async () => {
            activePaths.delete(path);
          },
          releaseAfter: (delayMs) => {
            setTimeout(() => activePaths.delete(path), delayMs);
          },
        };
      },
    };

    vi.resetModules();
    const workerOne = await import("./calendar-request");
    vi.resetModules();
    const workerTwo = await import("./calendar-request");
    workerOne.calendarRequestTestables.setCoordinator(sharedCoordinator);
    workerTwo.calendarRequestTestables.setCoordinator(sharedCoordinator);

    proxy.mockResolvedValue(jsonResponse({}, 429));
    const path = "/calendar/v3/users/me/calendarList?maxResults=50";
    const first = workerOne.requestGoogleCalendar(path);
    const firstRejection = expect(first).rejects.toThrow("Google Calendar is temporarily rate-limited; try again shortly.");
    await vi.advanceTimersByTimeAsync(1_500);
    await firstRejection;

    await expect(workerTwo.requestGoogleCalendar(path))
      .rejects.toThrow("Google Calendar is temporarily rate-limited; try again shortly.");
    expect(proxy).toHaveBeenCalledTimes(3);

    proxy.mockResolvedValueOnce(jsonResponse({}, 200));
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(workerTwo.requestGoogleCalendar(path)).resolves.toMatchObject({ status: 200 });
    expect(proxy).toHaveBeenCalledTimes(4);
  });
});
