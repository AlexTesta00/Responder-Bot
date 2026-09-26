import { describe, expect, it, vi } from "vitest";

import type { AiEngine, AiError, Generation } from "../ai/engine.ts";
import type { ConversationReply, ScreenshotsAnalysis } from "../ai/outputs.ts";
import type { PromptMode } from "../ai/prompts/modes.ts";
import type { DownloadedImage, DownloadImage } from "../inputs/images.ts";
import type { Logger } from "../shared/logger.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type { TelegramClient } from "./client.ts";
import {
  telegramChatIdSchema,
  telegramUserIdSchema,
  type TelegramUserId,
} from "./ids.ts";
import type { Schedule } from "./media-group.ts";
import { createProcessedUpdates } from "./processed-updates.ts";
import { imageProblemReply, replyTo, type InstantInput } from "./replies.ts";
import {
  aiProblemReply,
  conversationMessages,
  escapeHtml,
  screenshotsMessages,
} from "./suggestions.ts";
import type { ChatType, IncomingUpdate, MessageContent } from "./update.ts";
import { createUpdateHandler } from "./webhook-handler.ts";

const ALEX = telegramUserIdSchema.parse(42);
const STRANGER = telegramUserIdSchema.parse(666);
const CHAT = telegramChatIdSchema.parse(42);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SCREENSHOT = { fileId: "screenshot", fileSize: 310_000 };
const CONVERSATION = "Mario: Ciao! Quanto costa un sito come il tuo?";

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

const OVERLOADED: AiError = { type: "UNAVAILABLE", status: 529 };

const PROFILE: ScreenshotsAnalysis = {
  kind: "PROFILE",
  prospect: {
    username: "mariofit",
    displayName: "Mario",
    businessType: "personal trainer",
  },
  facts: ["La bio invita a scrivere START in DM."],
  hypotheses: [],
  summary: null,
  suggestions: [{ style: "BEST", text: "Ciao Mario, quanti START ricevi?" }],
  note: null,
};

const REPLY: ConversationReply = {
  facts: [],
  hypotheses: [],
  analysis: {
    lastProspectMessage: "Quanto costa un sito come il tuo?",
    stage: "ENGAGED",
    intent: "PRICE_REQUEST",
    interest: "MEDIUM",
    nextGoal: "UNDERSTAND_PROCESS",
    rationale: "Chiede il prezzo senza contesto.",
  },
  suggestions: [
    { style: "BEST", text: "Dipende: vendi online o raccogli contatti?" },
  ],
  note: null,
};

const generation = <T>(
  mode: PromptMode,
  result: Result<T, AiError>,
): Generation<T> => ({
  result,
  report: {
    mode,
    prompt: "test-prompt@1",
    model: "claude-opus-5",
    durationMs: 1_500,
    inputTokens: 2_400,
    outputTokens: 350,
    cacheReadTokens: 1_800,
    stopReason: "end_turn",
  },
});

/** How the report of every generation above is logged. */
const GENERATION_FIELDS = {
  prompt: "test-prompt@1",
  model: "claude-opus-5",
  duration_ms: 1_500,
  input_tokens: 2_400,
  output_tokens: 350,
  cache_read_tokens: 1_800,
  stop_reason: "end_turn",
};

/** The calls of sendMessage delivering these HTML messages. */
const htmlCalls = (messages: readonly string[]) =>
  messages.map((text) => [CHAT, text, "HTML"]);

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

const screenshotMessage = (
  caption: string | null = null,
  options?: MessageOptions,
): IncomingUpdate =>
  messageWith(
    { type: "IMAGE", image: SCREENSHOT, caption, mediaGroupId: null },
    options,
  );

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
  const sendTyping = vi.fn<TelegramClient["sendTyping"]>(() =>
    Promise.resolve(ok(undefined)),
  );

  // The downloaded bytes, to check that they are wiped after the analysis.
  const downloads: Uint8Array[] = [];
  const downloadImage = vi.fn<DownloadImage>(() => {
    const bytes = Uint8Array.from(PNG);
    downloads.push(bytes);
    return Promise.resolve(ok(bytes));
  });

  // Copies of the images the AI engine received, before they are wiped.
  const analyzed: DownloadedImage[][] = [];
  const analyzeScreenshots = vi.fn<AiEngine["analyzeScreenshots"]>((images) => {
    analyzed.push(
      images.map((image) => ({ ...image, bytes: image.bytes.slice() })),
    );
    return Promise.resolve(generation("SCREENSHOTS", ok(PROFILE)));
  });
  const replyToConversation = vi.fn<AiEngine["replyToConversation"]>(() =>
    Promise.resolve(generation("CONVERSATION_REPLY", ok(REPLY))),
  );

  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const { schedule, runPending } = manualSchedule();
  const handler = createUpdateHandler({
    allowedUserId: ALEX,
    processedUpdates: createProcessedUpdates(100),
    sendMessage,
    sendTyping,
    downloadImage,
    ai: {
      identifyProspect: () => Promise.reject(new Error("not expected")),
      analyzeScreenshots,
      replyToConversation,
    },
    schedule,
  });
  const handleUpdate = (update: IncomingUpdate) =>
    handler(update, log satisfies Logger);

  return {
    handleUpdate,
    sendMessage,
    sendTyping,
    downloadImage,
    downloads,
    analyzeScreenshots,
    analyzed,
    replyToConversation,
    log,
    runPending,
  };
};

describe("createUpdateHandler", () => {
  it("answers the allowed user in a private chat", async () => {
    const { handleUpdate, sendMessage } = setup();

    const outcome = await handleUpdate(textMessage("/start"));

    expect(outcome).toStrictEqual({ type: "REPLIED", input: "COMMAND" });
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith(
      CHAT,
      replyTo({ type: "COMMAND", command: "start" }),
    );
  });

  it.each<[string, InstantInput]>([
    ["@mariofit", { type: "INSTAGRAM_PROFILE", username: "mariofit" }],
    [
      "https://www.instagram.com/mariofit/",
      { type: "INSTAGRAM_PROFILE", username: "mariofit" },
    ],
    ["https://mariofit.it", { type: "LINK", url: "https://mariofit.it" }],
    ["/unknown", { type: "UNKNOWN_COMMAND" }],
  ])("answers %j at once", async (text, input) => {
    const { handleUpdate, sendMessage } = setup();

    const outcome = await handleUpdate(textMessage(text));

    expect(outcome).toStrictEqual({ type: "REPLIED", input: input.type });
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith(CHAT, replyTo(input));
  });

  it("tells which messages it cannot read yet", async () => {
    const { handleUpdate, sendMessage } = setup();

    const outcome = await handleUpdate(messageWith({ type: "OTHER" }));

    expect(outcome).toStrictEqual({ type: "REPLIED", input: "UNSUPPORTED" });
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith(
      CHAT,
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
    const {
      handleUpdate,
      sendMessage,
      sendTyping,
      downloadImage,
      analyzeScreenshots,
    } = setup();

    const outcome = await handleUpdate(
      screenshotMessage(null, { senderId: STRANGER }),
    );

    expect(outcome).toStrictEqual({
      type: "IGNORED",
      reason: "UNAUTHORIZED_SENDER",
    });
    expect(downloadImage).not.toHaveBeenCalled();
    expect(analyzeScreenshots).not.toHaveBeenCalled();
    expect(sendTyping).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it.each<ChatType>(["group", "supergroup", "channel"])(
    "ignores the allowed user in a %s",
    async (chatType) => {
      const { handleUpdate, sendMessage, replyToConversation } = setup();

      const outcome = await handleUpdate(
        textMessage(CONVERSATION, { chatType }),
      );

      expect(outcome).toStrictEqual({
        type: "IGNORED",
        reason: "NOT_PRIVATE_CHAT",
      });
      expect(replyToConversation).not.toHaveBeenCalled();
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

describe("suggestions", () => {
  it("suggests first messages from profile screenshots", async () => {
    const {
      handleUpdate,
      sendMessage,
      downloadImage,
      analyzeScreenshots,
      analyzed,
      log,
    } = setup();

    const outcome = await handleUpdate(screenshotMessage("profilo di Mario"));

    expect(outcome).toStrictEqual({ type: "ACCEPTED", input: "SCREENSHOTS" });
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(2);
    });
    expect(downloadImage).toHaveBeenCalledExactlyOnceWith(SCREENSHOT);
    expect(analyzed).toStrictEqual([[{ format: "image/png", bytes: PNG }]]);
    expect(analyzeScreenshots.mock.calls[0]?.[1]).toBe("profilo di Mario");
    expect(sendMessage.mock.calls).toStrictEqual(
      htmlCalls(screenshotsMessages(PROFILE)),
    );
    expect(log.info).toHaveBeenCalledWith(
      { ai_mode: "SCREENSHOTS", ...GENERATION_FIELDS },
      "ai generation completed",
    );
  });

  it("wipes the screenshots once analyzed", async () => {
    const { handleUpdate, sendMessage, downloads } = setup();

    await handleUpdate(screenshotMessage());
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(2);
    });

    expect(downloads).toStrictEqual([new Uint8Array(PNG.length)]);
  });

  it("suggests replies to a pasted conversation", async () => {
    const { handleUpdate, sendMessage, replyToConversation, log } = setup();

    const outcome = await handleUpdate(textMessage(CONVERSATION));

    expect(outcome).toStrictEqual({ type: "ACCEPTED", input: "TEXT" });
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(2);
    });
    expect(replyToConversation).toHaveBeenCalledExactlyOnceWith(CONVERSATION);
    expect(sendMessage.mock.calls).toStrictEqual(
      htmlCalls(conversationMessages(REPLY)),
    );
    expect(log.info).toHaveBeenCalledWith(
      { ai_mode: "CONVERSATION_REPLY", ...GENERATION_FIELDS },
      "ai generation completed",
    );
  });

  it("shows that it is typing until the answer is ready", async () => {
    const {
      handleUpdate,
      sendMessage,
      sendTyping,
      replyToConversation,
      runPending,
    } = setup();
    const answer = Promise.withResolvers<Generation<ConversationReply>>();
    replyToConversation.mockReturnValueOnce(answer.promise);

    await handleUpdate(textMessage(CONVERSATION));
    expect(sendTyping).toHaveBeenCalledExactlyOnceWith(CHAT);

    // Telegram hides the indicator after a few seconds: it is shown again.
    runPending();
    expect(sendTyping).toHaveBeenCalledTimes(2);

    answer.resolve(generation("CONVERSATION_REPLY", ok(REPLY)));
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(2);
    });
    runPending();
    expect(sendTyping).toHaveBeenCalledTimes(2);
  });

  it("explains a generation that failed", async () => {
    const { handleUpdate, sendMessage, replyToConversation, log } = setup();
    replyToConversation.mockResolvedValueOnce(
      generation("CONVERSATION_REPLY", err(OVERLOADED)),
    );

    await handleUpdate(textMessage(CONVERSATION));
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledOnce();
    });

    expect(sendMessage).toHaveBeenCalledExactlyOnceWith(
      CHAT,
      escapeHtml(aiProblemReply(OVERLOADED)),
      "HTML",
    );
    expect(log.warn).toHaveBeenCalledWith(
      {
        ai_mode: "CONVERSATION_REPLY",
        ...GENERATION_FIELDS,
        ai_error: OVERLOADED,
      },
      "ai generation failed",
    );
  });

  it("explains why screenshots could not be processed", async () => {
    const {
      handleUpdate,
      sendMessage,
      downloadImage,
      analyzeScreenshots,
      log,
    } = setup();
    downloadImage.mockResolvedValueOnce(err({ type: "IMAGE_TOO_LARGE" }));

    const outcome = await handleUpdate(screenshotMessage());

    expect(outcome).toStrictEqual({ type: "ACCEPTED", input: "SCREENSHOTS" });
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledOnce();
    });
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith(
      CHAT,
      escapeHtml(imageProblemReply({ type: "IMAGE_TOO_LARGE" })),
      "HTML",
    );
    expect(analyzeScreenshots).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      { image_problem: { type: "IMAGE_TOO_LARGE" } },
      "screenshots not processed",
    );
  });

  it("stops at the first message it cannot deliver", async () => {
    const { handleUpdate, sendMessage, log } = setup(err(BLOCKED_BY_USER));

    await handleUpdate(textMessage(CONVERSATION));
    await vi.waitFor(() => {
      expect(log.error).toHaveBeenCalledWith(
        {
          message_index: 0,
          messages: 2,
          error_type: "API_ERROR",
          telegram_error: BLOCKED_BY_USER,
        },
        "reply not delivered",
      );
    });

    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it("logs a crash and stops typing", async () => {
    const { handleUpdate, sendTyping, replyToConversation, log, runPending } =
      setup();
    const crash = new Error("unexpected");
    replyToConversation.mockRejectedValueOnce(crash);

    const outcome = await handleUpdate(textMessage(CONVERSATION));

    expect(outcome).toStrictEqual({ type: "ACCEPTED", input: "TEXT" });
    await vi.waitFor(() => {
      expect(log.error).toHaveBeenCalledWith(
        { err: crash },
        "background processing crashed",
      );
    });
    runPending();
    expect(sendTyping).toHaveBeenCalledOnce();
  });

  it("analyzes a redelivered conversation only once", async () => {
    const { handleUpdate, sendMessage, replyToConversation } = setup();

    const first = await handleUpdate(textMessage(CONVERSATION));
    const redelivery = await handleUpdate(textMessage(CONVERSATION));
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(2);
    });

    expect([first, redelivery]).toStrictEqual([
      { type: "ACCEPTED", input: "TEXT" },
      { type: "IGNORED", reason: "DUPLICATE" },
    ]);
    expect(replyToConversation).toHaveBeenCalledOnce();
  });

  it("keeps screenshots, conversations and suggestions out of the logs", async () => {
    const { handleUpdate, sendMessage, log } = setup();

    await handleUpdate(textMessage(CONVERSATION));
    await handleUpdate(
      screenshotMessage("profilo di Mario", { updateId: 101 }),
    );
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(4);
    });

    const logs = JSON.stringify([
      log.info.mock.calls,
      log.warn.mock.calls,
      log.error.mock.calls,
    ]);
    expect(log.info).toHaveBeenCalledTimes(2);
    for (const content of ["Quanto costa", "vendi online", "START", "Mario"]) {
      expect(logs).not.toContain(content);
    }
  });
});

describe("albums", () => {
  it("analyzes the photos of an album together, once", async () => {
    const {
      handleUpdate,
      sendMessage,
      downloadImage,
      analyzeScreenshots,
      analyzed,
      log,
      runPending,
    } = setup();

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
    expect(analyzeScreenshots).not.toHaveBeenCalled();

    runPending();
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(2);
    });

    expect(downloadImage.mock.calls).toStrictEqual(
      ["first", "second", "third"].map((fileId) => [
        { fileId, fileSize: null },
      ]),
    );
    const png = { format: "image/png", bytes: PNG };
    expect(analyzed).toStrictEqual([[png, png, png]]);
    expect(analyzeScreenshots.mock.calls[0]?.[1]).toBe("profilo di Mario");
    expect(sendMessage.mock.calls).toStrictEqual(
      htmlCalls(screenshotsMessages(PROFILE)),
    );
    expect(log.info).toHaveBeenCalledWith(
      { input: "SCREENSHOTS", images: 3 },
      "telegram album accepted for processing",
    );
  });

  it("ignores a redelivered album photo", async () => {
    const { handleUpdate, sendMessage, downloadImage, runPending } = setup();

    await handleUpdate(albumPhoto(101, "first"));
    const redelivery = await handleUpdate(albumPhoto(101, "first"));
    runPending();
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(2);
    });

    expect(redelivery).toStrictEqual({ type: "IGNORED", reason: "DUPLICATE" });
    expect(downloadImage).toHaveBeenCalledExactlyOnceWith({
      fileId: "first",
      fileSize: null,
    });
  });
});
