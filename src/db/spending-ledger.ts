import type { Kysely } from "kysely";
import { z } from "zod";

import { monthStart, type SpendingLedger } from "../ai/spending.ts";
import type { Database } from "./schema.ts";

// MySQL returns sums as DECIMAL strings, and may return BIGINT as strings.
const amount = z
  .union([z.number(), z.string().regex(/^\d+$/)])
  .transform(Number)
  .pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER));

const sumRow = z.object({ total: amount.nullable() });

const creditRow = z.object({ amount_micro_usd: amount, set_at: z.date() });

/** Adds up the costs recorded in generation_runs, and keeps the credit. */
export const createMysqlSpendingLedger = (
  db: Kysely<Database>,
  { now = () => new Date() }: Readonly<{ now?: () => Date }> = {},
): SpendingLedger => {
  const spentSince = async (start: Date): Promise<number> => {
    const row = await db
      .selectFrom("generation_runs")
      .select((eb) =>
        eb.fn.sum<string | number | null>("cost_micro_usd").as("total"),
      )
      .where("created_at", ">=", start)
      .executeTakeFirstOrThrow();
    return sumRow.parse(row).total ?? 0;
  };

  return {
    spending: async () => {
      const found = await db
        .selectFrom("credit_balances")
        .select(["amount_micro_usd", "set_at"])
        .orderBy("set_at", "desc")
        .orderBy("id", "desc")
        .limit(1)
        .executeTakeFirst();
      const credit = found === undefined ? null : creditRow.parse(found);
      return {
        monthMicroUsd: await spentSince(monthStart(now())),
        credit:
          credit === null
            ? null
            : {
                amountMicroUsd: credit.amount_micro_usd,
                setAt: credit.set_at,
                spentMicroUsd: await spentSince(credit.set_at),
              },
      };
    },

    setCredit: async (amountMicroUsd) => {
      await db
        .insertInto("credit_balances")
        .values({ amount_micro_usd: amountMicroUsd, set_at: now() })
        .execute();
    },
  };
};
