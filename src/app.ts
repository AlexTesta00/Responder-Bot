import { randomUUID } from "node:crypto";

import {
  fastify,
  LogController,
  type FastifyInstance,
  type LogLevel,
} from "fastify";

import { healthRoutes } from "./routes/health.ts";
import {
  telegramWebhookRoutes,
  type TelegramWebhookOptions,
} from "./routes/telegram-webhook.ts";

export type AppOptions = Readonly<{
  logLevel: LogLevel;
  /** Destination of the JSON log lines. Defaults to standard output. */
  logStream?: Readonly<{ write: (line: string) => void }>;
  telegramWebhook: TelegramWebhookOptions;
}>;

/**
 * Builds the HTTP application without starting it: tests exercise it through
 * `inject`, while the entry point decides where it listens.
 */
export const buildApp = async ({
  logLevel,
  logStream,
  telegramWebhook,
}: AppOptions): Promise<FastifyInstance> => {
  const app = fastify({
    logger:
      logStream === undefined
        ? { level: logLevel }
        : { level: logLevel, stream: logStream },
    // Random ids keep log correlation unique across restarts.
    genReqId: () => randomUUID(),
    logController: new LogController({ requestIdLogLabel: "request_id" }),
  });

  await app.register(healthRoutes);
  await app.register(telegramWebhookRoutes, telegramWebhook);

  return app;
};
