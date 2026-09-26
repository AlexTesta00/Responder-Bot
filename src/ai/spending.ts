// What the bot spends on generations, compared with the monthly limit and the
// credit Alex set on the Claude Console. The figures are estimates, adding up
// the cost of each generation (see pricing.ts).
import type { GenerationLog } from "./runs.ts";

/** The credit Alex last read on the Console and what the bot spent since. */
export type Credit = Readonly<{
  amountMicroUsd: number;
  setAt: Date;
  spentMicroUsd: number;
}>;

export type Spending = Readonly<{
  /** Estimated cost of this calendar month's generations, in UTC. */
  monthMicroUsd: number;
  credit: Credit | null;
}>;

/** Where the cost of the generations adds up. */
export type SpendingLedger = Readonly<{
  spending: () => Promise<Spending>;
  /** The credit Alex reads on the Console, in millionths of a dollar. */
  setCredit: (amountMicroUsd: number) => Promise<void>;
}>;

/** The start of the calendar month, in UTC, like the Console's limits. */
export const monthStart = (at: Date): Date =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));

/** Credit and spending left, never below zero. */
export const remaining = (credit: Credit): number =>
  Math.max(0, credit.amountMicroUsd - credit.spentMicroUsd);

type Cost = Readonly<{ at: Date; microUsd: number }>;

/**
 * Generations and credit kept in memory, for development without a
 * database: only the costs are kept, and they are lost on restart.
 */
export const createInMemorySpending = ({
  now = () => new Date(),
}: Readonly<{ now?: () => Date }> = {}): GenerationLog & SpendingLedger => {
  let costs: readonly Cost[] = [];
  let credit: Readonly<{ amountMicroUsd: number; setAt: Date }> | null = null;

  const spentSince = (start: Date): number =>
    costs
      .filter((cost) => cost.at.getTime() >= start.getTime())
      .reduce((total, cost) => total + cost.microUsd, 0);

  return {
    record: ({ report }) => {
      const microUsd = report.costMicroUsd;
      if (microUsd !== null) {
        costs = [...costs, { at: now(), microUsd }];
      }
      return Promise.resolve();
    },
    spending: () =>
      Promise.resolve({
        monthMicroUsd: spentSince(monthStart(now())),
        credit:
          credit === null
            ? null
            : { ...credit, spentMicroUsd: spentSince(credit.setAt) },
      }),
    setCredit: (amountMicroUsd) => {
      credit = { amountMicroUsd, setAt: now() };
      return Promise.resolve();
    },
  };
};
