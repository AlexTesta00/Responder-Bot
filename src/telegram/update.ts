import { z } from "zod";

import type { ButtonPress } from "../copilot/buttons.ts";
import type { ImageRef } from "../inputs/images.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { decodeButton } from "./button-data.ts";
import {
  telegramChatIdSchema,
  telegramUserIdSchema,
  type TelegramChatId,
  type TelegramUserId,
} from "./ids.ts";

// Only the fields the bot uses: Zod drops everything else.
const chatSchema = z.object({
  id: telegramChatIdSchema,
  type: z.enum(["private", "group", "supergroup", "channel"]),
});

const photoSizeSchema = z.object({
  file_id: z.string().min(1),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  file_size: z.number().int().nonnegative().optional(),
});

const documentSchema = z.object({
  file_id: z.string().min(1),
  mime_type: z.string().optional(),
  file_size: z.number().int().nonnegative().optional(),
});

const messageSchema = z.object({
  from: z.object({ id: telegramUserIdSchema }).optional(),
  chat: chatSchema,
  text: z.string().optional(),
  caption: z.string().optional(),
  media_group_id: z.string().optional(),
  // Telegram sends each photo in several sizes.
  photo: z.array(photoSizeSchema).optional(),
  document: documentSchema.optional(),
  reply_to_message: z
    .object({ message_id: z.number().int().nonnegative() })
    .optional(),
});

const entitySchema = z.object({
  type: z.string(),
  offset: z.number().int().nonnegative(),
  length: z.number().int().positive(),
});

// A tap on a button. Its own schema: the message it carries was sent by
// the bot, so its sender is the bot and the one who tapped is `from`.
const callbackQuerySchema = z.object({
  id: z.string().min(1),
  from: z.object({ id: telegramUserIdSchema }),
  // Missing for buttons of inline messages; a deleted or too old message
  // arrives without text, with date 0.
  message: z
    .object({
      message_id: z.number().int().positive(),
      date: z.number().int().nonnegative(),
      chat: chatSchema,
      text: z.string().optional(),
      entities: z.array(entitySchema).optional(),
    })
    .optional(),
  data: z.string().optional(),
});

const updateSchema = z.object({
  update_id: z.number().int().nonnegative(),
  message: messageSchema.optional(),
  callback_query: callbackQuerySchema.optional(),
});

type ParsedCallbackMessage = NonNullable<
  z.infer<typeof callbackQuerySchema>["message"]
>;

type ParsedMessage = z.infer<typeof messageSchema>;

type PhotoSize = z.infer<typeof photoSizeSchema>;

export type ChatType = z.infer<typeof chatSchema>["type"];

export type MessageContent =
  | Readonly<{
      type: "TEXT";
      text: string;
      /** The message Alex replied to, when it is a reply. */
      replyTo: number | null;
    }>
  | Readonly<{
      type: "IMAGE";
      image: ImageRef;
      caption: string | null;
      /** Shared by the images of an album, which arrive as separate updates. */
      mediaGroupId: string | null;
    }>
  | Readonly<{ type: "OTHER" }>;

export type IncomingMessage = Readonly<{
  chatId: TelegramChatId;
  chatType: ChatType;
  senderId: TelegramUserId;
  content: MessageContent;
}>;

/** The message of the bot whose button was tapped. */
export type TappedBotMessage = Readonly<{
  chatId: TelegramChatId;
  chatType: ChatType;
  messageId: number;
  /** The suggestions it shows, in order; empty when it cannot be read. */
  suggestions: readonly string[];
}>;

export type IncomingCallback = Readonly<{
  queryId: string;
  /** Who tapped the button. */
  senderId: TelegramUserId;
  /** Null for a button that is not under a message of a chat. */
  message: TappedBotMessage | null;
  /** Null when the button's data is unknown, such as an older version. */
  press: ButtonPress | null;
}>;

export type IncomingUpdate =
  | Readonly<{ type: "MESSAGE"; updateId: number; message: IncomingMessage }>
  | Readonly<{ type: "CALLBACK"; updateId: number; callback: IncomingCallback }>
  | Readonly<{ type: "UNSUPPORTED"; updateId: number }>;

/** Suggestions show in <pre> blocks, and nothing else does. */
const MAX_SUGGESTIONS = 3;

export type UpdateParseError = Readonly<{
  type: "INVALID_UPDATE";
  /** Paths of the fields that failed validation, never their values. */
  fields: readonly string[];
}>;

const largest = (sizes: readonly PhotoSize[]): PhotoSize | undefined =>
  sizes.reduce<PhotoSize | undefined>(
    (best, size) =>
      best === undefined || size.width * size.height > best.width * best.height
        ? size
        : best,
    undefined,
  );

/** The photo, or an image sent as a file to avoid Telegram's compression. */
const imageOf = (message: ParsedMessage): ImageRef | null => {
  const photo = largest(message.photo ?? []);
  if (photo !== undefined) {
    return { fileId: photo.file_id, fileSize: photo.file_size ?? null };
  }

  const { document } = message;
  if (document?.mime_type?.startsWith("image/") === true) {
    return { fileId: document.file_id, fileSize: document.file_size ?? null };
  }

  return null;
};

const contentOf = (message: ParsedMessage): MessageContent => {
  if (message.text !== undefined) {
    return {
      type: "TEXT",
      text: message.text,
      replyTo: message.reply_to_message?.message_id ?? null,
    };
  }

  const image = imageOf(message);
  if (image === null) {
    return { type: "OTHER" };
  }

  return {
    type: "IMAGE",
    image,
    caption: message.caption ?? null,
    mediaGroupId: message.media_group_id ?? null,
  };
};

/**
 * The texts of the <pre> blocks, in order. Entity offsets count UTF-16 code
 * units, as JavaScript strings do.
 */
const suggestionsOf = ({ text, entities = [] }: ParsedCallbackMessage) =>
  text === undefined
    ? []
    : entities
        .filter(
          (entity) =>
            entity.type === "pre" &&
            entity.offset + entity.length <= text.length,
        )
        .toSorted((a, b) => a.offset - b.offset)
        .slice(0, MAX_SUGGESTIONS)
        .map((entity) =>
          text.slice(entity.offset, entity.offset + entity.length),
        );

/** Translates a Telegram update payload into the bot's own types. */
export const parseUpdate = (
  payload: unknown,
): Result<IncomingUpdate, UpdateParseError> => {
  const parsed = updateSchema.safeParse(payload);

  if (!parsed.success) {
    return err({
      type: "INVALID_UPDATE",
      fields: parsed.error.issues.map((issue) => issue.path.join(".")),
    });
  }

  const { update_id: updateId, message, callback_query: query } = parsed.data;

  if (query !== undefined) {
    return ok({
      type: "CALLBACK",
      updateId,
      callback: {
        queryId: query.id,
        senderId: query.from.id,
        message:
          query.message === undefined
            ? null
            : {
                chatId: query.message.chat.id,
                chatType: query.message.chat.type,
                messageId: query.message.message_id,
                suggestions: suggestionsOf(query.message),
              },
        press: decodeButton(query.data),
      },
    });
  }

  if (message?.from === undefined) {
    return ok({ type: "UNSUPPORTED", updateId });
  }

  return ok({
    type: "MESSAGE",
    updateId,
    message: {
      chatId: message.chat.id,
      chatType: message.chat.type,
      senderId: message.from.id,
      content: contentOf(message),
    },
  });
};
