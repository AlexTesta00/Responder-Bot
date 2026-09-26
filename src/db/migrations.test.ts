import { describe, expect, it, onTestFinished } from "vitest";

import { errorFields } from "../shared/errors.ts";
import { ok } from "../shared/result.ts";
import { createDatabase } from "./connection.ts";
import { migrateToLatest } from "./migrations.ts";
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
      ok(["0001_prospect_memory"]),
    );
    expect(await migrateToLatest(db)).toStrictEqual(ok([]));

    const tables = await db.introspection.getTables();
    expect(tables.map((table) => table.name).toSorted()).toStrictEqual([
      "generation_runs",
      "prospect_messages",
      "prospects",
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
