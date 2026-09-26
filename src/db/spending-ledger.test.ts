import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { describeSpendingLedger } from "../ai/spending-contract.test-support.ts";
import { createMysqlGenerationLog } from "./generation-log.ts";
import type { Database } from "./schema.ts";
import { createMysqlSpendingLedger } from "./spending-ledger.ts";
import {
  emptyTables,
  openTestDatabase,
  TEST_MYSQL_URL,
} from "./test-database.test-support.ts";

describe.skipIf(TEST_MYSQL_URL === undefined)("MySQL", () => {
  let opened: Kysely<Database> | undefined;

  beforeAll(async () => {
    opened = await openTestDatabase(TEST_MYSQL_URL ?? "", "spending");
  });

  afterAll(async () => {
    await opened?.destroy();
  });

  const database = async (): Promise<Kysely<Database>> => {
    if (opened === undefined) {
      throw new Error("the test database is not open");
    }
    await emptyTables(opened);
    return opened;
  };

  describeSpendingLedger("createMysqlSpendingLedger", async (now) => {
    const db = await database();
    return {
      generations: createMysqlGenerationLog(db, { now }),
      ledger: createMysqlSpendingLedger(db, { now }),
    };
  });

  describe("createMysqlSpendingLedger", () => {
    it("keeps credits too large for an INT", async () => {
      const db = await database();
      const ledger = createMysqlSpendingLedger(db);

      await ledger.setCredit(5_000_000_000);

      expect(await ledger.spending()).toMatchObject({
        credit: { amountMicroUsd: 5_000_000_000 },
      });
    });
  });
});
