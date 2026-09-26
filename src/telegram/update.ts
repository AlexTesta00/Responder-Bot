import { z } from "zod";

import { err, ok, type Result } from "../shared/result.ts";

// Only the fields the bot uses: Zod drops everything else.
const chatSchema = z.object({
  id: z.number().int(),
  type: z.enum(["private", "group", "supergroup", "channel"]),
});

const messageSchema = z.object({
  from: z.object({ id: z.number().int() }).optional(),
  chat: chatSchema,
  text: z.string().optional(),
});

const updateSchema = z.object({
  update_id: z.number().int().nonnegative(),
  message: messageSchema.optional(),
});

export type ChatType = z.infer<typeof chatSchema>["type"];

export type MessageContent =
  Readonly<{ type: "TEXT"; text: string }> | Readonly<{ type: "OTHER" }>;

export type IncomingMessage = Readonly<{
  chatId: number;
  chatType: ChatType;
  senderId: number;
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
      content:
        message.text === undefined
          ? { type: "OTHER" }
          : { type: "TEXT", text: message.text },
    },
  });
};
