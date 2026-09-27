import { describe, expect, it } from "vitest";

import {
  dayAndTime,
  daysBetween,
  fromDay,
  fullDate,
  longDay,
  relativeDay,
  romeDate,
  romeDay,
} from "./time.ts";

// Sunday 27 September 2026, 10:00 in Italy.
const NOW = new Date("2026-09-27T08:00:00Z");

describe("romeDate", () => {
  it("changes day at midnight in Italy, not in UTC", () => {
    expect(romeDate(new Date("2026-09-27T21:59:59.999Z"))).toBe("2026-09-27");
    expect(romeDate(new Date("2026-09-27T22:00:00Z"))).toBe("2026-09-28");
  });
});

describe("daysBetween", () => {
  it("counts calendar days, not 24-hour periods", () => {
    // Monday 23:50 to Thursday 00:10, in Italy.
    expect(
      daysBetween(
        new Date("2026-09-28T21:50:00Z"),
        new Date("2026-09-30T22:10:00Z"),
      ),
    ).toBe(3);
  });

  it("is not fooled by the changes of daylight saving time", () => {
    expect(
      daysBetween(
        new Date("2026-10-24T12:00:00Z"),
        new Date("2026-10-26T12:00:00Z"),
      ),
    ).toBe(2);
    expect(
      daysBetween(
        new Date("2026-03-28T12:00:00Z"),
        new Date("2026-03-30T12:00:00Z"),
      ),
    ).toBe(2);
  });

  it("is never negative", () => {
    expect(daysBetween(new Date("2026-09-30T08:00:00Z"), NOW)).toBe(0);
  });
});

describe("relativeDay", () => {
  it.each([
    ["2026-09-27T06:00:00Z", "oggi"],
    // 23:00 in Italy on the 26th.
    ["2026-09-26T21:00:00Z", "ieri"],
    ["2026-09-23T10:00:00Z", "4 giorni fa"],
    ["2026-08-28T10:00:00Z", "30 giorni fa"],
    ["2026-08-01T10:00:00Z", "il 01/08/2026"],
    // A clock ahead of the server's still reads as today.
    ["2026-09-28T10:00:00Z", "oggi"],
  ])("names %s as %j", (instant, label) => {
    expect(relativeDay(new Date(instant), NOW)).toBe(label);
  });
});

describe("fromDay", () => {
  const today = romeDay(NOW);

  it.each([
    [-2, "da oggi"],
    [0, "da oggi"],
    [1, "da domani"],
    [2, "da martedì 29/09"],
    [8, "da lunedì 05/10"],
  ])("names the day %i days ahead %j", (ahead, label) => {
    expect(fromDay(today + ahead, NOW)).toBe(label);
  });
});

describe("dates for Alex", () => {
  it("writes them the Italian way, in Italian time", () => {
    expect(longDay(NOW)).toBe("domenica 27 settembre");
    expect(dayAndTime(new Date("2026-09-27T08:42:00Z"))).toBe(
      "27/09 alle 10:42",
    );
    expect(fullDate(new Date("2026-09-24T22:30:00Z"))).toBe("25/09/2026");
  });
});
