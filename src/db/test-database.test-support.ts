import type { Kysely } from "kysely";
import { createConnection } from "mysql2/promise";

import type { DatabaseConfig } from "../config/env.ts";
import { createDatabase } from "./connection.ts";
import { migrateToLatest } from "./migrations.ts";
import type { Database } from "./schema.ts";

/**
 * Server for the database tests, such as
 * mysql://root:test@127.0.0.1:3307/responder_test (see compose.yaml). The
 * tests that need it are skipped when it is not set.
 */
export const TEST_MYSQL_URL = process.env["TEST_MYSQL_URL"];

const configOf = (url: string, suffix: string): DatabaseConfig => {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port === "" ? 3306 : Number(parsed.port),
    database: `${parsed.pathname.slice(1)}_${suffix}`,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
  };
};

/**
 * An empty database for one test file, named after the URL's database plus
 * `suffix`, so test files running in parallel never share tables.
 */
export const recreateTestDatabase = async (
  url: string,
  suffix: string,
): Promise<DatabaseConfig> => {
  const config = configOf(url, suffix);
  const server = await createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
  });
  try {
    await server.query(`DROP DATABASE IF EXISTS \`${config.database}\``);
    await server.query(
      `CREATE DATABASE \`${config.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } finally {
    await server.end();
  }
  return config;
};

/** An empty database for one test file, with the schema in place. */
export const openTestDatabase = async (
  url: string,
  suffix: string,
): Promise<Kysely<Database>> => {
  const db = createDatabase(await recreateTestDatabase(url, suffix));
  const migrated = await migrateToLatest(db);
  if (!migrated.ok) {
    await db.destroy();
    throw new Error("the test database could not be migrated", {
      cause: migrated.error.error,
    });
  }
  return db;
};

export const emptyTables = async (db: Kysely<Database>): Promise<void> => {
  await db.deleteFrom("prospect_messages").execute();
  await db.deleteFrom("generation_runs").execute();
  await db.deleteFrom("credit_balances").execute();
  await db.deleteFrom("prospect_sends").execute();
  await db.deleteFrom("telegram_list_items").execute();
  await db.deleteFrom("prospects").execute();
};
