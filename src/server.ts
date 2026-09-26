// Process entry point: the imperative shell. It validates the environment,
// wires the dependencies, starts the HTTP application and closes it
// gracefully on shutdown signals.
//
// No top-level await here or in any module this file imports: Hostinger's
// LiteSpeed loads the entry file with require(), which cannot load ES modules
// that use it (ERR_REQUIRE_ASYNC_MODULE).
import Anthropic from "@anthropic-ai/sdk";
import type { FastifyInstance, LogLevel } from "fastify";
import type { Kysely } from "kysely";

import { createClaudeEngine } from "./ai/claude.ts";
import type { GenerationLog } from "./ai/runs.ts";
import { createInMemorySpending, type SpendingLedger } from "./ai/spending.ts";
import { buildApp } from "./app.ts";
import {
  databaseConfigOf,
  describeEnvError,
  monthlyLimitOf,
  parseEnv,
  type Env,
  type NodeEnv,
} from "./config/env.ts";
import { createButtonActions } from "./copilot/buttons.ts";
import { createConversationAnalyst } from "./copilot/conversation.ts";
import { createScreenshotsAnalyst } from "./copilot/screenshots.ts";
import { createDatabase } from "./db/connection.ts";
import { createMysqlGenerationLog } from "./db/generation-log.ts";
import { migrateToLatest } from "./db/migrations.ts";
import { createMysqlProspectStore } from "./db/prospect-store.ts";
import type { Database } from "./db/schema.ts";
import { createMysqlSpendingLedger } from "./db/spending-ledger.ts";
import { createInMemoryProspectStore } from "./prospects/store.ts";
import { errorFields } from "./shared/errors.ts";
import { createTelegramClient } from "./telegram/client.ts";
import { createImageDownloader } from "./telegram/files.ts";
import { createInFlight } from "./telegram/in-flight.ts";
import { scheduleWithTimers } from "./telegram/media-group.ts";
import { createProcessedUpdates } from "./telegram/processed-updates.ts";
import { createUpdateHandler } from "./telegram/webhook-handler.ts";

/** How many recent update ids are remembered to recognize redeliveries. */
const PROCESSED_UPDATES_CAPACITY = 1_000;

/** Screenshots stay far below this; Telegram serves bots files up to 20 MB. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Per attempt: an analysis of a few screenshots takes well under this. */
const ANTHROPIC_TIMEOUT_MS = 120_000;

/** Retries of rate limits, overloads and network failures, with backoff. */
const ANTHROPIC_MAX_RETRIES = 2;

/** Verbose while developing, quiet in tests, informative in production. */
const LOG_LEVEL_BY_ENV = {
  development: "debug",
  test: "silent",
  production: "info",
} as const satisfies Readonly<Record<NodeEnv, LogLevel>>;

const closeOnSignal =
  (app: FastifyInstance) =>
  (signal: NodeJS.Signals): void => {
    app.log.info({ signal }, "shutting down");
    app.close().then(
      () => process.exit(0),
      (error: unknown) => {
        app.log.error({ err: error }, "shutdown failed");
        process.exit(1);
      },
    );
  };

/** Where the costs of the generations are recorded and added up. */
const costsOf = (
  database: Kysely<Database> | null,
): Readonly<{ generations: GenerationLog; spending: SpendingLedger }> => {
  if (database === null) {
    // Without a database, the costs last until the process stops.
    const memory = createInMemorySpending();
    return { generations: memory, spending: memory };
  }
  return {
    generations: createMysqlGenerationLog(database),
    spending: createMysqlSpendingLedger(database),
  };
};

const start = async (env: Env): Promise<void> => {
  const telegram = createTelegramClient({ token: env.TELEGRAM_BOT_TOKEN });
  const claude = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    timeout: ANTHROPIC_TIMEOUT_MS,
    maxRetries: ANTHROPIC_MAX_RETRIES,
  });
  const ai = createClaudeEngine({
    client: claude,
    model: env.ANTHROPIC_MODEL,
    fastModel: env.ANTHROPIC_FAST_MODEL,
  });
  const databaseConfig = databaseConfigOf(env);
  const database =
    databaseConfig === null ? null : createDatabase(databaseConfig);
  const prospects =
    database === null
      ? createInMemoryProspectStore()
      : createMysqlProspectStore(database);
  const { generations, spending } = costsOf(database);

  const app = await buildApp({
    logLevel: LOG_LEVEL_BY_ENV[env.NODE_ENV],
    telegramWebhook: {
      secret: env.TELEGRAM_WEBHOOK_SECRET,
      handleUpdate: createUpdateHandler({
        allowedUserId: env.TELEGRAM_ALLOWED_USER_ID,
        processedUpdates: createProcessedUpdates(PROCESSED_UPDATES_CAPACITY),
        sendMessage: telegram.sendMessage,
        sendTyping: telegram.sendTyping,
        downloadImage: createImageDownloader(telegram, MAX_IMAGE_BYTES),
        analyzeScreenshots: createScreenshotsAnalyst({
          ai,
          prospects,
          generations,
        }),
        replyToConversation: createConversationAnalyst({
          ai,
          prospects,
          generations,
        }),
        pressButton: createButtonActions({ ai, prospects, generations }),
        answerCallbackQuery: telegram.answerCallbackQuery,
        inFlight: createInFlight(),
        linkMessages: prospects.linkMessages,
        spending,
        monthlyLimitMicroUsd: monthlyLimitOf(env),
        schedule: scheduleWithTimers,
      }),
    },
  });

  if (database === null) {
    app.log.warn(
      "no database configured: prospect memory lasts until the process stops",
    );
  } else {
    app.addHook("onClose", async () => {
      await database.destroy();
    });
    // The schema must be up to date before the first update arrives.
    const migrated = await migrateToLatest(database);
    if (!migrated.ok) {
      app.log.fatal(
        {
          migration: migrated.error.migration,
          ...errorFields(migrated.error.error),
        },
        "database migration failed",
      );
      process.exit(1);
    }
    app.log.info({ applied_migrations: migrated.value }, "database ready");
  }

  process.once("SIGINT", closeOnSignal(app));
  process.once("SIGTERM", closeOnSignal(app));

  try {
    await app.listen({ host: env.HOST, port: env.PORT });
  } catch (error) {
    app.log.fatal({ err: error }, "server failed to start");
    process.exit(1);
  }
};

const env = parseEnv(process.env);

if (!env.ok) {
  process.stderr.write(`${describeEnvError(env.error)}\n`);
  process.exit(1);
}

start(env.value).catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : "unknown error";
  process.stderr.write(`Startup failed: ${reason}\n`);
  process.exit(1);
});
