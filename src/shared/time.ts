// Calendar days as Alex lives them, in Italy. Instants are stored in UTC;
// waits and labels count days of the calendar in Europe/Rome, so a message
// sent at 23:50 was sent "yesterday" ten minutes later, and daylight saving
// never makes a day longer or shorter.

const TIME_ZONE = "Europe/Rome";

const DAY_MS = 86_400_000;

/** A calendar day in Italy, counted in days since 1 January 1970. */
export type RomeDay = number;

// en-CA writes dates as YYYY-MM-DD.
const ISO_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// Calendar days are formatted as UTC midnights: no time zone moves them.
const WEEKDAY = new Intl.DateTimeFormat("it-IT", {
  weekday: "long",
  timeZone: "UTC",
});

const DAY_MONTH = new Intl.DateTimeFormat("it-IT", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
});

const FULL_DATE = new Intl.DateTimeFormat("it-IT", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: TIME_ZONE,
});

const LONG_DAY = new Intl.DateTimeFormat("it-IT", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: TIME_ZONE,
});

const DAY_AND_TIME = new Intl.DateTimeFormat("it-IT", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TIME_ZONE,
});

// A relative day this far back reads better as a date.
const MAX_RELATIVE_DAYS = 30;

/** The day of an instant in Italy, as YYYY-MM-DD. */
export const romeDate = (instant: Date): string => ISO_DATE.format(instant);

export const romeDay = (instant: Date): RomeDay => {
  const [year = 1970, month = 1, day = 1] = romeDate(instant)
    .split("-")
    .map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
};

/**
 * Calendar days in Italy from `from` to `to`: 3 from Monday 23:50 to
 * Thursday 00:10. Never negative, even when clocks disagree.
 */
export const daysBetween = (from: Date, to: Date): number =>
  Math.max(0, romeDay(to) - romeDay(from));

/** "oggi", "ieri", "4 giorni fa", then "il 12/08/2026". */
export const relativeDay = (instant: Date, now: Date): string => {
  const days = daysBetween(instant, now);
  if (days === 0) {
    return "oggi";
  }
  if (days === 1) {
    return "ieri";
  }
  return days <= MAX_RELATIVE_DAYS
    ? `${String(days)} giorni fa`
    : `il ${FULL_DATE.format(instant)}`;
};

/** From when something is due: "da oggi", "da domani", "da martedì 29/09". */
export const fromDay = (day: RomeDay, now: Date): string => {
  const ahead = day - romeDay(now);
  if (ahead <= 0) {
    return "da oggi";
  }
  if (ahead === 1) {
    return "da domani";
  }
  const date = new Date(day * DAY_MS);
  return `da ${WEEKDAY.format(date)} ${DAY_MONTH.format(date)}`;
};

/** "domenica 27 settembre". */
export const longDay = (instant: Date): string => LONG_DAY.format(instant);

/** "27/09 alle 10:42". */
export const dayAndTime = (instant: Date): string =>
  DAY_AND_TIME.format(instant).replace(", ", " alle ");

/** "25/09/2026". */
export const fullDate = (instant: Date): string => FULL_DATE.format(instant);
