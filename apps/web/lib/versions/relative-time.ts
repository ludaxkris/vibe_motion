/**
 * The History tab's timestamp column: "12m ago", then "2h ago", then a
 * weekday, then a bare date, so a v0 from months ago never claims to be
 * "3000h ago" (`docs/design/README.md` "History tab").
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/** `Intl` with a fixed locale so the weekday/date read the same everywhere, in the viewer's own zone. */
const weekdayFormat = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const monthDayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/**
 * `iso` relative to `now`: "just now" under a minute, "Xm ago" under an hour,
 * "Xh ago" under a day, the weekday under a week, otherwise "Mon D" — all in
 * the viewer's local zone. An `iso` that does not parse returns "".
 *
 * `now` is always a prop from the caller — never `new Date()` here — so a
 * component's snapshot stays deterministic under test.
 */
export function relativeTime(iso: string, now: Date): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const elapsed = now.getTime() - then.getTime();

  if (elapsed < MINUTE_MS) return "just now";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m ago`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h ago`;
  if (elapsed < WEEK_MS) return weekdayFormat.format(then);
  return monthDayFormat.format(then);
}
