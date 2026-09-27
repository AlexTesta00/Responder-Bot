import { sql, type Kysely } from "kysely";
import { Migrator, type Migration } from "kysely/migration";

import { pricesOf } from "../ai/pricing.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type { Database } from "./schema.ts";

// utf8mb4 stores the emojis of Instagram messages; the collation is one that
// both MariaDB and MySQL support.
const TABLE_OPTIONS = sql.raw(
  "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
);

/**
 * Every change to the schema, in the order it runs, which is the order of the
 * names. A migration that has run must never change: add a new one instead.
 */
export const MIGRATIONS: Readonly<Record<string, Migration>> = {
  "0001_prospect_memory": {
    up: async (db) => {
      await sql`
        CREATE TABLE prospects (
          id CHAR(36) CHARACTER SET ascii NOT NULL,
          platform VARCHAR(20) CHARACTER SET ascii NOT NULL,
          username VARCHAR(30) NOT NULL,
          display_name VARCHAR(100) NULL,
          business_type VARCHAR(100) NULL,
          facts TEXT NOT NULL,
          hypotheses TEXT NOT NULL,
          stage VARCHAR(40) CHARACTER SET ascii NULL,
          intent VARCHAR(40) CHARACTER SET ascii NULL,
          interest VARCHAR(20) CHARACTER SET ascii NULL,
          next_goal VARCHAR(40) CHARACTER SET ascii NULL,
          summary TEXT NULL,
          created_at DATETIME(3) NOT NULL,
          updated_at DATETIME(3) NOT NULL,
          PRIMARY KEY (id),
          UNIQUE KEY prospects_platform_username (platform, username)
        ) ${TABLE_OPTIONS}
      `.execute(db);

      await sql`
        CREATE TABLE prospect_messages (
          prospect_id CHAR(36) CHARACTER SET ascii NOT NULL,
          seq INT UNSIGNED NOT NULL,
          author VARCHAR(10) CHARACTER SET ascii NOT NULL,
          body TEXT NOT NULL,
          created_at DATETIME(3) NOT NULL,
          PRIMARY KEY (prospect_id, seq),
          CONSTRAINT prospect_messages_prospect_fk FOREIGN KEY (prospect_id)
            REFERENCES prospects (id) ON DELETE CASCADE
        ) ${TABLE_OPTIONS}
      `.execute(db);

      await sql`
        CREATE TABLE generation_runs (
          id CHAR(36) CHARACTER SET ascii NOT NULL,
          prospect_id CHAR(36) CHARACTER SET ascii NULL,
          ai_mode VARCHAR(40) CHARACTER SET ascii NOT NULL,
          prompt VARCHAR(500) CHARACTER SET ascii NOT NULL,
          model VARCHAR(100) CHARACTER SET ascii NULL,
          outcome VARCHAR(40) CHARACTER SET ascii NOT NULL,
          duration_ms INT UNSIGNED NOT NULL,
          input_tokens INT UNSIGNED NULL,
          output_tokens INT UNSIGNED NULL,
          cache_read_tokens INT UNSIGNED NULL,
          stop_reason VARCHAR(40) CHARACTER SET ascii NULL,
          created_at DATETIME(3) NOT NULL,
          PRIMARY KEY (id),
          KEY generation_runs_prospect_id (prospect_id),
          KEY generation_runs_created_at (created_at),
          CONSTRAINT generation_runs_prospect_fk FOREIGN KEY (prospect_id)
            REFERENCES prospects (id) ON DELETE SET NULL
        ) ${TABLE_OPTIONS}
      `.execute(db);
    },
  },
  "0002_objections_and_commitments": {
    up: async (db) => {
      // Added as nullable, filled in for existing prospects, then required:
      // the portable way to give TEXT columns a value on MySQL and MariaDB.
      await sql`
        ALTER TABLE prospects
          ADD COLUMN objections TEXT NULL,
          ADD COLUMN commitments TEXT NULL
      `.execute(db);
      await sql`
        UPDATE prospects SET objections = '[]', commitments = '[]'
      `.execute(db);
      await sql`
        ALTER TABLE prospects
          MODIFY objections TEXT NOT NULL,
          MODIFY commitments TEXT NOT NULL
      `.execute(db);
    },
  },
  "0003_stage_changes": {
    up: async (db) => {
      await sql`
        CREATE TABLE prospect_stage_changes (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          prospect_id CHAR(36) CHARACTER SET ascii NOT NULL,
          from_stage VARCHAR(40) CHARACTER SET ascii NULL,
          to_stage VARCHAR(40) CHARACTER SET ascii NOT NULL,
          changed_at DATETIME(3) NOT NULL,
          PRIMARY KEY (id),
          KEY prospect_stage_changes_prospect (prospect_id, changed_at),
          CONSTRAINT prospect_stage_changes_prospect_fk FOREIGN KEY (prospect_id)
            REFERENCES prospects (id) ON DELETE CASCADE
        ) ${TABLE_OPTIONS}
      `.execute(db);
    },
  },
  "0004_telegram_messages": {
    up: async (db) => {
      await sql`
        CREATE TABLE telegram_messages (
          chat_id BIGINT NOT NULL,
          message_id BIGINT NOT NULL,
          prospect_id CHAR(36) CHARACTER SET ascii NOT NULL,
          created_at DATETIME(3) NOT NULL,
          PRIMARY KEY (chat_id, message_id),
          KEY telegram_messages_prospect_id (prospect_id),
          CONSTRAINT telegram_messages_prospect_fk FOREIGN KEY (prospect_id)
            REFERENCES prospects (id) ON DELETE CASCADE
        ) ${TABLE_OPTIONS}
      `.execute(db);
    },
  },
  "0005_generation_costs": {
    up: async (db) => {
      await sql`
        ALTER TABLE generation_runs
          ADD COLUMN cache_write_tokens INT UNSIGNED NULL AFTER cache_read_tokens,
          ADD COLUMN cost_micro_usd INT UNSIGNED NULL AFTER cache_write_tokens
      `.execute(db);
      // The runs recorded so far get the estimate the prices of today give
      // them. Their cache writes were not recorded, so it is a little low.
      const { rows } = await sql<{ model: string }>`
        SELECT DISTINCT model FROM generation_runs WHERE model IS NOT NULL
      `.execute(db);
      for (const { model } of rows) {
        const prices = pricesOf(model);
        if (prices !== undefined) {
          await sql`
            UPDATE generation_runs
            SET cost_micro_usd = ROUND(
              COALESCE(input_tokens, 0) * ${prices.input}
              + COALESCE(output_tokens, 0) * ${prices.output}
              + COALESCE(cache_read_tokens, 0) * ${prices.cacheRead}
            )
            WHERE model = ${model}
          `.execute(db);
        }
      }
      await sql`
        CREATE TABLE credit_balances (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          amount_micro_usd BIGINT UNSIGNED NOT NULL,
          set_at DATETIME(3) NOT NULL,
          PRIMARY KEY (id),
          KEY credit_balances_set_at (set_at)
        ) ${TABLE_OPTIONS}
      `.execute(db);
    },
  },
  // What Alex marked as sent, one per message of the bot: the kind, the
  // style and the text of the suggestion, when known.
  "0006_prospect_sends": {
    up: async (db) => {
      await sql`
        CREATE TABLE prospect_sends (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          prospect_id CHAR(36) CHARACTER SET ascii NOT NULL,
          chat_id BIGINT NOT NULL,
          message_id BIGINT NOT NULL,
          kind VARCHAR(20) CHARACTER SET ascii NOT NULL,
          style VARCHAR(20) CHARACTER SET ascii NULL,
          body TEXT NULL,
          sent_at DATETIME(3) NOT NULL,
          PRIMARY KEY (id),
          UNIQUE KEY prospect_sends_bot_message (chat_id, message_id),
          KEY prospect_sends_prospect (prospect_id, sent_at),
          CONSTRAINT prospect_sends_prospect_fk FOREIGN KEY (prospect_id)
            REFERENCES prospects (id) ON DELETE CASCADE
        ) ${TABLE_OPTIONS}
      `.execute(db);
    },
  },
};

export type MigrationFailure = Readonly<{
  type: "MIGRATION_FAILED";
  /** The migration that failed, or null if none could start. */
  migration: string | null;
  error: unknown;
}>;

/**
 * Applies the migrations that have not run yet and returns their names. A
 * lock table keeps two processes from migrating at the same time.
 */
export const migrateToLatest = async (
  db: Kysely<Database>,
): Promise<Result<readonly string[], MigrationFailure>> => {
  const migrator = new Migrator({
    db,
    provider: { getMigrations: () => Promise.resolve({ ...MIGRATIONS }) },
  });
  const { error, results = [] } = await migrator.migrateToLatest();

  if (error !== undefined) {
    return err({
      type: "MIGRATION_FAILED",
      migration:
        results.find((result) => result.status === "Error")?.migrationName ??
        null,
      error,
    });
  }
  return ok(results.map((result) => result.migrationName));
};
