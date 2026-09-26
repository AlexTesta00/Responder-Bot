import { z } from "zod";

import type { ImageRef } from "../inputs/images.ts";
import { err, ok, type Result } from "../shared/result.ts";
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
});

const updateSchema = z.object({
  update_id: z.number().int().nonnegative(),
  message: messageSchema.optional(),
});

type ParsedMessage = z.infer<typeof messageSchema>;

type PhotoSize = z.infer<typeof photoSizeSchema>;

export type ChatType = z.infer<typeof chatSchema>["type"];

export type MessageContent =
  | Readonly<{ type: "TEXT"; text: string }>
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

export type IncomingUpdate =
  | Readonly<{ type: "MESSAGE"; updateId: number; message: IncomingMessage }>
  | Readonly<{ type: "UNSUPPORTED"; updateId: number }>;

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
    return { type: "TEXT", text: message.text };
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

  const { update_id: updateId, message } = parsed.data;

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
