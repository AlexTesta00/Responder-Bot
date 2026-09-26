import { describe, expect, it } from "vitest";

import type { Spending } from "../ai/spending.ts";
import {
  costLine,
  creditSetReply,
  formatUsd,
  INVALID_CREDIT_REPLY,
  SPENDING_UNAVAILABLE_REPLY,
  spendingReport,
} from "./costs.ts";

const SET_AT = new Date("2026-09-26T08:30:00Z");

const month = (monthMicroUsd: number): Spending => ({
  monthMicroUsd,
  credit: null,
});

const withCredit = (
  monthMicroUsd: number,
  amountMicroUsd: number,
  spentMicroUsd: number,
): Spending => ({
  monthMicroUsd,
  credit: { amountMicroUsd, setAt: SET_AT, spentMicroUsd },
});

describe("formatUsd", () => {
  it.each([
    [0, "0,00 $"],
    [4_999, "&lt;0,01 $"],
    [5_000, "0,01 $"],
    [61_000, "0,06 $"],
    [1_234_560_000, "1234,56 $"],
    [-10, "0,00 $"],
  ])("writes %d millionths of a dollar as %j", (microUsd, text) => {
    expect(formatUsd(microUsd)).toBe(text);
  });
});

describe("costLine", () => {
  it("tells the cost, the month, what is left of the limit and the credit", () => {
    expect(
      costLine({
        costMicroUsd: 61_000,
        spending: withCredit(1_240_000, 25_000_000, 1_240_000),
        monthlyLimitMicroUsd: 20_000_000,
      }),
    ).toBe(
      "💳 Questa analisi ~0,06 $ · mese ~1,24 $, restano ~18,76 $ di 20,00 $ · credito ~23,76 $",
    );
  });

  it("leaves out what it does not know", () => {
    expect(
      costLine({
        costMicroUsd: null,
        spending: month(1_240_000),
        monthlyLimitMicroUsd: null,
      }),
    ).toBe("💳 Mese ~1,24 $");
    expect(
      costLine({
        costMicroUsd: 61_000,
        spending: null,
        monthlyLimitMicroUsd: 20_000_000,
      }),
    ).toBe("💳 Questa analisi ~0,06 $");
    expect(
      costLine({
        costMicroUsd: null,
        spending: null,
        monthlyLimitMicroUsd: 20_000_000,
      }),
    ).toBeNull();
  });

  it("warns when the month is close to its limit", () => {
    expect(
      costLine({
        costMicroUsd: 61_000,
        spending: month(18_000_000),
        monthlyLimitMicroUsd: 20_000_000,
      }),
    ).toMatch(/^⚠️ .*restano ~2,00 \$ di 20,00 \$$/);
    expect(
      costLine({
        costMicroUsd: 61_000,
        spending: month(25_000_000),
        monthlyLimitMicroUsd: 20_000_000,
      }),
    ).toContain("restano ~0,00 $");
  });

  it("warns when the credit is running out", () => {
    expect(
      costLine({
        costMicroUsd: 61_000,
        spending: withCredit(0, 3_000_000, 1_500_000),
        monthlyLimitMicroUsd: null,
      }),
    ).toBe("⚠️ Questa analisi ~0,06 $ · mese ~0,00 $ · credito ~1,50 $");
  });
});

describe("spendingReport", () => {
  it("reports the month, the limit and the credit", () => {
    expect(
      spendingReport(withCredit(1_240_000, 25_000_000, 300_000), 20_000_000),
    ).toBe(
      [
        "💳 <b>Costi stimati</b>",
        "Questo mese: ~1,24 $, restano ~18,76 $ di 20,00 $",
        "Credito: ~24,70 $ (25,00 $ il 26/09, meno ~0,30 $ spesi da allora)",
        "",
        "Sono stime calcolate dai token di ogni analisi: le cifre esatte sono sulla Console di Claude.",
      ].join("\n"),
    );
  });

  it("explains how to set the credit", () => {
    expect(spendingReport(month(0), null)).toContain(
      "Credito: non impostato. Leggilo sulla Console di Claude e scrivilo qui, per esempio /credito 25,40.",
    );
  });
});

describe("credit replies", () => {
  it("confirms the credit", () => {
    expect(creditSetReply(25_400_000)).toBe(
      "✅ Credito impostato a 25,40 $: da ora tolgo il costo stimato di ogni analisi.",
    );
  });

  it("explains how to write it, and when the costs cannot be read", () => {
    expect(INVALID_CREDIT_REPLY).toContain("/credito 25,40");
    expect(SPENDING_UNAVAILABLE_REPLY).toContain("database");
  });
});
