import { beforeEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal("fetch", vi.fn(async () => new Response("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n")));

let rateLimitedListRequests = 0;
const proxy = vi.fn(async (_provider: string, path: string): Promise<Response> => {
  if (path.startsWith("/calendar/v3/users/me/calendarList")) {
    if (rateLimitedListRequests > 0) {
      rateLimitedListRequests -= 1;
      return new Response(JSON.stringify({}), { status: 429 });
    }
    return new Response(JSON.stringify({
      items: [
        { id: "76df9141b280b413eca970598ec55d959234748546ff2ae920654df77c436a63@group.calendar.google.com", summary: "Orchard renamed in Google" },
        { id: "unrelated-calendar", summary: "Personal appointments" },
      ],
    }));
  }
  if (path.startsWith("/calendar/v3/calendars/76df9141b280b413eca970598ec55d959234748546ff2ae920654df77c436a63%40group.calendar.google.com/events")) {
    return new Response(JSON.stringify({
      items: [{ id: "event-1", summary: "Prepare orchard audit evidence", description: "Bring field records.", htmlLink: "https://calendar.google.com/event-1", start: { dateTime: "2026-09-01T09:00:00Z" } }],
    }));
  }
  if (path.startsWith("/gmail/v1/users/me/messages?")) {
    return new Response(JSON.stringify({ messages: [{ id: "mail-1" }] }));
  }
  if (path.includes("/gmail/v1/users/me/messages/mail-1")) {
    return new Response(JSON.stringify({
      id: "mail-1",
      snippet: "Please prepare the audit records.",
      payload: {
        headers: [{ name: "Subject", value: "BioGro audit visit" }, { name: "From", value: "H. Dunnink <h.dunnink@gmail.com>" }],
        body: { data: Buffer.from("---------- Forwarded message ---------\nFrom: Auditor <audit@example.com>\nPlease have the records ready.").toString("base64url") },
      },
    }));
  }
  return new Response(JSON.stringify({}), { status: 404 });
});

vi.mock("./google-connectors", () => ({
  GoogleConnectors: class { proxy = proxy; },
}));
vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: { messages: { create: vi.fn() } }, claudeModel: () => "claude-test-model", claudeFastModel: () => "claude-test-fast-model" }));
vi.mock("@workspace/db", () => ({
  db: {},
  assistantApprovalRules: {},
  assistantAuditEvents: {},
  assistantProposalTasks: {},
  assistantProposals: {},
  assistantSettings: {},
  assistantSourceItems: {},
}));
vi.mock("./farm-sheet", () => ({ createSheetTask: vi.fn(), findSheetTask: vi.fn() }));
vi.mock("./logger", () => ({ logger: { warn: vi.fn() } }));
vi.mock("./daily-plan", () => ({ queueDailyPlanRefresh: vi.fn() }));

describe("Claude task planner safeguards", () => {
  beforeEach(async () => {
    vi.useRealTimers();
    vi.clearAllMocks();
    rateLimitedListRequests = 0;
    const { calendarRequestTestables } = await import("./calendar-request");
    calendarRequestTestables.inFlightRequests.clear();
    calendarRequestTestables.rateLimitCooldowns.clear();
  });

  it("accepts a structured Claude response even if a text preamble precedes it", async () => {
    const { taskPlannerTestables } = await import("./claude-task-planner");
    expect(taskPlannerTestables.cleanJson('Looking at the sources…\n{"suggestions":[]}')).toBe('{"suggestions":[]}');
  });

  it("treats an empty background planner response as no suggestions", async () => {
    const { taskPlannerTestables } = await import("./claude-task-planner");
    expect(taskPlannerTestables.parsePlannerOutput("")).toEqual({ suggestions: [] });
    expect(taskPlannerTestables.parsePlannerOutput(" \n")).toEqual({ suggestions: [] });
  });

  it("uses the Google Mail connector and preserves original forwarded-email provenance", async () => {
    const { taskPlannerTestables } = await import("./claude-task-planner");
    const sources = await taskPlannerTestables.readGmailSources();

    expect(proxy).toHaveBeenCalledWith("google-mail", expect.stringContaining("/gmail/v1/users/me/messages"), { method: "GET" });
    expect(sources).toEqual(expect.arrayContaining([expect.objectContaining({
      sourceType: "gmail",
      sourceId: "mail-1",
      title: "BioGro audit visit",
      sourceUrl: "https://mail.google.com/mail/u/0/#all/mail-1",
      sender: "Auditor <audit@example.com>",
      originalSender: "Auditor <audit@example.com>",
      forwardedBy: "H. Dunnink <h.dunnink@gmail.com>",
      mailbox: "info@yurtsforyou.co.nz",
    })]));
    expect(sources[0]?.content).toContain("Original sender: Auditor <audit@example.com>");
    expect(sources[0]?.content).toContain("Forwarded by: H. Dunnink <h.dunnink@gmail.com>");
  });

  it("reads only explicitly configured shared calendars even when display names change", async () => {
    const { taskPlannerTestables } = await import("./claude-task-planner");
    const sources = await taskPlannerTestables.readCalendarSources(30);

    expect(sources).toEqual([expect.objectContaining({
      sourceType: "calendar",
      sourceId: "76df9141b280b413eca970598ec55d959234748546ff2ae920654df77c436a63@group.calendar.google.com:event-1",
      calendarName: "Orchard Managment",
      mailbox: "info@yurtsforyou.co.nz",
    })]);
    expect(proxy).toHaveBeenCalledWith("google-calendar", expect.stringContaining("76df9141b280b413eca970598ec55d959234748546ff2ae920654df77c436a63%40group.calendar.google.com/events"), { method: "GET" });
    expect(proxy).not.toHaveBeenCalledWith("google-calendar", expect.stringContaining("unrelated-calendar/events"), { method: "GET" });
  });

  it("uses the shared bounded rate-limit policy when the assistant calendar list is throttled", async () => {
    vi.useFakeTimers();
    rateLimitedListRequests = 3;
    const { taskPlannerTestables } = await import("./claude-task-planner");

    const sources = taskPlannerTestables.readCalendarSources(30);
    const rejection = expect(sources).rejects.toThrow("Google Calendar is temporarily rate-limited; try again shortly.");
    await vi.runAllTimersAsync();
    await rejection;

    expect(proxy).toHaveBeenCalledTimes(3);
    await expect(taskPlannerTestables.readCalendarSources(30))
      .rejects.toThrow("Google Calendar is temporarily rate-limited; try again shortly.");
    expect(proxy).toHaveBeenCalledTimes(3);
  });

  it("includes the connected primary calendar and Hirshberg public feed in the planner scope", async () => {
    const { taskPlannerTestables } = await import("./claude-task-planner");
    expect(taskPlannerTestables.SHARED_CALENDARS).toContainEqual(expect.objectContaining({
      id: "primary",
      name: "Primary Google Calendar",
      primary: true,
    }));
    expect(taskPlannerTestables.HIRSHBERG_ICS_URL).toBe("https://calendar.google.com/calendar/ical/harnold%40hirshberginstitute.com/public/basic.ics");
  });

  it("deduplicates repeated source records before Claude sees them", async () => {
    const { taskPlannerTestables } = await import("./claude-task-planner");
    const source = {
      sourceType: "gmail" as const, sourceId: "mail-1", title: "Audit", content: "", sourceUrl: "",
      mailbox: "info@yurtsforyou.co.nz", originLabel: "Received in info@yurtsforyou.co.nz",
    };
    expect(taskPlannerTestables.dedupeSources([source, { ...source, title: "Duplicate" }])).toEqual([source]);
  });

  it("only treats an exact owner-approved template as repeatable", async () => {
    const { taskPlannerTestables } = await import("./claude-task-planner");
    const rule = { taskTemplate: { title: "Prepare audit records", groupName: "Compliance", urgency: "High", dueDate: "2026-09-01", notes: "Bring the farm diary." } } as never;
    const matching = { title: "Prepare audit records", groupName: "Compliance", urgency: "High", dueDate: "2026-09-01", notes: "Bring the farm diary." };
    const changed = { ...matching, dueDate: "2026-09-02" };

    expect(taskPlannerTestables.sameTemplate(rule, matching as never)).toBe(true);
    expect(taskPlannerTestables.sameTemplate(rule, changed as never)).toBe(false);
  });

  it("matches a later recurring Calendar instance only through the approved series rule", async () => {
    const { taskPlannerTestables } = await import("./claude-task-planner");
    const rule = {
      matchType: "calendar_series",
      matchValue: "calendar-1:series-1",
      active: true,
      expiresAt: null,
      taskTemplate: { title: "Prepare audit records", groupName: "Compliance", urgency: "High", dueDate: "2026-09-01", notes: "Bring the farm diary." },
    } as never;
    const task = { title: "Prepare audit records", groupName: "Compliance", urgency: "High", dueDate: "2026-09-01", notes: "Bring the farm diary.", confidence: 92 } as never;
    const laterInstance = { sourceType: "calendar", sourceId: "calendar-1:event-2", recurringId: "calendar-1:series-1", title: "Audit visit", content: "", sourceUrl: "" };
    const otherSeries = { ...laterInstance, recurringId: "calendar-1:series-2" };

    expect(taskPlannerTestables.ruleMatchesSuggestion(rule, laterInstance as never, task)).toBe(true);
    expect(taskPlannerTestables.ruleMatchesSuggestion(rule, otherSeries as never, task)).toBe(false);
    expect(taskPlannerTestables.canCreateRepeatRule(laterInstance as never, "calendar_series")).toBe(true);
    expect(taskPlannerTestables.canCreateRepeatRule({ ...laterInstance, recurringId: undefined } as never, "calendar_event")).toBe(false);
  });

  it("rejects proposed-category repeat approval before creating any rule", async () => {
    const { taskPlannerTestables } = await import("./claude-task-planner");
    const proposed = { status: "pending", groupName: "Admin", proposedCategory: "Vineyard" } as never;
    expect(() => taskPlannerTestables.validateApproval(proposed, {
      groupName: "Orchards",
      createRule: true,
      ruleType: "gmail_sender_subject",
    })).toThrow("cannot create a repeat approval rule");
  });

  it("prevalidates proposed categories before bulk approval can mutate tasks", async () => {
    const { taskPlannerTestables } = await import("./claude-task-planner");
    const proposed = { status: "pending", groupName: "Admin", proposedCategory: "Vineyard" } as never;
    expect(() => taskPlannerTestables.validateApproval(proposed, {})).toThrow("Choose one of the canonical categories");
    expect(() => taskPlannerTestables.validateApproval(proposed, { groupName: "Repair" })).not.toThrow();
  });
});