import { describe, expect, it } from "vitest";

import { describeSpendingLedger } from "./spending-contract.test-support.ts";
import { createInMemorySpending, monthStart, remaining } from "./spending.ts";

describeSpendingLedger("createInMemorySpending", (now) => {
  const spending = createInMemorySpending({ now });
  return Promise.resolve({ generations: spending, ledger: spending });
});

describe("monthStart", () => {
  it("is midnight UTC on the first day of the month", () => {
    expect(monthStart(new Date("2026-09-26T23:30:00+02:00"))).toStrictEqual(
      new Date("2026-09-01T00:00:00Z"),
    );
    expect(monthStart(new Date("2026-10-01T00:30:00+02:00"))).toStrictEqual(
      new Date("2026-09-01T00:00:00Z"),
    );
  });
});

describe("remaining", () => {
  const setAt = new Date("2026-09-26T10:00:00Z");

  it("is the credit less what was spent since", () => {
    expect(
      remaining({ amountMicroUsd: 25_000_000, setAt, spentMicroUsd: 13_900 }),
    ).toBe(24_986_100);
  });

  it("never goes below zero", () => {
    expect(
      remaining({ amountMicroUsd: 10_000, setAt, spentMicroUsd: 13_900 }),
    ).toBe(0);
  });
});
