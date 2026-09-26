import { randomUUID } from "node:crypto";
import { STATUS_CODES } from "node:http";

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

/** HTTP errors raised by Fastify carry their status; anything else is a 500. */
const statusCodeOf = (error: unknown): number =>
  typeof error === "object" &&
  error !== null &&
  "statusCode" in error &&
  typeof error.statusCode === "number" &&
  error.statusCode >= 400 &&
  error.statusCode < 600
    ? error.statusCode
    : 500;

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

  // Registered before the routes, so every route inherits it.
  app.setErrorHandler((error: unknown, request, reply) => {
    const statusCode = statusCodeOf(error);
    const reason = STATUS_CODES[statusCode] ?? "Error";

    if (statusCode < 500) {
      // Client errors raised by Fastify (invalid JSON, oversized body...)
      // describe the request, so their message is safe to return.
      request.log.info({ err: error }, "request rejected");
      const message = error instanceof Error ? error.message : reason;
      return reply
        .code(statusCode)
        .send({ statusCode, error: reason, message });
    }

    // Unexpected failures stay in the logs: their details are internal.
    request.log.error({ err: error }, "request failed");
    return reply
      .code(statusCode)
      .send({ statusCode, error: reason, message: reason });
  });

  await app.register(healthRoutes);
  await app.register(telegramWebhookRoutes, telegramWebhook);

  return app;
};
