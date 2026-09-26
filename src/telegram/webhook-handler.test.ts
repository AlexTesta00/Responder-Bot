import { describe, expect, it, vi } from "vitest";

import { classifyText } from "../inputs/classify.ts";
import type { DownloadImage } from "../inputs/images.ts";
import type { Logger } from "../shared/logger.ts";
import { err, ok } from "../shared/result.ts";
import type { TelegramClient } from "./client.ts";
import {
  telegramChatIdSchema,
  telegramUserIdSchema,
  type TelegramUserId,
} from "./ids.ts";
import type { Schedule } from "./media-group.ts";
import { createProcessedUpdates } from "./processed-updates.ts";
import { imageProblemReply, replyTo } from "./replies.ts";
import type { ChatType, IncomingUpdate, MessageContent } from "./update.ts";
import { createUpdateHandler } from "./webhook-handler.ts";

const ALEX = telegramUserIdSchema.parse(42);
const STRANGER = telegramUserIdSchema.parse(666);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SCREENSHOT = { fileId: "screenshot", fileSize: 310_000 };

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
  updateId?: number;
  senderId?: TelegramUserId;
  chatType?: ChatType;
}>;

const messageWith = (
  content: MessageContent,
  {
    updateId = 100,
    senderId = ALEX,
    chatType = "private",
  }: MessageOptions = {},
): IncomingUpdate => ({
  type: "MESSAGE",
  updateId,
  message: {
    chatId: telegramChatIdSchema.parse(senderId),
    chatType,
    senderId,
    content,
  },
});

const textMessage = (text: string, options?: MessageOptions): IncomingUpdate =>
  messageWith({ type: "TEXT", text }, options);

const screenshotMessage = (): IncomingUpdate =>
  messageWith({
    type: "IMAGE",
    image: SCREENSHOT,
    caption: null,
    mediaGroupId: null,
  });

const albumPhoto = (
  updateId: number,
  fileId: string,
  caption: string | null = null,
): IncomingUpdate =>
  messageWith(
    {
      type: "IMAGE",
      image: { fileId, fileSize: null },
      caption,
      mediaGroupId: "album-1",
    },
    { updateId },
  );

/** A schedule whose callbacks run only when the test says so. */
const manualSchedule = () => {
  const callbacks = new Set<() => void>();
  const schedule: Schedule = (callback) => {
    callbacks.add(callback);
    return () => {
      callbacks.delete(callback);
    };
  };
  const runPending = (): void => {
    for (const callback of [...callbacks]) {
      callbacks.delete(callback);
      callback();
    }
  };
  return { schedule, runPending };
};

type SendResult = Awaited<ReturnType<TelegramClient["sendMessage"]>>;

/** sendMessage returns `results` on consecutive calls, then succeeds. */
const setup = (...results: readonly SendResult[]) => {
  const sendMessage = vi.fn<TelegramClient["sendMessage"]>(() =>
    Promise.resolve(ok(undefined)),
  );
  for (const result of results) {
    sendMessage.mockResolvedValueOnce(result);
  }
  const downloadImage = vi.fn<DownloadImage>(() =>
    Promise.resolve(ok(Uint8Array.from(PNG))),
  );
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const { schedule, runPending } = manualSchedule();
  const handler = createUpdateHandler({
    allowedUserId: ALEX,
    processedUpdates: createProcessedUpdates(100),
    sendMessage,
    downloadImage,
    schedule,
  });
  const handleUpdate = (update: IncomingUpdate) =>
    handler(update, log satisfies Logger);
  return { handleUpdate, sendMessage, downloadImage, log, runPending };
};

describe("createUpdateHandler", () => {
  it("answers the allowed user in a private chat", async () => {
    const { handleUpdate, sendMessage } = setup();

    const outcome = await handleUpdate(textMessage("/start"));

    expect(outcome).toStrictEqual({ type: "REPLIED", input: "COMMAND" });
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith(
      telegramChatIdSchema.parse(42),
      replyTo(classifyText("/start")),
    );
  });

  it.each([
    ["@mariofit", "INSTAGRAM_PROFILE"],
    ["https://www.instagram.com/mariofit/", "INSTAGRAM_PROFILE"],
    ["https://mariofit.it", "LINK"],
    ["Ciao, ci sentiamo domani", "TEXT"],
    ["/unknown", "UNKNOWN_COMMAND"],
  ])("answers %j as %s", async (text, input) => {
    const { handleUpdate, sendMessage } = setup();

    const outcome = await handleUpdate(textMessage(text));

    expect(outcome).toStrictEqual({ type: "REPLIED", input });
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith(
      telegramChatIdSchema.parse(42),
      replyTo(classifyText(text)),
    );
  });

  it("downloads a screenshot before acknowledging it", async () => {
    const { handleUpdate, sendMessage, downloadImage } = setup();

    const outcome = await handleUpdate(screenshotMessage());

    expect(outcome).toStrictEqual({ type: "REPLIED", input: "SCREENSHOTS" });
    expect(downloadImage).toHaveBeenCalledExactlyOnceWith(SCREENSHOT);
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith(
      telegramChatIdSchema.parse(42),
      replyTo({ type: "SCREENSHOTS", images: [SCREENSHOT], caption: null }),
    );
  });

  it("explains why a screenshot could not be processed", async () => {
    const { handleUpdate, sendMessage, downloadImage, log } = setup();
    downloadImage.mockResolvedValueOnce(err({ type: "IMAGE_TOO_LARGE" }));

    const outcome = await handleUpdate(screenshotMessage());

    expect(outcome).toStrictEqual({ type: "REPLIED", input: "SCREENSHOTS" });
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith(
      telegramChatIdSchema.parse(42),
      imageProblemReply({ type: "IMAGE_TOO_LARGE" }),
    );
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it("tells which messages it cannot read yet", async () => {
    const { handleUpdate, sendMessage } = setup();

    const outcome = await handleUpdate(messageWith({ type: "OTHER" }));

    expect(outcome).toStrictEqual({ type: "REPLIED", input: "UNSUPPORTED" });
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith(
      telegramChatIdSchema.parse(42),
      replyTo({ type: "UNSUPPORTED" }),
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
    const { handleUpdate, sendMessage, downloadImage } = setup();

    const outcome = await handleUpdate(
      messageWith(
        {
          type: "IMAGE",
          image: SCREENSHOT,
          caption: null,
          mediaGroupId: null,
        },
        { senderId: STRANGER },
      ),
    );

    expect(outcome).toStrictEqual({
      type: "IGNORED",
      reason: "UNAUTHORIZED_SENDER",
    });
    expect(downloadImage).not.toHaveBeenCalled();
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

    expect(first).toStrictEqual({ type: "REPLIED", input: "COMMAND" });
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
    expect(redelivery).toStrictEqual({ type: "REPLIED", input: "COMMAND" });
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

describe("albums", () => {
  it("answers the photos of an album together, once", async () => {
    const { handleUpdate, sendMessage, downloadImage, log, runPending } =
      setup();

    const outcomes = [
      await handleUpdate(albumPhoto(101, "first", "profilo di Mario")),
      await handleUpdate(albumPhoto(102, "second")),
      await handleUpdate(albumPhoto(103, "third")),
    ];

    expect(outcomes).toStrictEqual([
      { type: "COLLECTED" },
      { type: "COLLECTED" },
      { type: "COLLECTED" },
    ]);
    expect(sendMessage).not.toHaveBeenCalled();

    runPending();
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledOnce();
    });

    const images = ["first", "second", "third"].map((fileId) => ({
      fileId,
      fileSize: null,
    }));
    expect(downloadImage).toHaveBeenCalledTimes(3);
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith(
      telegramChatIdSchema.parse(42),
      replyTo({ type: "SCREENSHOTS", images, caption: "profilo di Mario" }),
    );
    expect(log.info).toHaveBeenCalledWith(
      { input: "SCREENSHOTS", images: 3, outcome: "REPLIED" },
      "telegram album handled",
    );
  });

  it("ignores a redelivered album photo", async () => {
    const { handleUpdate, sendMessage, runPending } = setup();

    await handleUpdate(albumPhoto(101, "first"));
    const redelivery = await handleUpdate(albumPhoto(101, "first"));
    runPending();
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledOnce();
    });

    expect(redelivery).toStrictEqual({ type: "IGNORED", reason: "DUPLICATE" });
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith(
      telegramChatIdSchema.parse(42),
      replyTo({
        type: "SCREENSHOTS",
        images: [{ fileId: "first", fileSize: null }],
        caption: null,
      }),
    );
  });

  it("logs an album it could not answer", async () => {
    const { handleUpdate, log, runPending } = setup(err(BLOCKED_BY_USER));

    await handleUpdate(albumPhoto(101, "first"));
    runPending();

    await vi.waitFor(() => {
      expect(log.error).toHaveBeenCalledWith(
        {
          input: "SCREENSHOTS",
          images: 1,
          outcome: "FAILED",
          error_type: "API_ERROR",
          telegram_error: BLOCKED_BY_USER,
        },
        "telegram album failed",
      );
    });
  });
});
