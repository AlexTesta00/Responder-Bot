/** Telegram's limit for the text of a message, after entities parsing. */
export const MAX_MESSAGE_LENGTH = 4_096;

/**
 * The length of an HTML message as Telegram counts it, in UTF-16 code units:
 * the text without tags, with a named entity as one character and a numeric
 * one as two, the most it can take.
 */
export const telegramLength = (html: string): number =>
  html
    .replaceAll(/<[^>]*>/g, "")
    .replaceAll(/&(?:amp|lt|gt|quot);/g, "_")
    .replaceAll(/&#(?:\d+|x[\da-f]+);/gi, "__").length;

export const fitsInMessage = (html: string): boolean =>
  telegramLength(html) <= MAX_MESSAGE_LENGTH;
