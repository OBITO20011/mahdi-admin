// Amman wall-clock helpers for date/datetime-local inputs. A browser input has
// no time zone, so its value is read and written as Asia/Amman local time and
// sent to the server as an exact instant (audit 25 Nov 2026).
const ammanParts = (instant: Date): Record<string, string> =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Amman', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(instant).map(part => [part.type, part.value]),
  );

/** Today's date in Amman, for a `type="date"` default. */
export function ammanDateInput(now = new Date()): string {
  const p = ammanParts(now);
  return `${p.year}-${p.month}-${p.day}`;
}

/** The current Amman wall-clock time, for a `type="datetime-local"` default. */
export function ammanDateTimeInput(now = new Date()): string {
  const p = ammanParts(now);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Converts an Amman `datetime-local` value to an ISO instant; undefined when invalid. */
export function ammanDateTimeInputToIso(value: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d{1,3})?)?$/u.exec(value.trim());
  if (!match) return undefined;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const offsetAt = (instant: number) => {
    const p = ammanParts(new Date(instant));
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute)) - instant;
  };
  let instant = wall - offsetAt(wall);
  instant = wall - offsetAt(instant);
  const normalized = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}`;
  return ammanDateTimeInput(new Date(instant)) === normalized ? new Date(instant).toISOString() : undefined;
}
