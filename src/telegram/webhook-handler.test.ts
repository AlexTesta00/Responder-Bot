import { describe, expect, it, vi } from "vitest";

import { err, ok } from "../shared/result.ts";
import type { TelegramClient } from "./client.ts";
import { replyTo } from "./commands.ts";
import {
  telegramChatIdSchema,
  telegramUserIdSchema,
  type TelegramUserId,
} from "./ids.ts";
import { createProcessedUpdates } from "./processed-updates.ts";
import type { ChatType, IncomingUpdate } from "./update.ts";
import { createUpdateHandler } from "./webhook-handler.ts";

const ALEX = telegramUserIdSchema.parse(42);
const STRANGER = telegramUserIdSchema.parse(666);

const NETWORK_ERROR = {
  type: "NETWORK_ERROR",
  method: "sendMessage",
  timedOut: true,
} as const;

const BLOCKED_BY_USER = {
  type: "API_ERROR",
  method: "sendMessage",
  status: 403,
  description: "Forbidden: bot was blocked by the user",
} as const;

type MessageOptions = Readonly<{
  senderId?: TelegramUserId;
  chatType?: ChatType;
}>;

const textMessage = (
  text: string,
  { senderId = ALEX, chatType = "private" }: MessageOptions = {},
): IncomingUpdate => ({
  type: "MESSAGE",
  updateId: 100,
  message: {
    chatId: telegramChatIdSchema.parse(senderId),
    chatType,
    senderId,
    content: { type: "TEXT", text },
  },
});

type SendResult = Awaited<ReturnType<TelegramClient["sendMessage"]>>;

/** sendMessage returns `results` on consecutive calls, then succeeds. */
const setup = (...results: readonly SendResult[]) => {
  const sendMessage = vi.fn<TelegramClient["sendMessage"]>(() =>
    Promise.resolve(ok(undefined)),
  );
  for (const result of results) {
    sendMessage.mockResolvedValueOnce(result);
  }
  const handleUpdate = createUpdateHandler({
    allowedUserId: ALEX,
    processedUpdates: createProcessedUpdates(100),
    sendMessage,
  });
  return { handleUpdate, sendMessage };
};

describe("createUpdateHandler", () => {
  it("answers the allowed user in a private chat", async () => {
    const { handleUpdate, sendMessage } = setup();

    const outcome = await handleUpdate(textMessage("/start"));

    expect(outcome).toStrictEqual({ type: "REPLIED" });
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith(
      telegramChatIdSchema.parse(42),
      replyTo({ type: "TEXT", text: "/start" }),
    );
  });

  it("ignores updates it does not support", async () => {
    const { handleUpdate, sendMessage } = setup();

    const outcome = await handleUpdate({ type: "UNSUPPORTED", updateId: 100 });

    expect(outcome).toStrictEqual({
      type: "IGNORED",
      reason: "UNSUPPORTED_UPDATE",
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("ignores other users", async () => {
    const { handleUpdate, sendMessage } = setup();

    const outcome = await handleUpdate(
      textMessage("/start", { senderId: STRANGER }),
    );

    expect(outcome).toStrictEqual({
      type: "IGNORED",
      reason: "UNAUTHORIZED_SENDER",
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it.each<ChatType>(["group", "supergroup", "channel"])(
    "ignores the allowed user in a %s",
    async (chatType) => {
      const { handleUpdate, sendMessage } = setup();

      const outcome = await handleUpdate(textMessage("/start", { chatType }));

      expect(outcome).toStrictEqual({
        type: "IGNORED",
        reason: "NOT_PRIVATE_CHAT",
      });
      expect(sendMessage).not.toHaveBeenCalled();
    },
  );

  it("answers each update only once", async () => {
    const { handleUpdate, sendMessage } = setup();

    const first = await handleUpdate(textMessage("/start"));
    const redelivery = await handleUpdate(textMessage("/start"));

    expect(first).toStrictEqual({ type: "REPLIED" });
    expect(redelivery).toStrictEqual({ type: "IGNORED", reason: "DUPLICATE" });
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it("lets a redelivery retry after a transient failure", async () => {
    const { handleUpdate, sendMessage } = setup(err(NETWORK_ERROR));

    const first = await handleUpdate(textMessage("/start"));
    const redelivery = await handleUpdate(textMessage("/start"));

    expect(first).toStrictEqual({
      type: "FAILED",
      retryable: true,
      error: NETWORK_ERROR,
    });
    expect(redelivery).toStrictEqual({ type: "REPLIED" });
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it("does not retry after a permanent failure", async () => {
    const { handleUpdate, sendMessage } = setup(err(BLOCKED_BY_USER));

    const first = await handleUpdate(textMessage("/start"));
    const redelivery = await handleUpdate(textMessage("/start"));

    expect(first).toStrictEqual({
      type: "FAILED",
      retryable: false,
      error: BLOCKED_BY_USER,
    });
    expect(redelivery).toStrictEqual({ type: "IGNORED", reason: "DUPLICATE" });
    expect(sendMessage).toHaveBeenCalledOnce();
  });
});
