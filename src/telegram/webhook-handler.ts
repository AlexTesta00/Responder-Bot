import {
  isRetryable,
  type TelegramClient,
  type TelegramError,
} from "./client.ts";
import { replyTo } from "./commands.ts";
import type { TelegramUserId } from "./ids.ts";
import type { IncomingUpdate } from "./update.ts";

export type IgnoredReason =
  "UNSUPPORTED_UPDATE" | "NOT_PRIVATE_CHAT" | "UNAUTHORIZED_SENDER";

export type UpdateOutcome =
  | Readonly<{ type: "REPLIED" }>
  | Readonly<{ type: "IGNORED"; reason: IgnoredReason }>
  | Readonly<{ type: "FAILED"; retryable: boolean; error: TelegramError }>;

export type UpdateHandler = (update: IncomingUpdate) => Promise<UpdateOutcome>;

export type UpdateHandlerDependencies = Readonly<{
  allowedUserId: TelegramUserId;
  sendMessage: TelegramClient["sendMessage"];
}>;

export const isAuthorizedUser = (
  allowedUserId: TelegramUserId,
  senderUserId: TelegramUserId,
): boolean => allowedUserId === senderUserId;

const ignored = (reason: IgnoredReason): UpdateOutcome => ({
  type: "IGNORED",
  reason,
});

/** Decides what to do with an update and answers the allowed user. */
export const createUpdateHandler =
  ({ allowedUserId, sendMessage }: UpdateHandlerDependencies): UpdateHandler =>
  async (update) => {
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

    const sent = await sendMessage(message.chatId, replyTo(message.content));

    return sent.ok
      ? { type: "REPLIED" }
      : {
          type: "FAILED",
          retryable: isRetryable(sent.error),
          error: sent.error,
        };
  };
