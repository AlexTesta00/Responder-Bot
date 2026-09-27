import { describe, expect, it, vi } from "vitest";

import type { AiEngine, AiError, Generation } from "../ai/engine.ts";
import type { GenerationLog } from "../ai/runs.ts";
import type {
  ConversationReply,
  NewSuggestions,
  ScreenshotsAnalysis,
} from "../ai/outputs.ts";
import type { PromptMode } from "../ai/prompts/modes.ts";
import { createInMemorySpending, type SpendingLedger } from "../ai/spending.ts";
import { createButtonActions, createCardWriting } from "../copilot/buttons.ts";
import { createSendMarking } from "../copilot/sends.ts";
import { createConversationAnalyst } from "../copilot/conversation.ts";
import { createScreenshotsAnalyst } from "../copilot/screenshots.ts";
import type { DownloadedImage, DownloadImage } from "../inputs/images.ts";
import { createInMemoryProspectStore } from "../prospects/store.ts";
import type { Logger } from "../shared/logger.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type { TelegramClient } from "./client.ts";
import {
  telegramChatIdSchema,
  telegramUserIdSchema,
  type TelegramUserId,
} from "./ids.ts";
import type { Schedule } from "./media-group.ts";
import { createInFlight } from "./in-flight.ts";
import { createProcessedUpdates } from "./processed-updates.ts";
import { imageProblemReply, replyTo, type InstantInput } from "./replies.ts";
import {
  aiProblemReply,
  conversationAnswer,
  escapeHtml,
  pauseMessage,
  screenshotsAnswer,
  type Presented,
} from "./suggestions.ts";
import type { ChatType, IncomingUpdate, MessageContent } from "./update.ts";
import { decodeButton } from "./button-data.ts";
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
  messages: [{ author: "PROSPECT", text: "Quanto costa un sito come il tuo?" }],
  facts: [],
  hypotheses: [],
  objections: [],
  commitments: [],
  summary: "Ha chiesto il prezzo di un sito.",
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
    cacheWriteTokens: 0,
    costMicroUsd: 21_650,
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
  cache_write_tokens: 0,
  cost_micro_usd: 21_650,
  stop_reason: "end_turn",
};

const NEW_REPLIES: NewSuggestions = {
  suggestions: [
    { style: "BEST", text: "Ti mando un esempio?" },
    { style: "ALTERNATIVE", text: "Come lavori oggi?" },
    { style: "DIRECT", text: "Ti preparo un preventivo?" },
  ],
  note: null,
};

/** Under an answer with one generation: 21_650 millionths of a dollar. */
const ONE_RUN_COST =
  "💳 Questa analisi ~0,02 $ · mese ~0,02 $, restano ~19,98 $ di 20,00 $";

/** Under the first analysis of screenshots: two generations. */
const TWO_RUNS_COST =
  "💳 Questa analisi ~0,04 $ · mese ~0,04 $, restano ~19,96 $ di 20,00 $";

/** The calls of sendMessage delivering these HTML messages. */
const answerCall = ({ html, keyboard }: Presented) => [
  CHAT,
  html,
  keyboard === null ? { parseMode: "HTML" } : { parseMode: "HTML", keyboard },
];

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
  messageWith({ type: "TEXT", text, replyTo: null }, options);

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
const setup = (...results: readonly SendResult[]) =>
  setupWith(createInMemorySpending(), ...results);

const setupWith = (
  spending: SpendingLedger & GenerationLog,
  ...results: readonly SendResult[]
) => {
  // Each message the bot sends gets the next id, as on Telegram.
  let lastMessageId = 1_000;
  const sendMessage = vi.fn<TelegramClient["sendMessage"]>(() => {
    lastMessageId += 1;
    return Promise.resolve(ok({ messageId: lastMessageId }));
  });
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
  const identifyProspect = vi.fn<AiEngine["identifyProspect"]>(() =>
    Promise.resolve(
      generation(
        "PROSPECT_IDENTITY",
        ok({ username: "mariofit", displayName: "Mario" }),
      ),
    ),
  );
  const analyzeScreenshots = vi.fn<AiEngine["analyzeScreenshots"]>((images) => {
    analyzed.push(
      images.map((image) => ({ ...image, bytes: image.bytes.slice() })),
    );
    return Promise.resolve(generation("SCREENSHOTS", ok(PROFILE)));
  });
  const replyToConversation = vi.fn<AiEngine["replyToConversation"]>(() =>
    Promise.resolve(generation("CONVERSATION_REPLY", ok(REPLY))),
  );
  const suggestAgain = vi.fn<AiEngine["suggestAgain"]>(() =>
    Promise.resolve(generation("NEW_SUGGESTIONS", ok(NEW_REPLIES))),
  );
  const answerCallbackQuery = vi.fn<TelegramClient["answerCallbackQuery"]>(() =>
    Promise.resolve(ok(undefined)),
  );

  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const { schedule, runPending } = manualSchedule();
  const prospects = createInMemoryProspectStore();
  const copilot = {
    ai: {
      identifyProspect,
      analyzeScreenshots,
      replyToConversation,
      suggestAgain,
    },
    prospects,
    generations: spending,
  };
  const handler = createUpdateHandler({
    allowedUserId: ALEX,
    processedUpdates: createProcessedUpdates(100),
    sendMessage,
    sendTyping,
    downloadImage,
    // The real use cases, with the memory in the process.
    analyzeScreenshots: createScreenshotsAnalyst(copilot),
    replyToConversation: createConversationAnalyst(copilot),
    pressButton: createButtonActions(copilot),
    writeFromCard: createCardWriting({ ...copilot, now: () => new Date() }),
    markSent: createSendMarking({ prospects, now: () => new Date() }),
    now: () => new Date(),
    answerCallbackQuery,
    inFlight: createInFlight(),
    linkMessages: prospects.linkMessages,
    spending,
    monthlyLimitMicroUsd: 20_000_000,
    schedule,
  });
  const handleUpdate = (update: IncomingUpdate) =>
    handler(update, log satisfies Logger);

  return {
    handleUpdate,
    prospects,
    sendMessage,
    sendTyping,
    downloadImage,
    downloads,
    identifyProspect,
    analyzeScreenshots,
    analyzed,
    replyToConversation,
    suggestAgain,
    answerCallbackQuery,
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
      expect(sendMessage).toHaveBeenCalledOnce();
    });
    expect(downloadImage).toHaveBeenCalledExactlyOnceWith(SCREENSHOT);
    expect(analyzed).toStrictEqual([[{ format: "image/png", bytes: PNG }]]);
    expect(analyzeScreenshots.mock.calls[0]?.[1]).toBe("profilo di Mario");
    expect(sendMessage.mock.calls).toStrictEqual([
      answerCall(
        screenshotsAnswer(PROFILE, {
          memory: { type: "CREATED" },
          pause: null,
          linked: true,
          footer: TWO_RUNS_COST,
        }),
      ),
    ]);
    expect(log.info).toHaveBeenCalledWith(
      { ai_mode: "SCREENSHOTS", ...GENERATION_FIELDS },
      "ai generation completed",
    );
  });

  it("wipes the screenshots once analyzed", async () => {
    const { handleUpdate, sendMessage, downloads } = setup();

    await handleUpdate(screenshotMessage());
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledOnce();
    });

    expect(downloads).toStrictEqual([new Uint8Array(PNG.length)]);
  });

  it("suggests replies to a pasted conversation", async () => {
    const { handleUpdate, sendMessage, replyToConversation, log } = setup();

    const outcome = await handleUpdate(textMessage(CONVERSATION));

    expect(outcome).toStrictEqual({ type: "ACCEPTED", input: "TEXT" });
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledOnce();
    });
    expect(replyToConversation).toHaveBeenCalledExactlyOnceWith(
      CONVERSATION,
      null,
    );
    expect(sendMessage.mock.calls).toStrictEqual([
      answerCall(
        conversationAnswer(REPLY, null, {
          memory: { type: "NOT_SAVED", reason: "NO_PROSPECT" },
          pause: null,
          linked: false,
          footer: ONE_RUN_COST,
        }),
      ),
    ]);
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
      expect(sendMessage).toHaveBeenCalledOnce();
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
      `${escapeHtml(aiProblemReply(OVERLOADED))}\n\n${ONE_RUN_COST}`,
      { parseMode: "HTML" },
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
      { parseMode: "HTML" },
    );
    expect(analyzeScreenshots).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      { image_problem: { type: "IMAGE_TOO_LARGE" } },
      "screenshots not processed",
    );
  });

  it("logs an answer it cannot deliver", async () => {
    const { handleUpdate, sendMessage, log } = setup(err(BLOCKED_BY_USER));

    await handleUpdate(textMessage(CONVERSATION));
    await vi.waitFor(() => {
      expect(log.error).toHaveBeenCalledWith(
        { error_type: "API_ERROR", telegram_error: BLOCKED_BY_USER },
        "reply not delivered",
      );
    });

    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it("sends the answer again without buttons when Telegram refuses them", async () => {
    const refused = {
      type: "API_ERROR",
      method: "sendMessage",
      status: 400,
      description: "Bad Request: BUTTON_DATA_INVALID",
    } as const;
    const { handleUpdate, sendMessage, log } = setup(err(refused));

    await handleUpdate(screenshotMessage());
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(2);
    });

    const { html } = screenshotsAnswer(PROFILE, {
      memory: { type: "CREATED" },
      pause: null,
      linked: true,
      footer: TWO_RUNS_COST,
    });
    expect(sendMessage.mock.calls[0]?.[2]).toHaveProperty("keyboard");
    expect(sendMessage.mock.calls[1]).toStrictEqual([
      CHAT,
      html,
      { parseMode: "HTML" },
    ]);
    expect(log.warn).toHaveBeenCalledWith(
      { telegram_error: refused },
      "keyboard rejected, answer resent without buttons",
    );
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
      expect(sendMessage).toHaveBeenCalledOnce();
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
      expect(sendMessage).toHaveBeenCalledTimes(2);
    });

    const logs = JSON.stringify([
      log.info.mock.calls,
      log.warn.mock.calls,
      log.error.mock.calls,
    ]);
    expect(
      log.info.mock.calls.map(([, message]: unknown[]) => message).toSorted(),
    ).toStrictEqual([
      "ai generation completed",
      "ai generation completed",
      "ai generation completed",
      "prospect memory saved",
    ]);
    for (const content of ["Quanto costa", "vendi online", "START", "Mario"]) {
      expect(logs).not.toContain(content);
    }
  });
});

describe("prospect memory", () => {
  it("remembers the prospect from one analysis to the next", async () => {
    const { handleUpdate, sendMessage, analyzeScreenshots } = setup();

    await handleUpdate(screenshotMessage());
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledOnce();
    });
    await handleUpdate(screenshotMessage(null, { updateId: 101 }));
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(2);
    });

    const [first, second] = analyzeScreenshots.mock.calls;
    expect(first?.[2]).toBeNull();
    expect(second?.[2]?.prospect).toMatchObject({
      username: "mariofit",
      displayName: "Mario",
      facts: PROFILE.facts,
    });
    expect(sendMessage.mock.calls[1]?.[1]).toContain("🧠 Già in memoria");
  });

  it("says so when the screenshots do not show a username", async () => {
    const { handleUpdate, sendMessage, identifyProspect, analyzeScreenshots } =
      setup();
    identifyProspect.mockResolvedValue(
      generation(
        "PROSPECT_IDENTITY",
        ok({ username: null, displayName: null }),
      ),
    );
    analyzeScreenshots.mockResolvedValue(
      generation(
        "SCREENSHOTS",
        ok({ ...PROFILE, prospect: { ...PROFILE.prospect, username: null } }),
      ),
    );

    await handleUpdate(screenshotMessage());
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledOnce();
    });

    expect(sendMessage.mock.calls[0]?.[1]).toContain("Non vedo lo username");
  });
});

describe("conversations", () => {
  it("continues a conversation from a reply to the bot's analysis", async () => {
    const { handleUpdate, sendMessage, replyToConversation } = setup();

    await handleUpdate(screenshotMessage());
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledOnce();
    });
    // The analysis arrived as message 1001: Alex replies to it.
    await handleUpdate(
      messageWith(
        { type: "TEXT", text: CONVERSATION, replyTo: 1_001 },
        { updateId: 101 },
      ),
    );
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(2);
    });

    expect(replyToConversation.mock.calls[0]?.[1]?.prospect).toMatchObject({
      username: "mariofit",
    });
    expect(sendMessage.mock.calls[1]?.[1]).toContain("🧠 Già in memoria");
  });

  it("remembers a conversation pasted under the prospect's @username", async () => {
    const { handleUpdate, sendMessage, replyToConversation, prospects } =
      setup();

    const outcome = await handleUpdate(
      textMessage(`@giulia.bakery\n${CONVERSATION}`),
    );
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledOnce();
    });

    expect(outcome).toStrictEqual({ type: "ACCEPTED", input: "TEXT" });
    expect(replyToConversation).toHaveBeenCalledExactlyOnceWith(
      CONVERSATION,
      null,
    );
    expect(sendMessage.mock.calls[0]?.[1]).toContain("🧠 Nuovo prospect");
    expect(await prospects.load("giulia.bakery")).not.toBeNull();
  });

  it("explains how to remember a conversation pasted alone", async () => {
    const { handleUpdate, sendMessage } = setup();

    await handleUpdate(textMessage(CONVERSATION));
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledOnce();
    });

    expect(sendMessage.mock.calls[0]?.[1]).toContain("@username");
  });

  it("shows why it suggests nothing", async () => {
    const { handleUpdate, sendMessage, replyToConversation } = setup();
    replyToConversation.mockResolvedValue(
      generation(
        "CONVERSATION_REPLY",
        ok({
          ...REPLY,
          analysis: {
            ...REPLY.analysis,
            stage: "DO_NOT_CONTACT",
            intent: "DO_NOT_CONTACT",
          },
        }),
      ),
    );

    await handleUpdate(textMessage(`@mariofit\n${CONVERSATION}`));
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledOnce();
    });

    expect(sendMessage.mock.calls[0]?.[1]).toContain(
      pauseMessage("DO_NOT_CONTACT"),
    );
    // Nothing to copy or rewrite: only what the bot remembers.
    expect(sendMessage.mock.calls[0]?.[2]).toStrictEqual({
      parseMode: "HTML",
      keyboard: [[{ type: "CALLBACK", label: "🔍 Analizza", data: "1:an:R" }]],
    });
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
      expect(sendMessage).toHaveBeenCalledOnce();
    });

    expect(downloadImage.mock.calls).toStrictEqual(
      ["first", "second", "third"].map((fileId) => [
        { fileId, fileSize: null },
      ]),
    );
    const png = { format: "image/png", bytes: PNG };
    expect(analyzed).toStrictEqual([[png, png, png]]);
    expect(analyzeScreenshots.mock.calls[0]?.[1]).toBe("profilo di Mario");
    expect(sendMessage.mock.calls).toStrictEqual([
      answerCall(
        screenshotsAnswer(PROFILE, {
          memory: { type: "CREATED" },
          pause: null,
          linked: true,
          footer: TWO_RUNS_COST,
        }),
      ),
    ]);
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
      expect(sendMessage).toHaveBeenCalledOnce();
    });

    expect(redelivery).toStrictEqual({ type: "IGNORED", reason: "DUPLICATE" });
    expect(downloadImage).toHaveBeenCalledExactlyOnceWith({
      fileId: "first",
      fileSize: null,
    });
  });
});

describe("costs", () => {
  it("tells under each answer what it cost and what is left", async () => {
    const { handleUpdate, sendMessage } = setup();

    await handleUpdate(screenshotMessage());
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledOnce();
    });
    await handleUpdate(textMessage(CONVERSATION, { updateId: 101 }));
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(2);
    });

    expect(sendMessage.mock.calls[0]?.[1]).toMatch(
      /\n💳 Questa analisi ~0,04 \$ · mese ~0,04 \$, restano ~19,96 \$ di 20,00 \$$/,
    );
    expect(sendMessage.mock.calls[1]?.[1]).toMatch(
      /\n💳 Questa analisi ~0,02 \$ · mese ~0,06 \$, restano ~19,94 \$ di 20,00 \$$/,
    );
  });

  it("still tells what the answer cost when the month cannot be read", async () => {
    const memory = createInMemorySpending();
    const { handleUpdate, sendMessage, log } = setupWith({
      ...memory,
      spending: () => Promise.reject(new Error("ECONNREFUSED")),
    });

    await handleUpdate(textMessage(CONVERSATION));
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledOnce();
    });

    expect(sendMessage.mock.calls[0]?.[1]).toMatch(
      /\n💳 Questa analisi ~0,02 \$$/,
    );
    expect(log.warn).toHaveBeenCalledWith(
      { error_name: "Error", error_code: null, errno: null, sql_state: null },
      "spending unavailable",
    );
  });

  it("sets the credit Alex read on the Console and reports it", async () => {
    const { handleUpdate, sendMessage } = setup();

    const outcome = await handleUpdate(textMessage("/credito 25,40"));

    expect(outcome).toStrictEqual({ type: "REPLIED", input: "CREDIT" });
    const [call] = sendMessage.mock.calls;
    expect(call?.[1]).toContain("✅ Credito impostato a 25,40 $");
    expect(call?.[1]).toContain("Credito: ~25,40 $");
    expect(call?.[2]).toStrictEqual({ parseMode: "HTML" });
  });

  it("counts down the credit with each answer", async () => {
    const { handleUpdate, sendMessage } = setup();

    await handleUpdate(textMessage("/credito 25"));
    await handleUpdate(textMessage(CONVERSATION, { updateId: 101 }));
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(2);
    });
    await handleUpdate(textMessage("/credito", { updateId: 102 }));

    expect(sendMessage.mock.calls[1]?.[1]).toContain("credito ~24,98 $");
    expect(sendMessage.mock.calls[2]?.[1]).toContain(
      "Questo mese: ~0,02 $, restano ~19,98 $ di 20,00 $",
    );
  });

  it("explains how to write the credit", async () => {
    const { handleUpdate, sendMessage } = setup();

    await handleUpdate(textMessage("/credito venti"));

    expect(sendMessage.mock.calls[0]?.[1]).toContain("/credito 25,40");
  });

  it("says so when the costs cannot be read", async () => {
    const memory = createInMemorySpending();
    const { handleUpdate, sendMessage, log } = setupWith({
      ...memory,
      setCredit: () => Promise.reject(new Error("ECONNREFUSED")),
    });

    const outcome = await handleUpdate(textMessage("/credito 25"));

    expect(outcome).toStrictEqual({ type: "REPLIED", input: "CREDIT" });
    expect(sendMessage.mock.calls[0]?.[1]).toContain(
      "il database non risponde",
    );
    expect(log.error).toHaveBeenCalledWith(
      { error_name: "Error", error_code: null, errno: null, sql_state: null },
      "spending unavailable",
    );
  });
});

describe("buttons", () => {
  const SHOWN = [
    "Ciao Mario, quanti START ricevi?",
    "Come gestisci gli START?",
    "Bel profilo!",
  ];

  const tapOn = (
    messageId: number,
    data: string,
    {
      updateId = 300,
      senderId = ALEX,
      chatType = "private",
      suggestions = SHOWN,
    }: Readonly<{
      updateId?: number;
      senderId?: TelegramUserId;
      chatType?: ChatType;
      suggestions?: readonly string[];
    }> = {},
  ): IncomingUpdate => ({
    type: "CALLBACK",
    updateId,
    callback: {
      queryId: `query-${String(updateId)}`,
      senderId,
      message: { chatId: CHAT, chatType, messageId, suggestions },
      press: decodeButton(data),
    },
  });

  /** A handler whose first answer, message 1001, is about Mario. */
  const answered = async () => {
    const context = setup();
    await context.handleUpdate(screenshotMessage());
    await vi.waitFor(() => {
      expect(context.sendMessage).toHaveBeenCalledOnce();
    });
    return context;
  };

  it("puts the buttons under an answer about a known prospect", async () => {
    const { sendMessage } = await answered();

    const options = sendMessage.mock.calls[0]?.[2];
    expect(
      options?.keyboard?.map((row) => row.map((button) => button.label)),
    ).toStrictEqual([
      ["📋 Copia BEST", "✅ Inviato"],
      ["🔄 Altre 3", "🙂 Più naturale"],
      ["🎯 Più diretto", "💬 Follow-up"],
      ["🔍 Analizza"],
    ]);
  });

  it("acknowledges a tap at once, then answers under the tapped message", async () => {
    const { handleUpdate, sendMessage, answerCallbackQuery, suggestAgain } =
      await answered();

    const outcome = await handleUpdate(tapOn(1_001, "1:nat:F"));

    expect(outcome).toStrictEqual({
      type: "PRESSED",
      button: "NATURAL",
      kind: "FIRST_MESSAGES",
    });
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(2);
    });
    expect(answerCallbackQuery).toHaveBeenCalledExactlyOnceWith(
      "query-300",
      "🙂 Le riscrivo più naturali…",
    );
    expect(answerCallbackQuery.mock.invocationCallOrder[0]).toBeLessThan(
      suggestAgain.mock.invocationCallOrder[0] ?? 0,
    );
    expect(suggestAgain.mock.calls[0]?.[0]).toStrictEqual({
      action: "NATURAL",
      kind: "FIRST_MESSAGES",
      previous: [
        { style: "BEST", text: SHOWN[0] },
        { style: "CURIOSITY", text: SHOWN[1] },
        { style: "NATURAL", text: SHOWN[2] },
      ],
    });
    const [, html, options] = sendMessage.mock.calls[1] ?? [];
    expect(html).toMatch(
      /^🙂 <b>@mariofit<\/b> · primi messaggi più naturali\n\n🔥 <b>BEST<\/b>\n<pre>Ti mando un esempio\?<\/pre>/,
    );
    expect(html).toMatch(/\n💳 Questa analisi ~0,02 \$ · mese ~0,06 \$/);
    expect(options).toMatchObject({ parseMode: "HTML", replyTo: 1_001 });
  });

  it("acknowledges before reading the memory", async () => {
    const { handleUpdate, prospects, answerCallbackQuery, sendMessage } =
      await answered();
    const read = vi.spyOn(prospects, "prospectOfMessage");

    await handleUpdate(tapOn(1_001, "1:more:F"));
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(2);
    });

    expect(answerCallbackQuery.mock.invocationCallOrder[0]).toBeLessThan(
      read.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("links the new suggestions to the prospect, for more taps", async () => {
    const { handleUpdate, sendMessage, suggestAgain } = await answered();

    await handleUpdate(tapOn(1_001, "1:more:F"));
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(2);
    });
    await handleUpdate(tapOn(1_002, "1:dir:F", { updateId: 301 }));
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(3);
    });

    expect(suggestAgain).toHaveBeenCalledTimes(2);
  });

  it("answers a double tap once", async () => {
    const { handleUpdate, sendMessage, suggestAgain, answerCallbackQuery } =
      await answered();
    const slow = Promise.withResolvers<Generation<NewSuggestions>>();
    suggestAgain.mockReturnValueOnce(slow.promise);

    const first = await handleUpdate(tapOn(1_001, "1:more:F"));
    const second = await handleUpdate(
      tapOn(1_001, "1:more:F", { updateId: 301 }),
    );
    slow.resolve(generation("NEW_SUGGESTIONS", ok(NEW_REPLIES)));
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(2);
    });

    expect(first).toMatchObject({ type: "PRESSED" });
    expect(second).toStrictEqual({ type: "IGNORED", reason: "BUSY" });
    expect(suggestAgain).toHaveBeenCalledOnce();
    expect(answerCallbackQuery).toHaveBeenCalledWith(
      "query-301",
      "⏳ Ci sto già lavorando: arriva tra poco.",
    );

    // Once answered, the same button works again.
    await handleUpdate(tapOn(1_001, "1:more:F", { updateId: 302 }));
    await vi.waitFor(() => {
      expect(suggestAgain).toHaveBeenCalledTimes(2);
    });
  });

  it("keeps answering when the tap cannot be acknowledged", async () => {
    const { handleUpdate, sendMessage, answerCallbackQuery, log } =
      await answered();
    answerCallbackQuery.mockResolvedValueOnce(
      err({
        type: "API_ERROR",
        method: "answerCallbackQuery",
        status: 400,
        description: "Bad Request: query is too old",
      }),
    );

    await handleUpdate(tapOn(1_001, "1:more:F"));
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(2);
    });

    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error_type: "API_ERROR" }),
      "button tap not acknowledged",
    );
  });

  it.each<[string, IncomingUpdate]>([
    ["from a stranger", tapOn(1_001, "1:more:F", { senderId: STRANGER })],
    ["in a group", tapOn(1_001, "1:more:F", { chatType: "group" })],
  ])("ignores a tap %s", async (_description, update) => {
    const { handleUpdate, answerCallbackQuery, suggestAgain } =
      await answered();

    const outcome = await handleUpdate(update);

    expect(outcome).toMatchObject({ type: "IGNORED" });
    expect(answerCallbackQuery).not.toHaveBeenCalled();
    expect(suggestAgain).not.toHaveBeenCalled();
  });

  it("ignores a button that is not under a message", async () => {
    const { handleUpdate, answerCallbackQuery } = setup();

    const outcome = await handleUpdate({
      type: "CALLBACK",
      updateId: 300,
      callback: {
        queryId: "query-300",
        senderId: ALEX,
        message: null,
        press: { type: "ANSWER", action: "MORE", kind: "REPLIES" },
      },
    });

    expect(outcome).toStrictEqual({
      type: "IGNORED",
      reason: "NO_BUTTON_MESSAGE",
    });
    expect(answerCallbackQuery).not.toHaveBeenCalled();
  });

  it("answers a redelivered tap only once", async () => {
    const { handleUpdate, sendMessage, suggestAgain } = await answered();

    await handleUpdate(tapOn(1_001, "1:more:F"));
    const redelivery = await handleUpdate(tapOn(1_001, "1:more:F"));
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(2);
    });

    expect(redelivery).toStrictEqual({ type: "IGNORED", reason: "DUPLICATE" });
    expect(suggestAgain).toHaveBeenCalledOnce();
  });

  it("says when a button no longer works", async () => {
    const { handleUpdate, answerCallbackQuery, suggestAgain } =
      await answered();

    const outcome = await handleUpdate(tapOn(1_001, "2:more:F"));

    expect(outcome).toStrictEqual({
      type: "IGNORED",
      reason: "INVALID_BUTTON",
    });
    await vi.waitFor(() => {
      expect(answerCallbackQuery).toHaveBeenCalledExactlyOnceWith(
        "query-300",
        "⌛ Questo bottone non vale più: usa l'ultima risposta o mandami di nuovo lo screenshot.",
      );
    });
    expect(suggestAgain).not.toHaveBeenCalled();
  });

  it("shows what the bot remembers, without the AI", async () => {
    const { handleUpdate, sendMessage, suggestAgain, answerCallbackQuery } =
      await answered();

    await handleUpdate(tapOn(1_001, "1:an:F"));
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(2);
    });

    expect(answerCallbackQuery).toHaveBeenCalledExactlyOnceWith(
      "query-300",
      undefined,
    );
    expect(suggestAgain).not.toHaveBeenCalled();
    const [, html, options] = sendMessage.mock.calls[1] ?? [];
    expect(html).toMatch(
      /^🔍 <b><a href="https:\/\/www\.instagram\.com\/mariofit\/">@mariofit<\/a><\/b> · personal trainer\n/,
    );
    expect(html).toContain("Solo profilo");
    expect(options).toMatchObject({ parseMode: "HTML", replyTo: 1_001 });
    expect(
      options?.keyboard?.map((row) => row.map((button) => button.label)),
    ).toStrictEqual([["✍️ Proponi primi messaggi", "✅ Già scritto"]]);
  });

  it("writes nothing for a prospect who asked not to be contacted", async () => {
    const { handleUpdate, sendMessage, suggestAgain, replyToConversation } =
      setup();
    replyToConversation.mockResolvedValue(
      generation(
        "CONVERSATION_REPLY",
        ok({
          ...REPLY,
          analysis: {
            ...REPLY.analysis,
            stage: "DO_NOT_CONTACT",
            intent: "DO_NOT_CONTACT",
          },
        }),
      ),
    );
    await handleUpdate(textMessage(`@mariofit\n${CONVERSATION}`));
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledOnce();
    });

    // A button of an older message about the same prospect.
    await handleUpdate(tapOn(1_001, "1:more:R", { updateId: 301 }));
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(2);
    });

    expect(suggestAgain).not.toHaveBeenCalled();
    expect(sendMessage.mock.calls[1]).toStrictEqual([
      CHAT,
      pauseMessage("DO_NOT_CONTACT"),
      {
        parseMode: "HTML",
        keyboard: [
          [{ type: "CALLBACK", label: "🔍 Analizza", data: "1:an:R" }],
        ],
        replyTo: 1_001,
      },
    ]);
  });

  it("does not guess the prospect of a message it did not link", async () => {
    const { handleUpdate, sendMessage, suggestAgain } = setup();

    await handleUpdate(tapOn(4_242, "1:more:R"));
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledOnce();
    });

    expect(suggestAgain).not.toHaveBeenCalled();
    expect(sendMessage.mock.calls[0]?.[1]).toContain(
      "Non so più di quale prospect parla questo messaggio",
    );
  });

  it("marks the suggestion sent with ✅, then says so in the notice", async () => {
    const {
      handleUpdate,
      sendMessage,
      answerCallbackQuery,
      prospects,
      suggestAgain,
    } = await answered();
    const record = vi.spyOn(prospects, "recordSend");

    const outcome = await handleUpdate(tapOn(1_001, "1:ok:F:0"));

    expect(outcome).toStrictEqual({
      type: "PRESSED",
      button: "SENT",
      kind: "FIRST_MESSAGES",
    });
    await vi.waitFor(() => {
      expect(answerCallbackQuery).toHaveBeenCalledOnce();
    });
    // Acknowledged once written, with what comes next.
    expect(answerCallbackQuery.mock.invocationCallOrder[0]).toBeGreaterThan(
      record.mock.invocationCallOrder[0] ?? Infinity,
    );
    expect(answerCallbackQuery.mock.calls[0]?.[1]).toMatch(
      /^✅ Segnato come inviato\. Se non risponde, te lo ricordo in \/oggi da /,
    );
    expect((await prospects.load("mariofit"))?.contact.sends).toMatchObject([
      { kind: "FIRST_MESSAGES", style: "BEST", text: SHOWN[0] },
    ]);
    // Only the notice: no message in the chat, no generation.
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(suggestAgain).not.toHaveBeenCalled();
  });

  it("does not make ✅ wait for a generation under the same message", async () => {
    const { handleUpdate, suggestAgain, answerCallbackQuery } =
      await answered();
    const slow = Promise.withResolvers<Generation<NewSuggestions>>();
    suggestAgain.mockReturnValueOnce(slow.promise);

    await handleUpdate(tapOn(1_001, "1:more:F"));
    const sent = await handleUpdate(
      tapOn(1_001, "1:ok:F:1", { updateId: 301 }),
    );
    await vi.waitFor(() => {
      expect(answerCallbackQuery).toHaveBeenCalledTimes(2);
    });
    slow.resolve(generation("NEW_SUGGESTIONS", ok(NEW_REPLIES)));

    expect(sent).toMatchObject({ type: "PRESSED", button: "SENT" });
  });

  it("writes from the card what its situation calls for", async () => {
    const { handleUpdate, sendMessage, suggestAgain, answerCallbackQuery } =
      await answered();
    await handleUpdate(tapOn(1_001, "1:an:F"));
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(2);
    });

    // The card arrived as message 1002: Alex taps ✍️ on it.
    const outcome = await handleUpdate(
      tapOn(1_002, "1:w:F", { updateId: 301, suggestions: [] }),
    );
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(3);
    });

    expect(outcome).toStrictEqual({
      type: "PRESSED",
      button: "WRITE",
      kind: "FIRST_MESSAGES",
    });
    expect(answerCallbackQuery).toHaveBeenLastCalledWith(
      "query-301",
      "✍️ Scrivo tre primi messaggi…",
    );
    expect(suggestAgain.mock.calls[0]?.[0]).toStrictEqual({
      action: "MORE",
      kind: "FIRST_MESSAGES",
      previous: [],
    });
    expect(sendMessage.mock.calls[2]?.[1]).toMatch(
      /^✍️ <b>@mariofit<\/b> · 3 primi messaggi\n/,
    );
    expect(sendMessage.mock.calls[2]?.[2]).toMatchObject({ replyTo: 1_002 });
  });

  it("keeps suggestions and usernames out of the logs of taps", async () => {
    const { handleUpdate, sendMessage, log } = await answered();

    await handleUpdate(tapOn(1_001, "1:nat:F"));
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(2);
    });
    await handleUpdate(tapOn(1_001, "1:an:F", { updateId: 301 }));
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(3);
    });

    const logs = JSON.stringify([
      log.info.mock.calls,
      log.warn.mock.calls,
      log.error.mock.calls,
    ]);
    expect(logs).toContain("button handled");
    for (const content of [
      "mariofit",
      "Ti mando",
      "START",
      "Bel profilo",
      "1:nat",
      "1:an",
    ]) {
      expect(logs).not.toContain(content);
    }
  });
});
