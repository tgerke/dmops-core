import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { z } from "zod";

/**
 * Schema for governed holiday calendars (calendars/*.yaml, ADR-0016).
 * Governed like the taxonomy, not the metric dictionary: a calendar is data
 * about the deployment, consumed at compute time — its history is the git
 * history, and the qualification fixtures pin the shipped dates verbatim.
 */
export const holidayCalendar = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
    label: z.string().min(1),
    holidays: z
      .array(
        z
          .object({
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            label: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type HolidayCalendar = z.infer<typeof holidayCalendar>;

export function defaultCalendarsDir(): string {
  return fileURLToPath(new URL("../../../calendars", import.meta.url));
}

export function loadCalendars(dir: string = defaultCalendarsDir()): HolidayCalendar[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort();
  const loaded = files.map((file) => {
    const calendar = holidayCalendar.parse(parse(readFileSync(join(dir, file), "utf8")));
    const dates = new Set(calendar.holidays.map((h) => h.date));
    if (dates.size !== calendar.holidays.length) {
      throw new Error(`calendars/${file}: duplicate holiday dates`);
    }
    return calendar;
  });
  const ids = new Set(loaded.map((c) => c.id));
  if (ids.size !== loaded.length) throw new Error("duplicate calendar ids in calendars/");
  return loaded;
}

/**
 * Resolve a study's calendar id to its holiday dates. An id the files do not
 * contain is a hard error: a misconfigured study must not silently compute
 * weekday-only numbers under a definition that claims holiday awareness
 * (ADR-0005's fail-closed rule, applied to configuration).
 */
export function resolveCalendar(
  calendarId: string,
  calendars: HolidayCalendar[] = loadCalendars(),
): string[] {
  const calendar = calendars.find((c) => c.id === calendarId);
  if (!calendar) {
    throw new Error(
      `calendar '${calendarId}' has no file in calendars/ — fix the study's calendar or add the file (ADR-0016)`,
    );
  }
  return calendar.holidays.map((h) => h.date);
}
