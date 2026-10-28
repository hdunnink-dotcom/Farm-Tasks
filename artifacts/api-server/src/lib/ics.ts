export type IcsEvent = {
  uid: string;
  summary?: string;
  description?: string;
  location?: string;
  url?: string;
  status?: string;
  dtstamp?: string;
  lastModified?: string;
  start?: string;
  recurrenceId?: string;
  hasRrule: boolean;
};

export type IcsParseResult = { events: IcsEvent[]; errors: number; unsupportedRrules: number };

function unfold(input: string): string[] {
  return input.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").reduce<string[]>((lines, line) => {
    if (/^[ \t]/.test(line) && lines.length) lines[lines.length - 1] += line.slice(1);
    else lines.push(line);
    return lines;
  }, []);
}

function unescapeText(value: string): string {
  return value.replace(/\\([nN,;\\])/g, (_, character: string) => character.toLowerCase() === "n" ? "\n" : character);
}

function parsedLine(line: string): { name: string; params: Map<string, string>; value: string } | undefined {
  const separator = line.indexOf(":");
  if (separator < 1) return undefined;
  const [name, ...parameterParts] = line.slice(0, separator).split(";");
  const params = new Map<string, string>();
  parameterParts.forEach((part) => {
    const equals = part.indexOf("=");
    if (equals > 0) params.set(part.slice(0, equals).toUpperCase(), part.slice(equals + 1).replace(/^"|"$/g, ""));
  });
  return { name: name.toUpperCase(), params, value: line.slice(separator + 1) };
}

function zoneOffsetMilliseconds(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date).reduce<Record<string, string>>((result, part) => ({ ...result, [part.type]: part.value }), {});
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)) - date.getTime();
}

/** Converts iCalendar DATE/DATE-TIME values to ISO strings, retaining date-only values. */
export function icsDate(value: string, tzid?: string): string | undefined {
  const dateOnly = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (dateOnly) return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`;
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!match) return undefined;
  const utcMilliseconds = Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +match[6]);
  if (match[7]) return new Date(utcMilliseconds).toISOString();
  const zone = tzid || "Pacific/Auckland";
  try {
    let instant = new Date(utcMilliseconds);
    // Offset can change at daylight-saving boundaries; a second pass resolves it.
    instant = new Date(utcMilliseconds - zoneOffsetMilliseconds(instant, zone));
    instant = new Date(utcMilliseconds - zoneOffsetMilliseconds(instant, zone));
    return instant.toISOString();
  } catch {
    return undefined;
  }
}

export function parseIcsCalendar(input: string): IcsParseResult {
  const events: IcsEvent[] = [];
  let errors = 0;
  let unsupportedRrules = 0;
  let current: Partial<IcsEvent> & { startTzid?: string; recurrenceTzid?: string } | undefined;
  for (const raw of unfold(input)) {
    const line = parsedLine(raw);
    if (!line) continue;
    if (line.name === "BEGIN" && line.value.toUpperCase() === "VEVENT") {
      if (current) errors += 1;
      current = {};
      continue;
    }
    if (line.name === "END" && line.value.toUpperCase() === "VEVENT") {
      if (!current?.uid || !current.start) errors += 1;
      else {
        const event: IcsEvent = {
          uid: current.uid, summary: current.summary, description: current.description, location: current.location,
          url: current.url, status: current.status, dtstamp: current.dtstamp, lastModified: current.lastModified,
          start: current.start, recurrenceId: current.recurrenceId, hasRrule: Boolean(current.hasRrule),
        };
        // RRULE expansion requires recurrence exceptions and timezone rules. Do not create an incorrect
        // single occurrence; feeds that provide expanded RECURRENCE-ID instances remain supported.
        if (event.hasRrule && !event.recurrenceId) unsupportedRrules += 1;
        else events.push(event);
      }
      current = undefined;
      continue;
    }
    if (!current) continue;
    const value = unescapeText(line.value);
    if (line.name === "UID") current.uid = value;
    else if (line.name === "SUMMARY") current.summary = value;
    else if (line.name === "DESCRIPTION") current.description = value;
    else if (line.name === "LOCATION") current.location = value;
    else if (line.name === "URL") current.url = value;
    else if (line.name === "STATUS") current.status = value.toLowerCase();
    else if (line.name === "DTSTAMP") current.dtstamp = icsDate(value, line.params.get("TZID"));
    else if (line.name === "LAST-MODIFIED") current.lastModified = icsDate(value, line.params.get("TZID"));
    else if (line.name === "DTSTART") { current.start = icsDate(value, line.params.get("TZID")); current.startTzid = line.params.get("TZID"); }
    else if (line.name === "RECURRENCE-ID") current.recurrenceId = icsDate(value, line.params.get("TZID") || current.startTzid);
    else if (line.name === "RRULE") current.hasRrule = true;
  }
  if (current) errors += 1;
  return { events, errors, unsupportedRrules };
}