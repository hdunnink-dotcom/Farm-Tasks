import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { GoogleConnectors } from "./google-connectors";
import { z } from "zod";
import {
  assistantApprovalRules,
  assistantAuditEvents,
  assistantProposalTasks,
  assistantProposals,
  assistantSettings,
  assistantSourceItems,
  db,
  type AssistantApprovalRule,
  type AssistantProposal,
  type AssistantProposalTask,
} from "@workspace/db";
import { anthropic, claudeModel } from "@workspace/integrations-anthropic-ai";
import { createSheetTask, findSheetTask, listSheetTasks } from "./farm-sheet";
import { logger } from "./logger";
import { CANONICAL_TASK_CATEGORIES, canonicalTaskCategory, normalizeTaskCategory } from "./task-categories";
import { queueDailyPlanRefresh } from "./daily-plan";
import { parseIcsCalendar } from "./ics";
import { requestGoogleCalendar } from "./calendar-request";

const DEFAULT_PLAYBOOK = `BioGro / farm preparation guidance
- Treat this as the farm owner's editable working playbook, not an official compliance source.
- Propose preparation, evidence-gathering, scheduling, and follow-up tasks only when directly supported by a source item or this playbook.
- Do not invent certification deadlines, regulatory requirements, or farming actions.
- When evidence is incomplete, state the assumption and keep confidence below 85.`;

const CONNECTED_MAILBOX = "info@yurtsforyou.co.nz";
const FORWARDED_SENDER_ADDRESSES = ["h.dunnink@gmail.com", "harnold@hirshberginstitute.com"] as const;
const SHARED_CALENDARS = [
  { id: "primary", name: "Primary Google Calendar", primary: true },
  { id: "76df9141b280b413eca970598ec55d959234748546ff2ae920654df77c436a63@group.calendar.google.com", name: "Orchard Managment", primary: false },
  { id: "a2a1ce4d44d42bcc4fbc5c395a384fc19b4a8fe732a614be566ae1ac1a2fe4d1@group.calendar.google.com", name: "Pasture Management", primary: false },
  { id: "info@yurtsforyou.co.nz", name: "Yurtsforyou", primary: false },
  { id: "14cab9ceb3faee5cd6cdceb5f21937ead7cbd7917bf057227a38021c48c96ca6@group.calendar.google.com", name: "Wwoofers", primary: false },
  { id: "8d2776819bf8484b952aced80d790607121ab0ea4c4dd17adaea5068c95549fd@group.calendar.google.com", name: "Mahakaruna Classroom bookings", primary: false },
] as const;
const HIRSHBERG_ICS_URL = "https://calendar.google.com/calendar/ical/harnold%40hirshberginstitute.com/public/basic.ics";
const FORWARDED_SENDERS = new Set<string>(FORWARDED_SENDER_ADDRESSES);
const PLANNING_SIGNAL = /\b(audit|biogro|certif|inspection|farm|orchard|pasture|wwoofer|mahakaruna|classroom|mcc|vineyard|barrel|pommeau|canopy|planting|harvest)\b/i;

function requireCategoryChoice<T extends z.ZodTypeAny>(schema: T): z.ZodEffects<T> {
  return schema.superRefine((value: { groupName?: string | null; proposedCategory?: string | null }, context) => {
    if (!value.groupName && !value.proposedCategory) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["proposedCategory"], message: "A proposed category is required when no canonical category fits." });
    }
  });
}

const suggestedTaskSchema = requireCategoryChoice(z.object({
  sourceId: z.string().min(1),
  title: z.string().min(3).max(180),
  rationale: z.string().min(3).max(900),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  urgency: z.enum(["Urgent", "High", "Medium", "Low"]),
  groupName: z.enum(CANONICAL_TASK_CATEGORIES).nullable(),
  proposedCategory: z.string().min(1).max(80).nullable().default(null),
  notes: z.string().max(1800).default(""),
  confidence: z.number().min(0).max(100),
  assumptions: z.array(z.string().max(300)).max(6).default([]),
}));

const plannerOutputSchema = z.object({
  suggestions: z.array(suggestedTaskSchema).max(40),
});

const taskRequestOutputSchema = requireCategoryChoice(z.object({
  title: z.string().min(3).max(180),
  rationale: z.string().min(3).max(900),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  urgency: z.enum(["Urgent", "High", "Medium", "Low"]),
  groupName: z.enum(CANONICAL_TASK_CATEGORIES).nullable(),
  proposedCategory: z.string().min(1).max(80).nullable().default(null),
  notes: z.string().max(1800).default(""),
  confidence: z.number().min(0).max(100),
  assumptions: z.array(z.string().max(300)).max(6).default([]),
  clarificationQuestion: z.string().max(500).nullable().default(null),
  provenance: z.object({
    ownerKnowledge: z.array(z.string().max(300)).max(8).default([]),
    claudeProjectContext: z.array(z.string().max(300)).max(8).default([]),
    generalKnowledge: z.array(z.string().max(300)).max(8).default([]),
    assumptions: z.array(z.string().max(300)).max(8).default([]),
  }).default({ ownerKnowledge: [], claudeProjectContext: [], generalKnowledge: [], assumptions: [] }),
}));

type RawSource = {
  sourceType: "gmail" | "calendar";
  sourceId: string;
  title: string;
  content: string;
  sourceUrl: string;
  startsAt?: Date;
  recurringId?: string;
  sender?: string;
  mailbox: string;
  calendarId?: string;
  calendarName?: string;
  originalSender?: string;
  forwardedBy?: string;
  originLabel: string;
};

type ApprovalInput = {
  title?: string;
  groupName?: string;
  urgency?: "Urgent" | "High" | "Medium" | "Low";
  dueDate?: Date | null;
  notes?: string;
  createRule?: boolean;
  ruleName?: string;
  ruleType?: "calendar_series" | "calendar_event" | "gmail_sender_subject" | "gmail_sender";
  ruleValue?: string;
  ruleExpiresAt?: Date | null;
};

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function connectorRequest(service: "google-calendar" | "google-mail", path: string): Promise<Response> {
  return new GoogleConnectors().proxy(service, path, { method: "GET" });
}

async function calendarRequest(path: string): Promise<Response> {
  return requestGoogleCalendar(path);
}

function localDate(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland" }).format(value);
}

function header(headers: Array<{ name?: string; value?: string }> | undefined, name: string): string {
  return headers?.find((item) => item.name?.toLowerCase() === name.toLowerCase())?.value?.trim() ?? "";
}

function emailAddress(value: string): string {
  return value.match(/<([^>]+)>/)?.[1]?.trim().toLowerCase() ?? value.match(/[\w.+-]+@[\w.-]+\.\w+/)?.[0]?.toLowerCase() ?? "";
}

function forwardedBodySender(body: string): string {
  const forwarded = body.match(/(?:forwarded message|original message)[\s\S]{0,500}?\nFrom:\s*([^\n]+)/i);
  return forwarded?.[1]?.trim() ?? "";
}

function forwardedEmailContext(headers: Array<{ name?: string; value?: string }> | undefined, body: string) {
  const directSender = header(headers, "from");
  const originalSender = header(headers, "x-original-from")
    || header(headers, "x-forwarded-for")
    || header(headers, "resent-from")
    || forwardedBodySender(body)
    || directSender;
  const directAddress = emailAddress(directSender);
  const hasForwardingContext = Boolean(
    header(headers, "x-original-from")
      || header(headers, "x-forwarded-for")
      || header(headers, "resent-from")
      || forwardedBodySender(body)
      || FORWARDED_SENDERS.has(directAddress),
  );
  return {
    originalSender,
    forwardedBy: hasForwardingContext ? directSender : "",
  };
}

function isRelevantGmailSource(subject: string, snippet: string, body: string, context: ReturnType<typeof forwardedEmailContext>): boolean {
  const text = `${subject}\n${snippet}\n${body}`;
  if (!PLANNING_SIGNAL.test(text)) return false;
  const forwarder = emailAddress(context.forwardedBy);
  return !context.forwardedBy || FORWARDED_SENDERS.has(forwarder) || Boolean(context.originalSender);
}

function decodeBase64Url(value: string | undefined): string {
  if (!value) return "";
  try {
    return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return "";
  }
}

function gmailBody(payload: { mimeType?: string; body?: { data?: string }; parts?: unknown[] } | undefined): string {
  if (!payload) return "";
  const direct = decodeBase64Url(payload.body?.data);
  if (direct) return direct;
  const children = (payload.parts ?? []) as Array<{ mimeType?: string; body?: { data?: string }; parts?: unknown[] }>;
  const plain = children.find((part) => part.mimeType === "text/plain");
  return gmailBody(plain) || children.map(gmailBody).find(Boolean) || "";
}

async function readCalendarSources(lookaheadDays: number): Promise<RawSource[]> {
  const listResponse = await calendarRequest("/calendar/v3/users/me/calendarList?maxResults=50");
  if (!listResponse.ok) throw new Error(`Calendar list request failed (${listResponse.status}).`);
  const list = (await listResponse.json()) as { items?: Array<{ id?: string; summary?: string }> };
  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + lookaheadDays * 24 * 60 * 60 * 1000).toISOString();
  const visibleIds = new Set((list.items ?? []).flatMap((calendar) => calendar.id ? [calendar.id] : []));
  const relevantCalendars = SHARED_CALENDARS.filter((calendar) => calendar.primary || visibleIds.has(calendar.id));
  const events: RawSource[] = [];
  for (const calendar of relevantCalendars) {
    const query = new URLSearchParams({ timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "50" });
    let body: { items?: Array<{ id?: string; summary?: string; description?: string; htmlLink?: string; recurringEventId?: string; start?: { dateTime?: string; date?: string } }> };
    try {
      const response = await calendarRequest(`/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events?${query}`);
      if (!response.ok) throw new Error(`Calendar event request failed (${response.status}).`);
      body = await response.json() as typeof body;
    } catch (error) {
      logger.warn({ err: error, calendarName: calendar.name }, "Could not read calendar planning source");
      continue;
    }
    events.push(...(body.items ?? []).flatMap((event) => {
      if (!event.id || !event.summary) return [];
      const start = event.start?.dateTime ?? event.start?.date;
      return [{
        sourceType: "calendar" as const,
        sourceId: `${calendar.id}:${event.id}`,
        recurringId: event.recurringEventId ? `${calendar.id}:${event.recurringEventId}` : undefined,
        title: event.summary,
        content: `Mailbox: ${CONNECTED_MAILBOX}\nCalendar: ${calendar.name}\n${event.description ?? ""}`.trim(),
        sourceUrl: event.htmlLink ?? "",
        startsAt: start ? new Date(start) : undefined,
        mailbox: CONNECTED_MAILBOX,
        calendarId: calendar.id,
        calendarName: calendar.name,
        originLabel: calendar.primary ? `Primary calendar of ${CONNECTED_MAILBOX}` : `${calendar.name} shared with ${CONNECTED_MAILBOX}`,
      }];
    }));
    // Keep the connector within Google Calendar's request budget.
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  // This public feed is independent of the connected calendar list. It is already
  // expanded by Google; RRULE masters are deliberately not guessed by the parser.
  try {
    const response = await fetch(HIRSHBERG_ICS_URL);
    if (!response.ok) throw new Error(`Hirshberg ICS feed request failed (${response.status}).`);
    const parsed = parseIcsCalendar(await response.text());
    if (parsed.errors || parsed.unsupportedRrules) logger.warn({ errors: parsed.errors, unsupportedRrules: parsed.unsupportedRrules }, "Hirshberg ICS feed had malformed or unsupported records");
    events.push(...parsed.events.flatMap((event) => {
      if (!event.summary || !event.start) return [];
      return [{
        sourceType: "calendar" as const,
        sourceId: `hirshberg-ics:${event.uid}:${event.recurrenceId ?? event.start}`,
        recurringId: event.recurrenceId ? `hirshberg-ics:${event.uid}` : undefined,
        title: event.summary,
        content: [`Mailbox: ${CONNECTED_MAILBOX}`, "Calendar: Hirshberg Institute (public ICS)", event.location ? `Location: ${event.location}` : "", event.description ?? ""].filter(Boolean).join("\n"),
        sourceUrl: event.url || HIRSHBERG_ICS_URL,
        startsAt: new Date(event.start),
        mailbox: CONNECTED_MAILBOX,
        calendarId: "hirshberg-ics",
        calendarName: "Hirshberg Institute",
        originLabel: "Hirshberg Institute public ICS feed",
      }];
    }));
  } catch (error) {
    logger.warn({ err: error }, "Could not read Hirshberg ICS planning source");
  }
  return events;
}

async function readGmailSources(): Promise<RawSource[]> {
  const after = localDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)).replaceAll("-", "/");
  const query = new URLSearchParams({ q: `after:${after} (audit OR biogro OR certification OR inspection OR farm OR orchard OR pasture OR mahakaruna OR mcc OR vineyard OR barrel)`, maxResults: "30" });
  const response = await connectorRequest("google-mail", `/gmail/v1/users/me/messages?${query}`);
  if (!response.ok) throw new Error(`Gmail search request failed (${response.status}).`);
  const result = (await response.json()) as { messages?: Array<{ id?: string }> };
  const messages = await Promise.all((result.messages ?? []).filter((item) => item.id).map(async ({ id }) => {
    const detail = await connectorRequest("google-mail", `/gmail/v1/users/me/messages/${encodeURIComponent(id ?? "")}?format=full`);
    if (!detail.ok) return null;
    const message = (await detail.json()) as {
      id?: string; snippet?: string;
      payload?: { headers?: Array<{ name?: string; value?: string }>; body?: { data?: string }; parts?: unknown[] };
    };
    const subject = header(message.payload?.headers, "subject") || "Untitled email";
    const rawBody = gmailBody(message.payload);
    const body = rawBody.replace(/\s+/g, " ").slice(0, 4000);
    const context = forwardedEmailContext(message.payload?.headers, rawBody);
    if (!isRelevantGmailSource(subject, message.snippet ?? "", body, context)) return null;
    return {
      sourceType: "gmail" as const,
      sourceId: message.id ?? id ?? "",
      title: subject,
      content: [
        `Mailbox: ${CONNECTED_MAILBOX}`,
        `Original sender: ${context.originalSender}`,
        context.forwardedBy ? `Forwarded by: ${context.forwardedBy}` : "",
        message.snippet ?? "",
        body,
      ].filter(Boolean).join("\n").trim(),
      sourceUrl: `https://mail.google.com/mail/u/0/#all/${message.id ?? id}`,
      sender: context.originalSender,
      mailbox: CONNECTED_MAILBOX,
      originalSender: context.originalSender,
      forwardedBy: context.forwardedBy || undefined,
      originLabel: context.forwardedBy
        ? `Forwarded to ${CONNECTED_MAILBOX} by ${context.forwardedBy}`
        : `Received in ${CONNECTED_MAILBOX}`,
    } satisfies RawSource;
  }));
  return messages.filter((item): item is NonNullable<typeof item> => Boolean(item?.sourceId));
}

function dedupeSources(sources: RawSource[]): RawSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.sourceType}:${source.sourceId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sourceMetadata(source: RawSource) {
  return {
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    title: source.title,
    sourceUrl: source.sourceUrl,
    ...(source.recurringId ? { recurringId: source.recurringId } : {}),
    mailbox: source.mailbox,
    originLabel: source.originLabel,
    ...(source.calendarId ? { calendarId: source.calendarId, calendarName: source.calendarName } : {}),
    ...(source.originalSender ? { originalSender: source.originalSender } : {}),
    ...(source.forwardedBy ? { forwardedBy: source.forwardedBy } : {}),
  };
}

function cleanJson(text: string): string {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  const firstObject = cleaned.indexOf("{");
  const lastObject = cleaned.lastIndexOf("}");
  return firstObject >= 0 && lastObject > firstObject ? cleaned.slice(firstObject, lastObject + 1) : cleaned;
}

function parseJsonResponse(text: string, label: string): unknown {
  const cleaned = cleanJson(text);
  if (!cleaned) throw new Error(`${label} returned an empty response.`);
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON.`, { cause: error });
  }
}

function parsePlannerOutput(text: string): z.infer<typeof plannerOutputSchema> {
  // A source scan with no usable model text should behave like "no suggestions"
  // rather than turning background startup into a recurring JSON parse error.
  if (!cleanJson(text)) return { suggestions: [] };
  return plannerOutputSchema.parse(parseJsonResponse(text, "Claude task planner"));
}

async function createSuggestions(sources: RawSource[], playbook: string): Promise<z.infer<typeof suggestedTaskSchema>[]> {
  if (!sources.length) return [];
  const sourceText = sources.map((source) => ({
    id: source.sourceId,
    type: source.sourceType,
    title: source.title,
    content: source.content.slice(0, 3500),
    date: source.startsAt?.toISOString() ?? null,
    origin: source.originLabel,
    url: source.sourceUrl,
  }));
  const message = await anthropic.messages.create({
    model: claudeModel(),
    max_tokens: 8192,
    system: `You are a cautious farm planning assistant. You can only suggest fieldbook preparation tasks from the provided Gmail and Calendar source items and the owner's editable playbook. Gmail is read from the connected mailbox ${CONNECTED_MAILBOX}; some messages are forwarded, so use the preserved original sender and forwarding context rather than treating mailbox administration as farm work. Calendar items come only from the connected account's primary calendar, configured shared calendars, and the read-only Hirshberg Institute public ICS feed. Preserve each item's supplied origin and URL. Ignore account invitations, payslips, generic mailbox administration, and unrelated events. You must not claim official BioGro requirements or invent deadlines. Every output requires owner approval by default.

Categories are exactly ${CANONICAL_TASK_CATEGORIES.join(", ")}. Return only JSON matching: {"suggestions":[{"sourceId":"...","title":"...","rationale":"...","dueDate":"YYYY-MM-DD or null","urgency":"Urgent|High|Medium|Low","groupName":"one canonical category or null","proposedCategory":"short new category or null","notes":"...","confidence":0-100,"assumptions":["..."]}]}. Choose a canonical groupName whenever one fits. Only when none fits, set groupName null and proposedCategory; that proposal requires explicit owner categorization. Do not include a suggestion unless it is practical and supported. Use lower confidence for ambiguity.`,
    messages: [{ role: "user", content: `Owner playbook:\n${playbook}\n\nSource items:\n${JSON.stringify(sourceText)}` }],
  });
  const text = message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
  try {
    return parsePlannerOutput(text).suggestions;
  } catch (error) {
    logger.warn({ err: error, sourceCount: sources.length }, "Claude task planner returned unusable suggestions");
    return [];
  }
}

async function ensureSettings() {
  const [existing] = await db.select().from(assistantSettings).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(assistantSettings).values({ playbook: DEFAULT_PLAYBOOK }).returning();
  if (!created) throw new Error("Could not create assistant settings.");
  return created;
}

function asProposal(proposal: AssistantProposal, tasks: AssistantProposalTask[]) {
  return {
    id: proposal.id,
    title: proposal.title,
    summary: proposal.summary,
    requesterId: proposal.requesterId,
    requesterName: proposal.requesterName,
    status: proposal.status as "pending" | "approved" | "rejected" | "partial",
    sources: proposal.sourceItems.map((source) => ({
      ...source,
      mailbox: source.mailbox ?? CONNECTED_MAILBOX,
      originLabel: source.originLabel ?? (source.sourceType === "gmail"
        ? `Received in ${CONNECTED_MAILBOX}`
        : "Configured shared calendar"),
    })),
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      rationale: task.rationale,
      dueDate: task.dueDate,
      urgency: task.urgency as "Urgent" | "High" | "Medium" | "Low",
      groupName: normalizeTaskCategory(task.groupName),
      proposedCategory: task.proposedCategory,
      notes: task.notes,
      sourceLink: task.sourceLink,
      sourceType: task.sourceType,
      sourceId: task.sourceId,
      confidence: task.confidence,
      assumptions: task.assumptions,
      status: task.status as "pending" | "approved" | "rejected" | "auto_approved",
      approvedTaskId: task.approvedTaskId,
      matchedRuleId: task.matchedRuleId,
    })),
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
  };
}

export async function listTaskProposals(status?: string) {
  const proposals = await db.select().from(assistantProposals)
    .where(status ? eq(assistantProposals.status, status) : undefined)
    .orderBy(desc(assistantProposals.updatedAt));
  if (!proposals.length) return [];
  const tasks = await db.select().from(assistantProposalTasks)
    .where(inArray(assistantProposalTasks.proposalId, proposals.map((proposal) => proposal.id)));
  return proposals
    .map((proposal) => asProposal(proposal, tasks.filter((task) => task.proposalId === proposal.id)))
    .filter((proposal) => status || proposal.tasks.some((task) => task.status === "pending"));
}

function ruleMatchValue(source: RawSource, type: NonNullable<ApprovalInput["ruleType"]>): string {
  if (type === "calendar_series") return source.recurringId ?? "";
  if (type === "calendar_event") return source.sourceId;
  const subject = source.title.trim().toLowerCase();
  const sender = (source.sender ?? "").trim().toLowerCase();
  return type === "gmail_sender_subject" ? `${sender}|${subject}` : sender;
}

function ruleScope(source: RawSource, type: NonNullable<ApprovalInput["ruleType"]>): string {
  if (type === "calendar_series") return `Future events in the “${source.title}” calendar series`;
  if (type === "calendar_event") return `This exact calendar event: “${source.title}”`;
  if (type === "gmail_sender_subject") return `Email from the same sender with the same subject: “${source.title}”`;
  return `Future qualifying emails from the same sender`;
}

function canCreateRepeatRule(source: RawSource, type: NonNullable<ApprovalInput["ruleType"]>): boolean {
  return source.sourceType !== "calendar" || (type === "calendar_series" && Boolean(source.recurringId));
}

async function createRule(input: ApprovalInput, source: RawSource, task: AssistantProposalTask) {
  const type = input.ruleType;
  if (!type || !canCreateRepeatRule(source, type)) {
    throw new Error("Only recurring calendar series can receive repeat approval. One-off events require individual approval.");
  }
  const value = input.ruleValue?.trim() || (type ? ruleMatchValue(source, type) : "");
  if (!value) throw new Error("Choose a specific repeat-approval scope before approving automatically.");
  const [rule] = await db.insert(assistantApprovalRules).values({
    name: input.ruleName?.trim() || ruleScope(source, type),
    matchType: type,
    matchValue: value,
    scopeDescription: ruleScope(source, type),
    taskTemplate: {
      title: input.title?.trim() || task.title,
      groupName: normalizeTaskCategory(input.groupName ?? task.groupName),
      urgency: input.urgency ?? task.urgency,
      dueDate: input.dueDate === undefined ? task.dueDate : input.dueDate ? input.dueDate.toISOString().slice(0, 10) : null,
      notes: input.notes?.trim() || task.notes,
    },
    expiresAt: input.ruleExpiresAt ?? null,
  }).returning();
  return rule;
}

async function sourceForTask(task: AssistantProposalTask): Promise<RawSource> {
  const [source] = await db.select().from(assistantSourceItems)
    .where(and(eq(assistantSourceItems.sourceType, task.sourceType), eq(assistantSourceItems.sourceId, task.sourceId))).limit(1);
  if (!source) throw new Error("The source item for this suggestion is no longer available.");
  const sender = source.content.match(/^(?:Original sender|From):\s*(.+)$/mi)?.[1]?.trim();
  return {
    sourceType: source.sourceType as "gmail" | "calendar",
    sourceId: source.sourceId,
    title: source.title,
    content: source.content,
    sourceUrl: source.sourceUrl,
    startsAt: source.startsAt ?? undefined,
    recurringId: source.recurringId || undefined,
    sender,
    mailbox: source.content.match(/^Mailbox:\s*(.+)$/mi)?.[1]?.trim() || CONNECTED_MAILBOX,
    originalSender: sender,
    originLabel: source.sourceType === "gmail" ? `Received in ${CONNECTED_MAILBOX}` : "Configured shared calendar",
  };
}

async function updateProposalStatus(proposalId: number) {
  const tasks = await db.select().from(assistantProposalTasks).where(eq(assistantProposalTasks.proposalId, proposalId));
  const pending = tasks.some((task) => task.status === "pending");
  const approved = tasks.some((task) => task.status === "approved" || task.status === "auto_approved");
  const status = pending ? "pending" : approved ? "approved" : "rejected";
  await db.update(assistantProposals).set({ status }).where(eq(assistantProposals.id, proposalId));
}

function validateApproval(task: AssistantProposalTask, input: ApprovalInput, automatic = false): void {
  const explicitCategory = canonicalTaskCategory(input.groupName);
  if (task.proposedCategory && input.createRule) {
    throw new Error("A proposed new category cannot create a repeat approval rule.");
  }
  if (task.proposedCategory && !explicitCategory) {
    throw new Error("Choose one of the canonical categories before approving this proposed category.");
  }
  if (automatic && task.proposedCategory) {
    throw new Error("A proposed new category cannot be auto-approved.");
  }
}

async function approveStoredTask(task: AssistantProposalTask, actorId: string, input: ApprovalInput, automatic = false, rule?: AssistantApprovalRule) {
  if (task.status !== "pending") return;
  validateApproval(task, input, automatic);
  const explicitCategory = canonicalTaskCategory(input.groupName);
  const category = explicitCategory ?? normalizeTaskCategory(task.groupName);
  const title = input.title?.trim() || task.title;
  const notes = automatic
    ? ["Automatically approved by a narrow owner rule.", input.notes?.trim() || task.notes].filter(Boolean).join("\n\n")
    : [
    "Created by the Claude task planning assistant.",
    `Rationale: ${task.rationale}`,
    task.notes,
    task.assumptions.length ? `Assumptions: ${task.assumptions.join("; ")}` : "",
  ].filter(Boolean).join("\n\n");
  const taskId = `claude-${task.id}`;
  const existing = await findSheetTask(taskId);
  const selectedDueDate = input.dueDate === undefined ? task.dueDate : input.dueDate ? input.dueDate.toISOString().slice(0, 10) : null;
  const sheetTask = existing ?? await createSheetTask({
      id: taskId,
      task: title,
      group: category,
      urgency: input.urgency ?? task.urgency as "Urgent" | "High" | "Medium" | "Low",
      month: (selectedDueDate ?? "").slice(0, 7),
      notes: input.notes?.trim() || notes,
      link: task.sourceLink,
      source: "Manual",
    });
  await db.update(assistantProposalTasks).set({
    title,
    groupName: category,
    proposedCategory: null,
    urgency: input.urgency ?? task.urgency,
    dueDate: selectedDueDate,
    notes: input.notes?.trim() || task.notes,
    status: automatic ? "auto_approved" : "approved",
    approvedTaskId: sheetTask.id,
    matchedRuleId: rule?.id ?? null,
  }).where(eq(assistantProposalTasks.id, task.id));
  await db.insert(assistantAuditEvents).values({
    proposalTaskId: task.id,
    action: automatic ? "auto_approved" : "approved",
    actorId,
    ruleId: rule?.id,
    details: { sourceLink: task.sourceLink, taskId: sheetTask.id, edits: input },
  });
  queueDailyPlanRefresh(`${automatic ? "assistant-auto-approve" : "assistant-approve"}:${actorId}`);
}

function sameTemplate(rule: AssistantApprovalRule, task: AssistantProposalTask): boolean {
  const template = rule.taskTemplate;
  return template.title.trim().toLowerCase() === task.title.trim().toLowerCase()
    && template.groupName.trim().toLowerCase() === task.groupName.trim().toLowerCase()
    && template.urgency === task.urgency
    && template.dueDate === task.dueDate
    && template.notes.trim() === task.notes.trim();
}

function ruleMatchesSuggestion(rule: AssistantApprovalRule, source: RawSource, task: AssistantProposalTask): boolean {
  const now = new Date();
  if (task.proposedCategory || task.confidence < 85 || (rule.expiresAt && rule.expiresAt <= now) || !sameTemplate(rule, task)) return false;
  if (rule.matchType === "calendar_series") return source.sourceType === "calendar" && source.recurringId === rule.matchValue;
  if (rule.matchType === "calendar_event") return source.sourceType === "calendar" && source.sourceId === rule.matchValue;
  if (rule.matchType === "gmail_sender") return source.sourceType === "gmail" && source.sender?.trim().toLowerCase() === rule.matchValue;
  return source.sourceType === "gmail"
    && `${source.sender?.trim().toLowerCase() ?? ""}|${source.title.trim().toLowerCase()}` === rule.matchValue;
}

async function matchingRule(source: RawSource, task: AssistantProposalTask) {
  if (task.confidence < 85) return undefined;
  const candidates = await db.select().from(assistantApprovalRules).where(eq(assistantApprovalRules.active, true));
  return candidates.find((rule) => ruleMatchesSuggestion(rule, source, task));
}

export async function scanTaskSources(actorId = "scheduler") {
  const settings = await ensureSettings();
  if (!settings.enabled) return { scanned: 0, created: 0, autoApproved: 0, pending: 0, skipped: 0 };
  const settled = await Promise.allSettled([readGmailSources(), readCalendarSources(settings.lookaheadDays)]);
  const sources = dedupeSources(settled.flatMap((result) => result.status === "fulfilled" ? result.value : []));
  const errors = settled.filter((result) => result.status === "rejected").map((result) => result.reason instanceof Error ? result.reason.message : "Source scan failed.");
  try {
    // Sources Claude has already seen (same content fingerprint) cannot produce
    // new proposals (proposals are de-duplicated by that fingerprint), so only
    // new or changed emails/events are sent. This keeps scans cheap.
    const fingerprintOf = (source: RawSource) => hash(`${source.sourceType}|${source.sourceId}|${source.title}|${source.content}`);
    const fingerprints = sources.map(fingerprintOf);
    const seen = new Set(fingerprints.length
      ? (await db.select({ fingerprint: assistantSourceItems.fingerprint }).from(assistantSourceItems)
        .where(inArray(assistantSourceItems.fingerprint, fingerprints))).map((row) => row.fingerprint)
      : []);
    const fresh = sources.filter((source) => !seen.has(fingerprintOf(source)));
    for (const source of sources) {
      await db.insert(assistantSourceItems).values({
        sourceType: source.sourceType, sourceId: source.sourceId, recurringId: source.recurringId ?? "",
        title: source.title, content: source.content, sourceUrl: source.sourceUrl,
        startsAt: source.startsAt ?? null,
        fingerprint: hash(`${source.sourceType}|${source.sourceId}|${source.title}|${source.content}`),
      }).onConflictDoUpdate({
        target: [assistantSourceItems.sourceType, assistantSourceItems.sourceId],
        set: { recurringId: source.recurringId ?? "", title: source.title, content: source.content, sourceUrl: source.sourceUrl, startsAt: source.startsAt ?? null, observedAt: new Date(), fingerprint: hash(`${source.sourceType}|${source.sourceId}|${source.title}|${source.content}`) },
      });
    }
    const suggestions = fresh.length ? await createSuggestions(fresh, settings.playbook || DEFAULT_PLAYBOOK) : [];
    let created = 0; let autoApproved = 0; let pending = 0;
    for (const source of sources) {
      const sourceSuggestions = suggestions.filter((suggestion) => suggestion.sourceId === source.sourceId);
      if (!sourceSuggestions.length) continue;
      const fingerprint = hash(`${source.sourceType}|${source.sourceId}|${source.title}|${source.content}`);
      const [proposal] = await db.insert(assistantProposals).values({
        title: `Preparation: ${source.title}`,
        summary: `Claude found preparation work from a ${source.sourceType} source. Review before adding it to the fieldbook.`,
        sourceFingerprint: fingerprint,
        sourceItems: [sourceMetadata(source)],
      }).onConflictDoNothing().returning();
      if (!proposal) continue;
      created += 1;
      for (const suggestion of sourceSuggestions) {
        const [task] = await db.insert(assistantProposalTasks).values({
          proposalId: proposal.id, title: suggestion.title, rationale: suggestion.rationale, dueDate: suggestion.dueDate,
          urgency: suggestion.urgency,
          groupName: suggestion.groupName ?? "Admin",
          proposedCategory: suggestion.groupName ? null : suggestion.proposedCategory,
          notes: suggestion.notes,
          sourceLink: source.sourceUrl, sourceType: source.sourceType, sourceId: source.sourceId,
          confidence: Math.round(suggestion.confidence), assumptions: suggestion.assumptions,
        }).returning();
        const rule = task ? await matchingRule(source, task) : undefined;
        if (task && rule) {
          await approveStoredTask(task, actorId, {
            title: rule.taskTemplate.title,
            groupName: rule.taskTemplate.groupName,
            urgency: rule.taskTemplate.urgency as "Urgent" | "High" | "Medium" | "Low",
            dueDate: rule.taskTemplate.dueDate ? new Date(`${rule.taskTemplate.dueDate}T00:00:00.000Z`) : null,
            notes: rule.taskTemplate.notes,
          }, true, rule);
          autoApproved += 1;
        } else {
          pending += 1;
        }
      }
      await updateProposalStatus(proposal.id);
    }
    await db.update(assistantSettings).set({ lastScanAt: new Date(), lastError: errors.join(" ") }).where(eq(assistantSettings.id, settings.id));
    return { scanned: sources.length, created, autoApproved, pending, skipped: Math.max(0, sources.length - created), ...(errors.length ? { error: errors.join(" ") } : {}) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Assistant scan failed.";
    await db.update(assistantSettings).set({ lastScanAt: new Date(), lastError: message }).where(eq(assistantSettings.id, settings.id));
    throw error;
  }
}

export async function approveProposalTask(proposalId: number, taskId: number, actorId: string, input: ApprovalInput) {
  const [task] = await db.select().from(assistantProposalTasks).where(and(eq(assistantProposalTasks.id, taskId), eq(assistantProposalTasks.proposalId, proposalId))).limit(1);
  if (!task) throw new Error("Suggestion not found.");
  validateApproval(task, input);
  const source = input.createRule ? await sourceForTask(task) : undefined;
  const rule = input.createRule && source ? await createRule(input, source, task) : undefined;
  await approveStoredTask(task, actorId, input, false, rule);
  await updateProposalStatus(proposalId);
  return getProposal(proposalId);
}

export async function approveProposal(proposalId: number, actorId: string, input: ApprovalInput) {
  const tasks = await db.select().from(assistantProposalTasks).where(eq(assistantProposalTasks.proposalId, proposalId));
  const pendingTasks = tasks.filter((item) => item.status === "pending");
  pendingTasks.forEach((task, index) => validateApproval(task, {
    ...input,
    createRule: Boolean(input.createRule && index === 0),
  }));
  for (const [index, task] of pendingTasks.entries()) {
    await approveProposalTask(proposalId, task.id, actorId, { ...input, createRule: Boolean(input.createRule && index === 0) });
  }
  return getProposal(proposalId);
}

export async function rejectProposalTask(proposalId: number, taskId: number, actorId: string) {
  const [task] = await db.select().from(assistantProposalTasks).where(and(eq(assistantProposalTasks.id, taskId), eq(assistantProposalTasks.proposalId, proposalId))).limit(1);
  if (!task) throw new Error("Suggestion not found.");
  if (task.status === "pending") {
    await db.update(assistantProposalTasks).set({ status: "rejected" }).where(eq(assistantProposalTasks.id, task.id));
    await db.insert(assistantAuditEvents).values({ proposalTaskId: task.id, action: "rejected", actorId, details: { sourceLink: task.sourceLink } });
  }
  await updateProposalStatus(proposalId);
  return getProposal(proposalId);
}

export async function rejectProposal(proposalId: number, actorId: string) {
  const tasks = await db.select().from(assistantProposalTasks).where(eq(assistantProposalTasks.proposalId, proposalId));
  await Promise.all(tasks.filter((task) => task.status === "pending").map((task) => rejectProposalTask(proposalId, task.id, actorId)));
  return getProposal(proposalId);
}

export async function getProposal(proposalId: number) {
  const [proposal] = await db.select().from(assistantProposals).where(eq(assistantProposals.id, proposalId)).limit(1);
  if (!proposal) throw new Error("Proposal not found.");
  const tasks = await db.select().from(assistantProposalTasks).where(eq(assistantProposalTasks.proposalId, proposalId));
  return asProposal(proposal, tasks);
}

export async function createTaskRequest(
  actorId: string,
  input: {
    request?: string;
    whatNeedsDoing?: string;
    forWhom?: string;
    priority?: "Urgent" | "High" | "Medium" | "Low";
    dueDateTime?: string;
    location?: string;
    duration?: string;
    recurrence?: string;
    notes?: string;
    photoDataUrl?: string;
    claudeProjectContext?: string;
    requestId: string;
    requesterName?: string;
  },
) {
  const settings = await ensureSettings();
  const fingerprint = hash(`claude-task-request|${actorId}|${input.requestId}`);
  const [existing] = await db.select().from(assistantProposals).where(eq(assistantProposals.sourceFingerprint, fingerprint)).limit(1);
  if (existing) return { proposal: await getProposal(existing.id), duplicate: true };

  const existingTasks = (await listSheetTasks()).slice(0, 80).map((task) => ({
    task: task.task, group: task.group, urgency: task.urgency, month: task.month, notes: task.notes,
  }));
  const requestText = input.request?.trim() || [
    `What needs doing: ${input.whatNeedsDoing?.trim() || "Unspecified"}`,
    `For: ${input.forWhom?.trim() || "Unspecified"}`,
    `Priority: ${input.priority || "Medium"}`,
    `Due: ${input.dueDateTime?.trim() || "Unspecified"}`,
    input.location?.trim() ? `Location/group: ${input.location.trim()}` : "",
    input.duration?.trim() ? `Duration: ${input.duration.trim()}` : "",
    input.recurrence && input.recurrence !== "none" ? `Recurrence: ${input.recurrence}` : "",
    input.notes?.trim() ? `Notes and safety context: ${input.notes.trim()}` : "",
  ].filter(Boolean).join("\n");
  const projectContext = input.claudeProjectContext?.trim() || "(No Claude Project context supplied.)";
  const photo = input.photoDataUrl?.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
  const photoMediaType = photo?.[1] as "image/jpeg" | "image/png" | "image/webp" | "image/gif" | undefined;
  const requestContent = [
    {
      type: "text" as const,
      text: `Manager review is required. Draft one safe farm task from this request:\n${requestText}\n\nEditable farm playbook:\n${settings.playbook || DEFAULT_PLAYBOOK}\n\nClaude Project context (external evidence supplied by Claude):\n${projectContext}\n\nRelevant existing farm tasks:\n${JSON.stringify(existingTasks)}`,
    },
    ...(photo ? [{
      type: "image" as const,
      source: { type: "base64" as const, media_type: photoMediaType!, data: photo[2] },
    }] : []),
  ];
  const response = await anthropic.messages.create({
    model: claudeModel(),
    max_tokens: 8192,
    system: `You draft one safe farm task for a farm team member. Return only JSON matching:
{"title":"...","rationale":"...","dueDate":"YYYY-MM-DD or null","urgency":"Urgent|High|Medium|Low","groupName":"one canonical category or null","proposedCategory":"short new category or null","notes":"...","confidence":0-100,"assumptions":["..."],"clarificationQuestion":"... or null","provenance":{"ownerKnowledge":["..."],"claudeProjectContext":["..."],"generalKnowledge":["..."],"assumptions":["..."]}}

Categories are exactly ${CANONICAL_TASK_CATEGORIES.join(", ")}. Choose one whenever it fits. Only if none fits, set groupName null and proposedCategory; the owner must explicitly replace it with a canonical category and it cannot be auto-approved. Separate provenance explicitly. ownerKnowledge is only facts in the request or farm playbook. claudeProjectContext is only facts in the supplied Project context. generalKnowledge may contain useful agriculture knowledge, but it is not farm guidance. assumptions are uncertainties. Never fabricate product labels, fertilizer rates, ingredient ratios, compliance requirements, or deadlines. If the request asks for a mixing ratio and neither the playbook nor supplied Project context includes the exact product and label ratio, set clarificationQuestion to ask for the product label/product name and exact mixing directions, keep confidence below 50, and state that the ratio must come from the product label or owner-approved guidance. General knowledge must not fill that gap. Notes must include concise headings “Owner knowledge”, “Claude Project context”, “Claude general knowledge”, and “Assumptions” with the applicable provenance. The result is pending owner approval and must never imply it was written to Google Sheets.`,
    messages: [{
      role: "user",
      content: requestContent,
    }],
  });
  const text = response.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
  const draft = taskRequestOutputSchema.parse(parseJsonResponse(text, "Claude task request"));
  const requesterName = input.requesterName?.trim() || "Farm team member";
  const sourceLabel = `${requesterName}'s request via Claude`;
  const [proposal] = await db.insert(assistantProposals).values({
    title: `Claude request: ${draft.title}`,
    summary: draft.clarificationQuestion
      ? `Claude needs clarification before this task can be safely completed: ${draft.clarificationQuestion}`
      : `Drafted from ${requesterName}'s request. A manager must review and edit it before adding it to the fieldbook.`,
    sourceFingerprint: fingerprint,
    requesterId: actorId,
    requesterName,
    sourceItems: [{
      sourceType: "claude_request",
      sourceId: input.requestId,
      title: requestText.slice(0, 180),
      sourceUrl: "",
      mailbox: "",
      originLabel: sourceLabel,
    }],
  }).onConflictDoNothing().returning();
  if (!proposal) {
    const [retried] = await db.select().from(assistantProposals).where(eq(assistantProposals.sourceFingerprint, fingerprint)).limit(1);
    if (!retried) throw new Error("Could not save the Claude task request.");
    return { proposal: await getProposal(retried.id), duplicate: true };
  }
  const provenanceNotes = [
    "Owner knowledge:", draft.provenance.ownerKnowledge.join(" · ") || "None stated.",
    "Claude Project context:", draft.provenance.claudeProjectContext.join(" · ") || "None supplied.",
    "Claude general knowledge:", draft.provenance.generalKnowledge.join(" · ") || "None used.",
    "Assumptions:", [...draft.assumptions, ...draft.provenance.assumptions].join(" · ") || "None.",
    draft.clarificationQuestion ? `Clarification needed: ${draft.clarificationQuestion}` : "",
  ].filter(Boolean).join("\n");
  await db.insert(assistantProposalTasks).values({
    proposalId: proposal.id,
    title: draft.title,
    rationale: draft.rationale,
    dueDate: draft.dueDate,
    urgency: draft.urgency,
    groupName: draft.groupName ?? "Admin",
    proposedCategory: draft.groupName ? null : draft.proposedCategory,
    notes: `${draft.notes}\n\n${provenanceNotes}`.trim(),
    sourceLink: "",
    sourceType: "claude_request",
    sourceId: input.requestId,
    confidence: Math.round(draft.confidence),
     assumptions: [
       ...draft.assumptions,
       ...draft.provenance.assumptions,
       ...(draft.clarificationQuestion ? [draft.clarificationQuestion] : []),
       ...(photo ? ["A photo was supplied as visual context; it is not retained with the draft."] : []),
     ],
  });
  return { proposal: await getProposal(proposal.id), duplicate: false };
}

export async function listApprovalRules() {
  return (await db.select().from(assistantApprovalRules).orderBy(desc(assistantApprovalRules.updatedAt))).map((rule) => ({
    id: rule.id, name: rule.name, matchType: rule.matchType, matchValue: rule.matchValue,
    scopeDescription: rule.scopeDescription, active: rule.active, expiresAt: rule.expiresAt, createdAt: rule.createdAt,
  }));
}

export async function updateApprovalRule(id: number, input: { name?: string; active?: boolean; expiresAt?: Date | null }) {
  const [rule] = await db.update(assistantApprovalRules).set(input).where(eq(assistantApprovalRules.id, id)).returning();
  if (!rule) throw new Error("Rule not found.");
  return { id: rule.id, name: rule.name, matchType: rule.matchType, matchValue: rule.matchValue, scopeDescription: rule.scopeDescription, active: rule.active, expiresAt: rule.expiresAt, createdAt: rule.createdAt };
}

export async function getTaskPlannerSettings() {
  const settings = await ensureSettings();
  return {
    enabled: settings.enabled,
    lookaheadDays: settings.lookaheadDays,
    playbook: settings.playbook || DEFAULT_PLAYBOOK,
    lastScanAt: settings.lastScanAt,
    lastError: settings.lastError,
    sourceScope: {
      mailbox: CONNECTED_MAILBOX,
      forwardedSenders: [...FORWARDED_SENDER_ADDRESSES],
      calendars: SHARED_CALENDARS.map(({ id, name }) => ({ id, name })),
      publicCalendarFeeds: [{ name: "Hirshberg Institute", url: HIRSHBERG_ICS_URL }],
    },
  };
}

export async function updateTaskPlannerSettings(input: { enabled?: boolean; lookaheadDays?: number; playbook?: string }) {
  const settings = await ensureSettings();
  const [updated] = await db.update(assistantSettings).set(input).where(eq(assistantSettings.id, settings.id)).returning();
  if (!updated) throw new Error("Could not update settings.");
  return {
    enabled: updated.enabled,
    lookaheadDays: updated.lookaheadDays,
    playbook: updated.playbook || DEFAULT_PLAYBOOK,
    lastScanAt: updated.lastScanAt,
    lastError: updated.lastError,
    sourceScope: {
      mailbox: CONNECTED_MAILBOX,
      forwardedSenders: [...FORWARDED_SENDER_ADDRESSES],
      calendars: SHARED_CALENDARS.map(({ id, name }) => ({ id, name })),
    },
  };
}

export function startClaudeTaskPlannerSchedule(): void {
  void scanTaskSources().catch((error) => logger.warn({ err: error }, "Initial Claude task planner scan failed"));
  setInterval(() => void scanTaskSources().catch((error) => logger.warn({ err: error }, "Scheduled Claude task planner scan failed")), 60 * 60 * 1000).unref();
}

export const taskPlannerTestables = {
  canCreateRepeatRule,
  cleanJson,
  parsePlannerOutput,
  dedupeSources,
  isRelevantGmailSource,
  readCalendarSources,
  readGmailSources,
  sameTemplate,
  ruleMatchesSuggestion,
  SHARED_CALENDARS,
  HIRSHBERG_ICS_URL,
  validateApproval,
};
/** Runs a scan when the last one is older than the interval (external trigger). */
export async function scanTaskSourcesIfDue(intervalMinutes = Number(process.env.CLAUDE_SCAN_INTERVAL_MINUTES ?? 180)): Promise<"disabled" | "not-due" | "ran"> {
  const settings = await ensureSettings();
  if (!settings.enabled) return "disabled";
  const last = settings.lastScanAt ? new Date(settings.lastScanAt).getTime() : 0;
  if (Date.now() - last < intervalMinutes * 60_000 - 60_000) return "not-due";
  await scanTaskSources();
  return "ran";
}
