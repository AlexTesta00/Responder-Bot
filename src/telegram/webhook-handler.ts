import { classifyText, type Input } from "../inputs/classify.ts";
import { withDownloadedImages, type DownloadImage } from "../inputs/images.ts";
import type { Logger } from "../shared/logger.ts";
import {
  isRetryable,
  type TelegramClient,
  type TelegramError,
} from "./client.ts";
import type { TelegramUserId } from "./ids.ts";
import type { ProcessedUpdates } from "./processed-updates.ts";
import { imageProblemReply, replyTo } from "./replies.ts";
import type { IncomingUpdate, MessageContent } from "./update.ts";

export type IgnoredReason =
  | "UNSUPPORTED_UPDATE"
  | "NOT_PRIVATE_CHAT"
  | "UNAUTHORIZED_SENDER"
  | "DUPLICATE";

export type UpdateOutcome =
  | Readonly<{ type: "REPLIED"; input: Input["type"] }>
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
  downloadImage: DownloadImage;
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

/** Decides what to do with an update and answers the allowed user. */
export const createUpdateHandler = ({
  allowedUserId,
  processedUpdates,
  sendMessage,
  downloadImage,
}: UpdateHandlerDependencies): UpdateHandler => {
  const replyText = async (input: Input, log: Logger): Promise<string> => {
    if (input.type !== "SCREENSHOTS") {
      return replyTo(input);
    }

    // For now the screenshots are only checked: downloaded, read and wiped.
    // The analysis will use them once the AI engine exists.
    const checked = await withDownloadedImages(
      input.images,
      downloadImage,
      () => Promise.resolve(),
    );
    if (checked.ok) {
      return replyTo(input);
    }
    log.warn({ image_problem: checked.error }, "screenshots not processed");
    return imageProblemReply(checked.error);
  };

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

    const input = inputOf(message.content);
    const sent = await sendMessage(message.chatId, await replyText(input, log));
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
