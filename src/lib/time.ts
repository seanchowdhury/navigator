/**
 * Time helpers that work in a region's IANA time zone rather than the browser's.
 * Departure dates/times are entered as wall-clock values in the region's zone
 * ("2026-09-30" + "09:00" in America/Los_Angeles) and every time shown to the
 * user is formatted back in that zone, wherever the viewer happens to be.
 */

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string) {
  let formatter = partsFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Wall-clock fields of `date` in `timeZone`. */
export function zonedParts(date: Date, timeZone: string) {
  const parts: Record<string, number> = {};
  for (const { type, value } of partsFormatter(timeZone).formatToParts(date)) {
    if (type !== "literal") parts[type] = Number(value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

/** Milliseconds `timeZone` is ahead of UTC at the instant `date`. */
function zoneOffsetMs(date: Date, timeZone: string) {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - (date.getTime() - date.getMilliseconds());
}

/**
 * The instant at which the wall clock in `timeZone` reads `dateStr` ("YYYY-MM-DD")
 * `timeStr` ("HH:MM").
 */
export function zonedDateTime(dateStr: string, timeStr: string, timeZone: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hours, minutes] = timeStr.split(":").map(Number);
  const wallAsUtc = Date.UTC(year, month - 1, day, hours, minutes);
  // Two passes so the offset is the one in effect at the result (handles DST changes).
  let result = wallAsUtc - zoneOffsetMs(new Date(wallAsUtc), timeZone);
  result = wallAsUtc - zoneOffsetMs(new Date(result), timeZone);
  return new Date(result);
}

/** "9:40 AM" in `timeZone`. */
export function formatClock(date: Date, timeZone: string) {
  return date.toLocaleTimeString([], { timeZone, hour: "numeric", minute: "2-digit" });
}

/** "Wed, Oct 1" in `timeZone`. */
export function formatDay(date: Date, timeZone: string) {
  return date.toLocaleDateString([], { timeZone, weekday: "short", month: "short", day: "numeric" });
}

/** "9am" / "12pm" in `timeZone`, for chart ticks. */
export function formatHourTick(date: Date, timeZone: string) {
  return date
    .toLocaleTimeString([], { timeZone, hour: "numeric" })
    .replace(":00", "")
    .replace(/\s/g, "")
    .toLowerCase();
}

/** "HH:MM" (24h) in `timeZone`, the format <input type="time"> uses. */
export function toTimeInputValue(date: Date, timeZone: string) {
  const p = zonedParts(date, timeZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" in `timeZone`, the format <input type="date"> uses. */
export function toDateInputValue(date: Date, timeZone: string) {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Hour of day (0-23) of `date` in `timeZone`. */
export function zonedHour(date: Date, timeZone: string) {
  return zonedParts(date, timeZone).hour;
}
