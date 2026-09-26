import { z } from "zod";

// User and chat ids are both numbers, and in private chats they are even
// equal, so mixing them up would go unnoticed. Branded types make the
// compiler tell them apart; values only get a brand by passing validation.

export const telegramUserIdSchema = z
  .number()
  .int()
  .positive()
  .brand<"TelegramUserId">();

export type TelegramUserId = z.infer<typeof telegramUserIdSchema>;

export const telegramChatIdSchema = z.number().int().brand<"TelegramChatId">();

export type TelegramChatId = z.infer<typeof telegramChatIdSchema>;
