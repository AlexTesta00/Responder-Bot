// The behavior every place that adds up the costs of the generations must
// have, run against each implementation by its own test file.
import { describe, expect, it } from "vitest";

import type { GenerationReport } from "./engine.ts";
import type { GenerationLog } from "./runs.ts";
import type { SpendingLedger } from "./spending.ts";

/** Opens an empty ledger that reads the time from `now`. */
export type OpenSpending = (
  now: () => Date,
) => Promise<Readonly<{ generations: GenerationLog; ledger: SpendingLedger }>>;

const report = (costMicroUsd: number | null): GenerationReport => ({
  mode: "SCREENSHOTS",
  prompt: "test-prompt@1",
  model: "claude-opus-5",
  durationMs: 1_000,
  inputTokens: 1_000,
  outputTokens: 100,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costMicroUsd,
  stopReason: "end_turn",
});

export const describeSpendingLedger = (
  name: string,
  open: OpenSpending,
): void => {
  describe(name, () => {
    /** An empty ledger, with a clock the test moves. */
    const setup = async (start: string) => {
      let time = new Date(start);
      const opened = await open(() => time);
      return {
        ...opened,
        at: (when: string) => {
          time = new Date(when);
        },
        spend: (costMicroUsd: number | null) =>
          opened.generations.record({
            prospectId: null,
            report: report(costMicroUsd),
            outcome: "OK",
          }),
      };
    };

    it("starts with nothing spent and no credit", async () => {
      const { ledger } = await setup("2026-09-26T10:00:00Z");

      expect(await ledger.spending()).toStrictEqual({
        monthMicroUsd: 0,
        credit: null,
      });
    });

    it("adds up the costs of this month, in UTC", async () => {
      const { ledger, at, spend } = await setup("2026-08-31T23:59:59.999Z");
      await spend(50_000);
      at("2026-09-01T00:00:00Z");
      await spend(20_000);
      at("2026-09-26T10:00:00Z");
      await spend(13_900);
      // A generation without an estimate does not count.
      await spend(null);

      expect(await ledger.spending()).toMatchObject({ monthMicroUsd: 33_900 });

      at("2026-10-01T00:00:00Z");
      expect(await ledger.spending()).toMatchObject({ monthMicroUsd: 0 });
    });

    it("counts down the credit from when Alex set it", async () => {
      const { ledger, at, spend } = await setup("2026-09-20T10:00:00Z");
      await spend(40_000);
      at("2026-09-26T10:00:00Z");
      await ledger.setCredit(25_000_000);
      await spend(13_900);
      at("2026-10-02T08:00:00Z");
      await spend(6_100);

      expect(await ledger.spending()).toStrictEqual({
        monthMicroUsd: 6_100,
        credit: {
          amountMicroUsd: 25_000_000,
          setAt: new Date("2026-09-26T10:00:00Z"),
          spentMicroUsd: 20_000,
        },
      });
    });

    it("keeps only the last credit Alex set", async () => {
      const { ledger, at, spend } = await setup("2026-09-26T10:00:00Z");
      await ledger.setCredit(25_000_000);
      await spend(13_900);
      at("2026-09-26T11:00:00Z");
      await ledger.setCredit(24_500_000);

      expect(await ledger.spending()).toMatchObject({
        credit: {
          amountMicroUsd: 24_500_000,
          setAt: new Date("2026-09-26T11:00:00Z"),
          spentMicroUsd: 0,
        },
      });
    });
  });
};
