import { sql } from "kysely";
import { Migrator } from "kysely/migration";
import { describe, expect, it, onTestFinished } from "vitest";

import { errorFields } from "../shared/errors.ts";
import { ok } from "../shared/result.ts";
import { createDatabase } from "./connection.ts";
import { migrateToLatest, MIGRATIONS } from "./migrations.ts";
import {
  recreateTestDatabase,
  TEST_MYSQL_URL,
} from "./test-database.test-support.ts";

describe.skipIf(TEST_MYSQL_URL === undefined)("migrateToLatest", () => {
  const url = TEST_MYSQL_URL ?? "";

  const freshDatabase = async () => {
    const db = createDatabase(await recreateTestDatabase(url, "migrations"));
    onTestFinished(() => db.destroy());
    return db;
  };

  it("creates the schema once, then has nothing left to apply", async () => {
    const db = await freshDatabase();

    expect(await migrateToLatest(db)).toStrictEqual(
      ok([
        "0001_prospect_memory",
        "0002_objections_and_commitments",
        "0003_stage_changes",
        "0004_telegram_messages",
        "0005_generation_costs",
        "0006_prospect_sends",
      ]),
    );
    expect(await migrateToLatest(db)).toStrictEqual(ok([]));

    const tables = await db.introspection.getTables();
    expect(tables.map((table) => table.name).toSorted()).toStrictEqual([
      "credit_balances",
      "generation_runs",
      "prospect_messages",
      "prospect_sends",
      "prospect_stage_changes",
      "prospects",
      "telegram_messages",
    ]);
  });

  it("keeps emojis and times exactly as written", async () => {
    const db = await freshDatabase();
    await migrateToLatest(db);
    const createdAt = new Date("2026-09-26T22:30:45.123Z");

    await db
      .insertInto("prospects")
      .values({
        id: "00000000-0000-4000-8000-000000000001",
        platform: "instagram",
        username: "mariofit",
        display_name: "Mario 💪🏼 Fit",
        business_type: null,
        facts: "[]",
        hypotheses: "[]",
        stage: null,
        intent: null,
        interest: null,
        next_goal: null,
        summary: null,
        objections: "[]",
        commitments: "[]",
        created_at: createdAt,
        updated_at: createdAt,
      })
      .execute();

    expect(
      await db
        .selectFrom("prospects")
        .select(["display_name", "created_at"])
        .executeTakeFirst(),
    ).toStrictEqual({ display_name: "Mario 💪🏼 Fit", created_at: createdAt });
  });

  it("fills in the new columns of prospects saved before them", async () => {
    const db = await freshDatabase();
    const migrator = new Migrator({
      db,
      provider: { getMigrations: () => Promise.resolve({ ...MIGRATIONS }) },
    });
    await migrator.migrateTo("0001_prospect_memory");
    await sql`
      INSERT INTO prospects
        (id, platform, username, facts, hypotheses, created_at, updated_at)
      VALUES
        ('00000000-0000-4000-8000-000000000001', 'instagram', 'mariofit',
         '[]', '[]', NOW(3), NOW(3))
    `.execute(db);

    expect(await migrateToLatest(db)).toStrictEqual(
      ok([
        "0002_objections_and_commitments",
        "0003_stage_changes",
        "0004_telegram_messages",
        "0005_generation_costs",
        "0006_prospect_sends",
      ]),
    );
    expect(
      await db
        .selectFrom("prospects")
        .select(["objections", "commitments"])
        .execute(),
    ).toStrictEqual([{ objections: "[]", commitments: "[]" }]);
  });

  it("estimates the cost of the generations recorded before costs were", async () => {
    const db = await freshDatabase();
    const migrator = new Migrator({
      db,
      provider: { getMigrations: () => Promise.resolve({ ...MIGRATIONS }) },
    });
    await migrator.migrateTo("0004_telegram_messages");
    await sql`
      INSERT INTO generation_runs
        (id, ai_mode, prompt, model, outcome, duration_ms,
         input_tokens, output_tokens, cache_read_tokens, stop_reason, created_at)
      VALUES
        ('00000000-0000-4000-8000-000000000001', 'SCREENSHOTS', 'p@1',
         'claude-opus-5', 'OK', 1000, 1200, 300, 800, 'end_turn', NOW(3)),
        ('00000000-0000-4000-8000-000000000002', 'PROSPECT_IDENTITY', 'p@1',
         'claude-haiku-4-5-20251001', 'OK', 1000, 1500, 20, NULL, 'end_turn', NOW(3)),
        ('00000000-0000-4000-8000-000000000003', 'SCREENSHOTS', 'p@1',
         'claude-future-9', 'OK', 1000, 1200, 300, 0, 'end_turn', NOW(3)),
        ('00000000-0000-4000-8000-000000000004', 'SCREENSHOTS', 'p@1',
         NULL, 'UNAVAILABLE', 1000, NULL, NULL, NULL, NULL, NOW(3))
    `.execute(db);

    await migrateToLatest(db);

    expect(
      await db
        .selectFrom("generation_runs")
        .select(["model", "cost_micro_usd", "cache_write_tokens"])
        .orderBy("id")
        .execute(),
    ).toStrictEqual([
      // 1200×5 + 300×25 + 800×0.5
      {
        model: "claude-opus-5",
        cost_micro_usd: 13_900,
        cache_write_tokens: null,
      },
      // 1500×1 + 20×5
      {
        model: "claude-haiku-4-5-20251001",
        cost_micro_usd: 1_600,
        cache_write_tokens: null,
      },
      {
        model: "claude-future-9",
        cost_micro_usd: null,
        cache_write_tokens: null,
      },
      { model: null, cost_micro_usd: null, cache_write_tokens: null },
    ]);
  });

  it("keeps one send per message of the bot, deleted with its prospect", async () => {
    const db = await freshDatabase();
    await migrateToLatest(db);
    const at = new Date("2026-09-27T08:42:00.500Z");
    await db
      .insertInto("prospects")
      .values({
        id: "00000000-0000-4000-8000-000000000001",
        platform: "instagram",
        username: "mariofit",
        display_name: null,
        business_type: null,
        facts: "[]",
        hypotheses: "[]",
        stage: null,
        intent: null,
        interest: null,
        next_goal: null,
        summary: null,
        objections: "[]",
        commitments: "[]",
        created_at: at,
        updated_at: at,
      })
      .execute();
    const send = {
      prospect_id: "00000000-0000-4000-8000-000000000001",
      chat_id: 42,
      message_id: 1_001,
      kind: "FIRST_MESSAGES",
      style: "BEST",
      body: "Ciao Mario 💪",
      sent_at: at,
    };

    await db.insertInto("prospect_sends").values(send).execute();
    await expect(
      db.insertInto("prospect_sends").values(send).execute(),
    ).rejects.toMatchObject({ errno: 1062 });
    expect(
      await db
        .selectFrom("prospect_sends")
        .select(["body", "sent_at"])
        .execute(),
    ).toStrictEqual([{ body: "Ciao Mario 💪", sent_at: at }]);

    await db.deleteFrom("prospects").execute();
    expect(
      await db.selectFrom("prospect_sends").select("id").execute(),
    ).toStrictEqual([]);
  });

  it("reports a failure without its message", async () => {
    const db = createDatabase({
      ...(await recreateTestDatabase(url, "migrations")),
      password: "wrong-password",
    });
    onTestFinished(() => db.destroy());

    const migrated = await migrateToLatest(db);

    if (migrated.ok) {
      expect.unreachable("the password is wrong");
    }
    expect(errorFields(migrated.error.error)).toMatchObject({
      error_code: "ER_ACCESS_DENIED_ERROR",
      errno: 1045,
    });
  });
});
