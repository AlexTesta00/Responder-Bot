// Process entry point: the imperative shell. It validates the environment,
// wires the dependencies, starts the HTTP application and closes it
// gracefully on shutdown signals.
//
// No top-level await here or in any module this file imports: Hostinger's
// LiteSpeed loads the entry file with require(), which cannot load ES modules
// that use it (ERR_REQUIRE_ASYNC_MODULE).
import type { FastifyInstance, LogLevel } from "fastify";

import { buildApp } from "./app.ts";
import {
  describeEnvError,
  parseEnv,
  type Env,
  type NodeEnv,
} from "./config/env.ts";
import { createTelegramClient } from "./telegram/client.ts";
import { createProcessedUpdates } from "./telegram/processed-updates.ts";
import { createUpdateHandler } from "./telegram/webhook-handler.ts";

/** How many recent update ids are remembered to recognize redeliveries. */
const PROCESSED_UPDATES_CAPACITY = 1_000;

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

const start = async (env: Env): Promise<void> => {
  const telegram = createTelegramClient({ token: env.TELEGRAM_BOT_TOKEN });

  const app = await buildApp({
    logLevel: LOG_LEVEL_BY_ENV[env.NODE_ENV],
    telegramWebhook: {
      secret: env.TELEGRAM_WEBHOOK_SECRET,
      handleUpdate: createUpdateHandler({
        allowedUserId: env.TELEGRAM_ALLOWED_USER_ID,
        processedUpdates: createProcessedUpdates(PROCESSED_UPDATES_CAPACITY),
        sendMessage: telegram.sendMessage,
      }),
    },
  });

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
