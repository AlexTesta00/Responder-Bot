import type { AiError } from "../ai/engine.ts";
import type { SpendingLedger } from "../ai/spending.ts";
import type { ReplyToConversation } from "../copilot/conversation.ts";
import type { ProspectReference } from "../copilot/memory.ts";
import type { AnalyzeScreenshots } from "../copilot/screenshots.ts";
import type { ProspectStore } from "../prospects/store.ts";
import { errorFields } from "../shared/errors.ts";
import {
  classifyText,
  type CreditRequest,
  type Input,
} from "../inputs/classify.ts";
import {
  withDownloadedImages,
  type DownloadImage,
  type ImageRef,
} from "../inputs/images.ts";
import type { Logger } from "../shared/logger.ts";
import type { Result } from "../shared/result.ts";
import {
  isKeyboardRejection,
  isRetryable,
  type SendOptions,
  type TelegramClient,
  type TelegramError,
} from "./client.ts";
import {
  costLine,
  creditSetReply,
  INVALID_CREDIT_REPLY,
  SPENDING_UNAVAILABLE_REPLY,
  spendingReport,
} from "./costs.ts";
import type { TelegramChatId, TelegramUserId } from "./ids.ts";
import { createMediaGroupCollector, type Schedule } from "./media-group.ts";
import type { ProcessedUpdates } from "./processed-updates.ts";
import { imageProblemReply, replyTo } from "./replies.ts";
import {
  aiProblemReply,
  conversationAnswer,
  escapeHtml,
  plainMessage,
  screenshotsAnswer,
  type Footer,
  type Presented,
} from "./suggestions.ts";
import type { IncomingUpdate, MessageContent } from "./update.ts";

/** How long to wait for more photos of an album before answering. */
export const ALBUM_QUIET_MS = 2_000;

/** Telegram albums hold at most ten items. */
const ALBUM_MAX_ITEMS = 10;

/** Telegram shows "typing…" for five seconds at most: renewed before then. */
export const TYPING_REFRESH_MS = 4_000;

/** Inputs answered by the AI engine, which takes too long to wait for. */
export type AiInput = Extract<
  Input,
  Readonly<{ type: "SCREENSHOTS" | "TEXT" }>
>;

/** Inputs answered while Telegram waits, the instant ones and the credit. */
export type RepliedInput = Exclude<Input, AiInput>;

export type IgnoredReason =
  | "UNSUPPORTED_UPDATE"
  | "NOT_PRIVATE_CHAT"
  | "UNAUTHORIZED_SENDER"
  | "DUPLICATE";

export type UpdateOutcome =
  | Readonly<{ type: "REPLIED"; input: RepliedInput["type"] }>
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
  /** Screenshots are analyzed with the memory of the prospect they show. */
  analyzeScreenshots: AnalyzeScreenshots;
  /** A pasted conversation, with the memory of the prospect Alex named. */
  replyToConversation: ReplyToConversation;
  /** Remembers which prospect the messages of the bot are about. */
  linkMessages: ProspectStore["linkMessages"];
  /** What the analyses cost, and the credit Alex set. */
  spending: SpendingLedger;
  /** The monthly spend limit set on the Console, in millionths of a dollar. */
  monthlyLimitMicroUsd: number | null;
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

/**
 * Whose conversation a text is: the @username on its first line or, failing
 * that, the message of the bot it replies to.
 */
const referenceOf = (
  username: string | null,
  content: MessageContent,
  chatId: TelegramChatId,
): ProspectReference | null => {
  if (username !== null) {
    return { type: "USERNAME", username };
  }
  return content.type === "TEXT" && content.replyTo !== null
    ? { type: "REPLY", chatId, messageId: content.replyTo }
    : null;
};

/** Decides what to do with an update and answers the allowed user. */
export const createUpdateHandler = ({
  allowedUserId,
  processedUpdates,
  sendMessage,
  sendTyping,
  downloadImage,
  analyzeScreenshots,
  replyToConversation,
  linkMessages,
  spending,
  monthlyLimitMicroUsd,
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

  /**
   * What an answer cost and what is left, under the answer. Without the
   * month and the credit, the line still tells what the answer cost.
   */
  const costFooter = async (
    costMicroUsd: number | null,
    log: Logger,
  ): Promise<Footer> => {
    const current = await spending.spending().catch((error: unknown) => {
      log.warn(errorFields(error), "spending unavailable");
      return null;
    });
    return costLine({
      costMicroUsd,
      spending: current,
      monthlyLimitMicroUsd,
    });
  };

  /** The reply to /credito: sets the credit if asked, then reports. */
  const creditReply = async (
    request: CreditRequest,
    log: Logger,
  ): Promise<string> => {
    if (request.type === "INVALID") {
      return escapeHtml(INVALID_CREDIT_REPLY);
    }
    try {
      if (request.type === "SET") {
        await spending.setCredit(request.amountMicroUsd);
        log.info({}, "credit set");
      }
      const report = spendingReport(
        await spending.spending(),
        monthlyLimitMicroUsd,
      );
      return request.type === "SET"
        ? `${creditSetReply(request.amountMicroUsd)}\n\n${report}`
        : report;
    } catch (error) {
      log.error(errorFields(error), "spending unavailable");
      return escapeHtml(SPENDING_UNAVAILABLE_REPLY);
    }
  };

  /**
   * Sends an HTML message and returns its id. When Telegram refuses its
   * buttons, the text still arrives, without them.
   */
  const deliver = async (
    chatId: TelegramChatId,
    { html, keyboard }: Presented,
    log: Logger,
  ): Promise<number | null> => {
    const options: SendOptions = { parseMode: "HTML" };
    const first = await sendMessage(
      chatId,
      html,
      keyboard === null ? options : { ...options, keyboard },
    );
    const refused =
      !first.ok && keyboard !== null && isKeyboardRejection(first.error);
    if (refused) {
      log.warn(
        { telegram_error: first.error },
        "keyboard rejected, answer resent without buttons",
      );
    }
    const delivery = refused ? await sendMessage(chatId, html, options) : first;
    if (!delivery.ok) {
      log.error(
        { error_type: delivery.error.type, telegram_error: delivery.error },
        "reply not delivered",
      );
      return null;
    }
    return delivery.value.messageId;
  };

  /**
   * Delivers an answer about a prospect, then links it to them: replying to
   * it continues that prospect's conversation.
   */
  const deliverAnswer = async <T>(
    chatId: TelegramChatId,
    result: Result<T, AiError>,
    present: (value: T, footer: Footer) => Presented,
    answer: Readonly<{
      prospectId: string | null;
      costMicroUsd: number | null;
    }>,
    log: Logger,
  ): Promise<void> => {
    const { prospectId } = answer;
    const footer = await costFooter(answer.costMicroUsd, log);
    const sent = await deliver(
      chatId,
      result.ok
        ? present(result.value, footer)
        : plainMessage(aiProblemReply(result.error), footer),
      log,
    );
    if (prospectId === null || sent === null) {
      return;
    }
    try {
      await linkMessages(prospectId, chatId, [sent]);
    } catch (error) {
      // The answer arrived: only replying to it loses the prospect.
      log.warn(errorFields(error), "bot messages not linked to the prospect");
    }
  };

  const answerScreenshots = async (
    chatId: TelegramChatId,
    images: readonly ImageRef[],
    caption: string | null,
    log: Logger,
  ): Promise<void> => {
    const analyzed = await whileTyping(chatId, () =>
      withDownloadedImages(images, downloadImage, (downloaded) =>
        analyzeScreenshots(downloaded, caption, log),
      ),
    );
    if (!analyzed.ok) {
      log.warn({ image_problem: analyzed.error }, "screenshots not processed");
      await deliver(
        chatId,
        plainMessage(imageProblemReply(analyzed.error)),
        log,
      );
      return;
    }
    const { generation, memory, pause } = analyzed.value;
    await deliverAnswer(
      chatId,
      generation.result,
      (analysis, footer) => screenshotsAnswer(analysis, memory, pause, footer),
      analyzed.value,
      log,
    );
  };

  const answerConversation = async (
    chatId: TelegramChatId,
    text: string,
    reference: ProspectReference | null,
    log: Logger,
  ): Promise<void> => {
    const answer = await whileTyping(chatId, () =>
      replyToConversation(text, reference, log),
    );
    const { generation, username, memory, pause } = answer;
    await deliverAnswer(
      chatId,
      generation.result,
      (reply, footer) =>
        conversationAnswer(reply, username, memory, pause, footer),
      answer,
      log,
    );
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
      runInBackground(
        answerConversation(
          chatId,
          input.text,
          referenceOf(input.username, content, chatId),
          log,
        ),
        log,
      );
      return { type: "ACCEPTED", input: input.type };
    }

    const sent =
      input.type === "CREDIT"
        ? await sendMessage(chatId, await creditReply(input.request, log), {
            parseMode: "HTML",
          })
        : await sendMessage(chatId, replyTo(input));
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
