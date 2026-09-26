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
import { imageProblemReply, replyTo } from "./replies.ts";
import type { IncomingUpdate, MessageContent } from "./update.ts";

/** How long to wait for more photos of an album before answering. */
export const ALBUM_QUIET_MS = 2_000;

/** Telegram albums hold at most ten items. */
const ALBUM_MAX_ITEMS = 10;

export type IgnoredReason =
  | "UNSUPPORTED_UPDATE"
  | "NOT_PRIVATE_CHAT"
  | "UNAUTHORIZED_SENDER"
  | "DUPLICATE";

export type UpdateOutcome =
  | Readonly<{ type: "REPLIED"; input: Input["type"] }>
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
  downloadImage: DownloadImage;
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

/** Decides what to do with an update and answers the allowed user. */
export const createUpdateHandler = ({
  allowedUserId,
  processedUpdates,
  sendMessage,
  downloadImage,
  schedule,
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

  // The album's updates have already been acknowledged, so a failure here
  // cannot be retried by Telegram: it is only logged.
  const answerAlbum = async (photos: readonly AlbumPhoto[]): Promise<void> => {
    const [first] = photos;
    const last = photos.at(-1);
    if (first === undefined || last === undefined) {
      return;
    }

    const input: Input = {
      type: "SCREENSHOTS",
      images: photos.map((photo) => photo.image),
      caption: photos.find((photo) => photo.caption !== null)?.caption ?? null,
    };
    const sent = await sendMessage(
      first.chatId,
      await replyText(input, last.log),
    );

    const fields = { input: input.type, images: photos.length };
    if (sent.ok) {
      last.log.info(
        { ...fields, outcome: "REPLIED" },
        "telegram album handled",
      );
    } else {
      last.log.error(
        {
          ...fields,
          outcome: "FAILED",
          error_type: sent.error.type,
          telegram_error: sent.error,
        },
        "telegram album failed",
      );
    }
  };

  const albums = createMediaGroupCollector<AlbumPhoto>({
    quietMs: ALBUM_QUIET_MS,
    maxItems: ALBUM_MAX_ITEMS,
    schedule,
    onComplete: (photos) => {
      answerAlbum(photos).catch((error: unknown) => {
        photos.at(-1)?.log.error({ err: error }, "telegram album crashed");
      });
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

    const { content } = message;
    if (content.type === "IMAGE" && content.mediaGroupId !== null) {
      // Each photo of an album arrives as its own update: they are answered
      // together, with a single analysis.
      albums.add(`${String(message.chatId)}:${content.mediaGroupId}`, {
        chatId: message.chatId,
        image: content.image,
        caption: content.caption,
        log,
      });
      return { type: "COLLECTED" };
    }

    const input = inputOf(content);
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
