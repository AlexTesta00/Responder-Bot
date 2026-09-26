import type { AiEngine, Generation } from "../ai/engine.ts";
import { classifyText, type Input } from "../inputs/classify.ts";
import {
  withDownloadedImages,
  type DownloadImage,
  type ImageRef,
} from "../inputs/images.ts";
import type { Logger } from "../shared/logger.ts";
import {
  isRetryable,
  type TelegramClient,
  type TelegramError,
} from "./client.ts";
import type { TelegramChatId, TelegramUserId } from "./ids.ts";
import { createMediaGroupCollector, type Schedule } from "./media-group.ts";
import type { ProcessedUpdates } from "./processed-updates.ts";
import { imageProblemReply, replyTo, type InstantInput } from "./replies.ts";
import {
  aiProblemReply,
  conversationMessages,
  escapeHtml,
  screenshotsMessages,
} from "./suggestions.ts";
import type { IncomingUpdate, MessageContent } from "./update.ts";

/** How long to wait for more photos of an album before answering. */
export const ALBUM_QUIET_MS = 2_000;

/** Telegram albums hold at most ten items. */
const ALBUM_MAX_ITEMS = 10;

/** Telegram shows "typing…" for five seconds at most: renewed before then. */
export const TYPING_REFRESH_MS = 4_000;

/** Inputs answered by the AI engine, which takes too long to wait for. */
export type AiInput = Exclude<Input, InstantInput>;

export type IgnoredReason =
  | "UNSUPPORTED_UPDATE"
  | "NOT_PRIVATE_CHAT"
  | "UNAUTHORIZED_SENDER"
  | "DUPLICATE";

export type UpdateOutcome =
  | Readonly<{ type: "REPLIED"; input: InstantInput["type"] }>
  /** Handed to the AI engine: the answer follows in the background. */
  | Readonly<{ type: "ACCEPTED"; input: AiInput["type"] }>
  /** An album photo, answered together with the rest of its album. */
  | Readonly<{ type: "COLLECTED" }>
  | Readonly<{ type: "IGNORED"; reason: IgnoredReason }>
  | Readonly<{ type: "FAILED"; retryable: boolean; error: TelegramError }>;

export type UpdateHandler = (
  update: IncomingUpdate,
  log: Logger,
) => Promise<UpdateOutcome>;

export type UpdateHandlerDependencies = Readonly<{
  allowedUserId: TelegramUserId;
  processedUpdates: ProcessedUpdates;
  sendMessage: TelegramClient["sendMessage"];
  sendTyping: TelegramClient["sendTyping"];
  downloadImage: DownloadImage;
  ai: AiEngine;
  schedule: Schedule;
}>;

type AlbumPhoto = Readonly<{
  chatId: TelegramChatId;
  image: ImageRef;
  caption: string | null;
  log: Logger;
}>;

export const isAuthorizedUser = (
  allowedUserId: TelegramUserId,
  senderUserId: TelegramUserId,
): boolean => allowedUserId === senderUserId;

const ignored = (reason: IgnoredReason): UpdateOutcome => ({
  type: "IGNORED",
  reason,
});

const inputOf = (content: MessageContent): Input => {
  switch (content.type) {
    case "TEXT":
      return classifyText(content.text);
    case "IMAGE":
      return {
        type: "SCREENSHOTS",
        images: [content.image],
        caption: content.caption,
      };
    case "OTHER":
      return { type: "UNSUPPORTED" };
  }
};

/** Token usage and timings of a generation; never what it read or wrote. */
const logGeneration = <T>(
  { result, report }: Generation<T>,
  log: Logger,
): void => {
  const fields = {
    ai_mode: report.mode,
    prompt: report.prompt,
    model: report.model,
    duration_ms: report.durationMs,
    input_tokens: report.inputTokens,
    output_tokens: report.outputTokens,
    cache_read_tokens: report.cacheReadTokens,
    stop_reason: report.stopReason,
  };
  if (result.ok) {
    log.info(fields, "ai generation completed");
  } else {
    log.warn({ ...fields, ai_error: result.error }, "ai generation failed");
  }
};

/** Decides what to do with an update and answers the allowed user. */
export const createUpdateHandler = ({
  allowedUserId,
  processedUpdates,
  sendMessage,
  sendTyping,
  downloadImage,
  ai,
  schedule,
}: UpdateHandlerDependencies): UpdateHandler => {
  // The AI engine answers after Telegram has been acknowledged, so its
  // failures cannot be retried by Telegram: they are explained or logged.
  const runInBackground = (task: Promise<void>, log: Logger): void => {
    task.catch((error: unknown) => {
      log.error({ err: error }, "background processing crashed");
    });
  };

  /** Shows "typing…" in the chat while `task` runs. */
  const whileTyping = async <T>(
    chatId: TelegramChatId,
    task: () => Promise<T>,
  ): Promise<T> => {
    let cancel = (): void => undefined;
    const showTyping = (): void => {
      // Only a courtesy: when Telegram fails here, the answer fails too and
      // that failure is logged.
      void sendTyping(chatId);
      cancel = schedule(showTyping, TYPING_REFRESH_MS);
    };

    showTyping();
    try {
      return await task();
    } finally {
      cancel();
    }
  };

  /** Sends HTML messages in order, stopping at the first one that fails. */
  const deliver = async (
    chatId: TelegramChatId,
    messages: readonly string[],
    log: Logger,
  ): Promise<void> => {
    for (const [index, text] of messages.entries()) {
      const sent = await sendMessage(chatId, text, "HTML");
      if (!sent.ok) {
        log.error(
          {
            message_index: index,
            messages: messages.length,
            error_type: sent.error.type,
            telegram_error: sent.error,
          },
          "reply not delivered",
        );
        return;
      }
    }
  };

  const deliverGeneration = <T>(
    chatId: TelegramChatId,
    generation: Generation<T>,
    present: (value: T) => readonly string[],
    log: Logger,
  ): Promise<void> => {
    logGeneration(generation, log);
    const { result } = generation;
    return deliver(
      chatId,
      result.ok
        ? present(result.value)
        : [escapeHtml(aiProblemReply(result.error))],
      log,
    );
  };

  const answerScreenshots = async (
    chatId: TelegramChatId,
    images: readonly ImageRef[],
    caption: string | null,
    log: Logger,
  ): Promise<void> => {
    const analyzed = await whileTyping(chatId, () =>
      withDownloadedImages(images, downloadImage, (downloaded) =>
        ai.analyzeScreenshots(downloaded, caption, null),
      ),
    );
    if (!analyzed.ok) {
      log.warn({ image_problem: analyzed.error }, "screenshots not processed");
      await deliver(
        chatId,
        [escapeHtml(imageProblemReply(analyzed.error))],
        log,
      );
      return;
    }
    await deliverGeneration(chatId, analyzed.value, screenshotsMessages, log);
  };

  const answerConversation = async (
    chatId: TelegramChatId,
    text: string,
    log: Logger,
  ): Promise<void> => {
    const generation = await whileTyping(chatId, () =>
      ai.replyToConversation(text),
    );
    await deliverGeneration(chatId, generation, conversationMessages, log);
  };

  const albums = createMediaGroupCollector<AlbumPhoto>({
    quietMs: ALBUM_QUIET_MS,
    maxItems: ALBUM_MAX_ITEMS,
    schedule,
    onComplete: (photos) => {
      const [first] = photos;
      const last = photos.at(-1);
      if (first === undefined || last === undefined) {
        return;
      }

      last.log.info(
        { input: "SCREENSHOTS", images: photos.length },
        "telegram album accepted for processing",
      );
      runInBackground(
        answerScreenshots(
          first.chatId,
          photos.map((photo) => photo.image),
          photos.find((photo) => photo.caption !== null)?.caption ?? null,
          last.log,
        ),
        last.log,
      );
    },
  });

  return async (update, log) => {
    if (update.type === "UNSUPPORTED") {
      return ignored("UNSUPPORTED_UPDATE");
    }

    const { message } = update;

    // The bot is personal: prospect data must never reach groups or channels.
    if (message.chatType !== "private") {
      return ignored("NOT_PRIVATE_CHAT");
    }
    if (!isAuthorizedUser(allowedUserId, message.senderId)) {
      return ignored("UNAUTHORIZED_SENDER");
    }
    // Telegram delivers an update again when it misses our response.
    if (!processedUpdates.claim(update.updateId)) {
      return ignored("DUPLICATE");
    }

    const { chatId, content } = message;
    if (content.type === "IMAGE" && content.mediaGroupId !== null) {
      // Each photo of an album arrives as its own update: they are answered
      // together, with a single analysis.
      albums.add(`${String(chatId)}:${content.mediaGroupId}`, {
        chatId,
        image: content.image,
        caption: content.caption,
        log,
      });
      return { type: "COLLECTED" };
    }

    const input = inputOf(content);
    if (input.type === "SCREENSHOTS") {
      runInBackground(
        answerScreenshots(chatId, input.images, input.caption, log),
        log,
      );
      return { type: "ACCEPTED", input: input.type };
    }
    if (input.type === "TEXT") {
      runInBackground(answerConversation(chatId, input.text, log), log);
      return { type: "ACCEPTED", input: input.type };
    }

    const sent = await sendMessage(chatId, replyTo(input));
    if (sent.ok) {
      return { type: "REPLIED", input: input.type };
    }

    const retryable = isRetryable(sent.error);
    if (retryable) {
      // Nothing was sent: let Telegram's next delivery try again.
      processedUpdates.release(update.updateId);
    }
    return { type: "FAILED", retryable, error: sent.error };
  };
};
