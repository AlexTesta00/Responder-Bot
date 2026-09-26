import { describe, expect, it, onTestFinished, vi } from "vitest";

import { buildApp } from "../app.ts";
import { ok } from "../shared/result.ts";
import type { TelegramClient } from "../telegram/client.ts";
import { telegramChatIdSchema, telegramUserIdSchema } from "../telegram/ids.ts";
import { createProcessedUpdates } from "../telegram/processed-updates.ts";
import {
  createUpdateHandler,
  type UpdateHandler,
  type UpdateOutcome,
} from "../telegram/webhook-handler.ts";
import { TELEGRAM_WEBHOOK_PATH } from "./telegram-webhook.ts";

const SECRET = "test-webhook-secret-0123456789abcdef";

const startUpdate = {
  update_id: 100,
  message: {
    message_id: 1,
    from: { id: 42, is_bot: false, first_name: "Alex" },
    chat: { id: 42, type: "private" },
    date: 1_790_400_000,
    text: "/start",
  },
};

const withSecret = (secret: string) => ({
  "x-telegram-bot-api-secret-token": secret,
});

const setup = async (
  outcome: UpdateOutcome = { type: "REPLIED", input: "COMMAND" },
) => {
  const logLines: string[] = [];
  const handleUpdate = vi.fn<UpdateHandler>(() => Promise.resolve(outcome));
  const app = await buildApp({
    logLevel: "info",
    logStream: {
      write: (line) => {
        logLines.push(line);
      },
    },
    telegramWebhook: { secret: SECRET, handleUpdate },
  });
  onTestFinished(() => app.close());

  const post = (
    payload: object,
    headers: Readonly<Record<string, string>> = withSecret(SECRET),
  ) =>
    app.inject({
      method: "POST",
      url: TELEGRAM_WEBHOOK_PATH,
      headers,
      payload,
    });

  return { handleUpdate, logLines, post };
};

describe("POST /telegram/webhook", () => {
  it("hands valid updates to the handler", async () => {
    const { handleUpdate, post } = await setup();

    const response = await post(startUpdate);

    expect(response.statusCode).toBe(200);
    expect(handleUpdate).toHaveBeenCalledOnce();
    // The second argument is the request logger.
    expect(handleUpdate.mock.calls[0]?.[0]).toStrictEqual({
      type: "MESSAGE",
      updateId: 100,
      message: {
        chatId: telegramChatIdSchema.parse(42),
        chatType: "private",
        senderId: telegramUserIdSchema.parse(42),
        content: { type: "TEXT", text: "/start" },
      },
    });
  });

  it.each([
    ["a missing", {}],
    ["an empty", withSecret("")],
    ["a wrong", withSecret("wrong-webhook-secret-0123456789abcdef")],
    ["a truncated", withSecret(SECRET.slice(0, -1))],
  ])("rejects requests with %s secret", async (_description, headers) => {
    const { handleUpdate, post } = await setup();

    const response = await post(startUpdate, headers);

    expect(response.statusCode).toBe(401);
    expect(handleUpdate).not.toHaveBeenCalled();
  });

  it("acknowledges payloads that are not updates without handling them", async () => {
    const { handleUpdate, post } = await setup();

    const response = await post({ hello: "world" });

    expect(response.statusCode).toBe(200);
    expect(handleUpdate).not.toHaveBeenCalled();
  });

  it("asks Telegram to retry after a transient failure", async () => {
    const { post } = await setup({
      type: "FAILED",
      retryable: true,
      error: { type: "NETWORK_ERROR", method: "sendMessage", timedOut: false },
    });

    expect((await post(startUpdate)).statusCode).toBe(500);
  });

  it("does not ask Telegram to retry a permanent failure", async () => {
    const { post } = await setup({
      type: "FAILED",
      retryable: false,
      error: {
        type: "API_ERROR",
        method: "sendMessage",
        status: 403,
        description: "Forbidden: bot was blocked by the user",
      },
    });

    expect((await post(startUpdate)).statusCode).toBe(200);
  });

  it("logs the outcome of each update", async () => {
    const { logLines, post } = await setup({
      type: "IGNORED",
      reason: "UNAUTHORIZED_SENDER",
    });

    await post(startUpdate);

    const entries = logLines.map((line): unknown => JSON.parse(line));
    expect(entries).toContainEqual(
      expect.objectContaining({
        telegram_update_id: 100,
        outcome: "IGNORED",
        reason: "UNAUTHORIZED_SENDER",
        sender_id: 42,
      }),
    );
  });

  it("keeps the secrets out of the logs", async () => {
    const { logLines, post } = await setup();

    await post(startUpdate);
    await post(
      startUpdate,
      withSecret("wrong-webhook-secret-0123456789abcdef"),
    );

    const logs = logLines.join("\n");
    expect(logLines).not.toHaveLength(0);
    expect(logs).not.toContain(SECRET);
    expect(logs).not.toContain("wrong-webhook-secret");
  });
});

describe("webhook workflow", () => {
  it("answers a redelivered update only once", async () => {
    const sendMessage = vi.fn<TelegramClient["sendMessage"]>(() =>
      Promise.resolve(ok(undefined)),
    );
    const app = await buildApp({
      logLevel: "silent",
      telegramWebhook: {
        secret: SECRET,
        handleUpdate: createUpdateHandler({
          allowedUserId: telegramUserIdSchema.parse(42),
          processedUpdates: createProcessedUpdates(100),
          sendMessage,
          downloadImage: () => Promise.reject(new Error("not expected")),
        }),
      },
    });
    onTestFinished(() => app.close());
    const deliver = () =>
      app.inject({
        method: "POST",
        url: TELEGRAM_WEBHOOK_PATH,
        headers: withSecret(SECRET),
        payload: startUpdate,
      });

    const first = await deliver();
    const redelivery = await deliver();

    expect([first.statusCode, redelivery.statusCode]).toStrictEqual([200, 200]);
    expect(sendMessage).toHaveBeenCalledOnce();
  });
});
