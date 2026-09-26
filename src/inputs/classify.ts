import type { ImageRef } from "./images.ts";
import { usernameFromLinks, usernameFromMention } from "./instagram.ts";

export type Command = "start" | "help";

/** What a text message is, from the bot's point of view. */
export type TextInput =
  | Readonly<{ type: "COMMAND"; command: Command }>
  | Readonly<{ type: "UNKNOWN_COMMAND" }>
  | Readonly<{ type: "INSTAGRAM_PROFILE"; username: string }>
  | Readonly<{ type: "LINK"; url: string }>
  | Readonly<{ type: "TEXT"; text: string }>;

/** Everything the bot can receive. */
export type Input =
  | TextInput
  | Readonly<{
      type: "SCREENSHOTS";
      images: readonly ImageRef[];
      caption: string | null;
    }>
  | Readonly<{ type: "UNSUPPORTED" }>;

/** Name of commands such as "/start", "/help@SomeBot" or "/start ref-42". */
const commandName = (text: string): string | undefined =>
  /^\/([a-z]+)(?:@\w+)?(?:\s|$)/i.exec(text)?.[1]?.toLowerCase();

const isCommand = (name: string | undefined): name is Command =>
  name === "start" || name === "help";

const isWebLink = (text: string): boolean =>
  !/\s/.test(text) &&
  URL.canParse(text) &&
  ["http:", "https:"].includes(new URL(text).protocol);

export const classifyText = (text: string): TextInput => {
  const trimmed = text.trim();

  if (trimmed.startsWith("/")) {
    const name = commandName(trimmed);
    return isCommand(name)
      ? { type: "COMMAND", command: name }
      : { type: "UNKNOWN_COMMAND" };
  }

  const username = usernameFromMention(trimmed) ?? usernameFromLinks(trimmed);
  if (username !== null) {
    return { type: "INSTAGRAM_PROFILE", username };
  }

  return isWebLink(trimmed)
    ? { type: "LINK", url: trimmed }
    : { type: "TEXT", text: trimmed };
};
