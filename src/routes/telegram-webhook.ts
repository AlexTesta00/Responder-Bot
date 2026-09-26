import { createHash, timingSafeEqual } from "node:crypto";

import type { FastifyBaseLogger, FastifyPluginCallback } from "fastify";

import { parseUpdate, type IncomingUpdate } from "../telegram/update.ts";
import type {
  UpdateHandler,
  UpdateOutcome,
} from "../telegram/webhook-handler.ts";

export const TELEGRAM_WEBHOOK_PATH = "/telegram/webhook";

const SECRET_HEADER = "x-telegram-bot-api-secret-token";

export type TelegramWebhookOptions = Readonly<{
  /** Sent by Telegram in every request; set when registering the webhook. */
  secret: string;
  handleUpdate: UpdateHandler;
}>;

const sha256 = (value: string): Buffer =>
  createHash("sha256").update(value).digest();

/** Constant-time check; hashing first also hides the secret's length. */
const isValidSecret = (expected: string, received: unknown): boolean =>
  typeof received === "string" &&
  timingSafeEqual(sha256(expected), sha256(received));

const senderOf = (update: IncomingUpdate): number | null => {
  switch (update.type) {
    case "MESSAGE":
      return update.message.senderId;
    case "CALLBACK":
      return update.callback.senderId;
    case "UNSUPPORTED":
      return null;
  }
};

const logOutcome = (
  log: FastifyBaseLogger,
  update: IncomingUpdate,
  outcome: UpdateOutcome,
): void => {
  const fields = { telegram_update_id: update.updateId, outcome: outcome.type };

  switch (outcome.type) {
    case "REPLIED":
      log.info({ ...fields, input: outcome.input }, "telegram update handled");
      return;
    case "ACCEPTED":
      log.info(
        { ...fields, input: outcome.input },
        "telegram update accepted for processing",
      );
      return;
    case "COLLECTED":
      log.info(fields, "telegram update collected into an album");
      return;
    case "PRESSED":
      log.info(
        { ...fields, button: outcome.button, kind: outcome.kind },
        "telegram button pressed",
      );
      return;
    case "IGNORED":
      if (outcome.reason === "UNAUTHORIZED_SENDER") {
        // The sender id helps to spot a wrong TELEGRAM_ALLOWED_USER_ID.
        log.warn(
          {
            ...fields,
            reason: outcome.reason,
            sender_id: senderOf(update),
          },
          "telegram update ignored",
        );
        return;
      }
      log.info(
        { ...fields, reason: outcome.reason },
        "telegram update ignored",
      );
      return;
    case "FAILED":
      log.error(
        {
          ...fields,
          retryable: outcome.retryable,
          error_type: outcome.error.type,
          telegram_error: outcome.error,
        },
        "telegram update failed",
      );
      return;
  }
};

/** Endpoint Telegram calls with every update addressed to the bot. */
export const telegramWebhookRoutes: FastifyPluginCallback<
  TelegramWebhookOptions
> = (app, { secret, handleUpdate }, done) => {
  app.post(
    TELEGRAM_WEBHOOK_PATH,
    {
      // Runs before the body is parsed, so forged requests cost almost nothing.
      onRequest: (request, reply, next) => {
        if (isValidSecret(secret, request.headers[SECRET_HEADER])) {
          next();
          return;
        }
        request.log.warn("telegram webhook rejected: invalid secret");
        void reply.code(401).send();
      },
    },
    async (request, reply) => {
      const update = parseUpdate(request.body);

      if (!update.ok) {
        // Acknowledged anyway: Telegram would keep resending a payload the
        // bot cannot read.
        request.log.warn(
          { invalid_fields: update.error.fields },
          "telegram update ignored: invalid payload",
        );
        return reply.code(200).send();
      }

      const outcome = await handleUpdate(update.value, request.log);
      logOutcome(request.log, update.value, outcome);

      // Any status other than 2xx makes Telegram deliver the update again.
      const retry = outcome.type === "FAILED" && outcome.retryable;
      return reply.code(retry ? 500 : 200).send();
    },
  );
  done();
};
