import { describe, expect, it, vi } from "vitest";

import { err, ok } from "../shared/result.ts";
import type { TelegramClient } from "./client.ts";
import { replyTo } from "./commands.ts";
import {
  telegramChatIdSchema,
  telegramUserIdSchema,
  type TelegramUserId,
} from "./ids.ts";
import type { ChatType, IncomingUpdate } from "./update.ts";
import { createUpdateHandler } from "./webhook-handler.ts";

const ALEX = telegramUserIdSchema.parse(42);
const STRANGER = telegramUserIdSchema.parse(666);

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

const setup = (
  result: Awaited<ReturnType<TelegramClient["sendMessage"]>> = ok(undefined),
) => {
  const sendMessage = vi.fn<TelegramClient["sendMessage"]>(() =>
    Promise.resolve(result),
  );
  const handleUpdate = createUpdateHandler({
    allowedUserId: ALEX,
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

  it("reports transient failures as retryable", async () => {
    const error = {
      type: "NETWORK_ERROR",
      method: "sendMessage",
      timedOut: true,
    } as const;
    const { handleUpdate } = setup(err(error));

    expect(await handleUpdate(textMessage("/start"))).toStrictEqual({
      type: "FAILED",
      retryable: true,
      error,
    });
  });

  it("reports permanent failures as not retryable", async () => {
    const error = {
      type: "API_ERROR",
      method: "sendMessage",
      status: 403,
      description: "Forbidden: bot was blocked by the user",
    } as const;
    const { handleUpdate } = setup(err(error));

    expect(await handleUpdate(textMessage("/start"))).toStrictEqual({
      type: "FAILED",
      retryable: false,
      error,
    });
  });
});
