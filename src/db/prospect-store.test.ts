import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { GenerationReport } from "../ai/engine.ts";
import type { ConversationMessage } from "../conversations/domain.ts";
import { describeProspectStore } from "../prospects/store-contract.test-support.ts";
import { createMysqlGenerationLog } from "./generation-log.ts";
import { createMysqlProspectStore } from "./prospect-store.ts";
import type { Database } from "./schema.ts";
import {
  emptyTables,
  openTestDatabase,
  TEST_MYSQL_URL,
} from "./test-database.test-support.ts";

describe.skipIf(TEST_MYSQL_URL === undefined)("MySQL", () => {
  let opened: Kysely<Database> | undefined;

  beforeAll(async () => {
    opened = await openTestDatabase(TEST_MYSQL_URL ?? "", "stores");
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

  describeProspectStore("createMysqlProspectStore", async (dependencies) =>
    createMysqlProspectStore(await database(), dependencies),
  );

  describe("createMysqlProspectStore", () => {
    const profile = {
      username: "mariofit",
      displayName: null,
      businessType: null,
      facts: [],
      hypotheses: [],
      conversation: null,
      summary: null,
      objections: [],
      commitments: [],
    };

    it("appends the messages of concurrent saves one after the other", async () => {
      const store = createMysqlProspectStore(await database());
      await store.save({ profile, newMessages: [] });
      const message = (text: string): ConversationMessage => ({
        author: "PROSPECT",
        text,
      });

      await Promise.all([
        store.save({ profile, newMessages: [message("uno"), message("due")] }),
        store.save({ profile, newMessages: [message("tre")] }),
      ]);

      const memory = await store.load("mariofit");
      expect(
        memory?.messages.map((stored) => stored.text).toSorted(),
      ).toStrictEqual(["due", "tre", "uno"]);
    });

    it("refuses rows it cannot trust", async () => {
      const db = await database();
      const store = createMysqlProspectStore(db);
      await store.save({ profile, newMessages: [] });
      await db
        .updateTable("prospects")
        .set({ stage: "SOMETHING_ELSE" })
        .execute();

      await expect(store.load("mariofit")).rejects.toThrow();
    });
  });

  describe("createMysqlGenerationLog", () => {
    it("records what a generation cost, never what it said", async () => {
      const db = await database();
      const report: GenerationReport = {
        mode: "SCREENSHOTS",
        prompt: "system-policy@2+screenshots@2",
        model: "claude-opus-5",
        durationMs: 12_345.6,
        inputTokens: 5_400,
        outputTokens: 900,
        cacheReadTokens: 2_048,
        stopReason: "end_turn",
      };

      await createMysqlGenerationLog(db, {
        now: () => new Date("2026-09-26T10:00:00.250Z"),
        newId: () => "00000000-0000-4000-8000-000000000001",
      }).record({ prospectId: null, report, outcome: "OK" });

      expect(
        await db.selectFrom("generation_runs").selectAll().execute(),
      ).toStrictEqual([
        {
          id: "00000000-0000-4000-8000-000000000001",
          prospect_id: null,
          ai_mode: "SCREENSHOTS",
          prompt: "system-policy@2+screenshots@2",
          model: "claude-opus-5",
          outcome: "OK",
          duration_ms: 12_346,
          input_tokens: 5_400,
          output_tokens: 900,
          cache_read_tokens: 2_048,
          stop_reason: "end_turn",
          created_at: new Date("2026-09-26T10:00:00.250Z"),
        },
      ]);
    });
  });
});
