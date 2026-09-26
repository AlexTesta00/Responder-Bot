import type { ImageRef } from "./images.ts";
import { usernameFromLinks, usernameFromMention } from "./instagram.ts";

export type Command = "start" | "help";

/** "/credito" alone shows the costs; with an amount it sets the credit. */
export type CreditRequest =
  | Readonly<{ type: "SHOW" }>
  /** The credit read on the Claude Console, in millionths of a dollar. */
  | Readonly<{ type: "SET"; amountMicroUsd: number }>
  | Readonly<{ type: "INVALID" }>;

/** What a text message is, from the bot's point of view. */
export type TextInput =
  | Readonly<{ type: "COMMAND"; command: Command }>
  | Readonly<{ type: "CREDIT"; request: CreditRequest }>
  | Readonly<{ type: "UNKNOWN_COMMAND" }>
  | Readonly<{ type: "INSTAGRAM_PROFILE"; username: string }>
  | Readonly<{ type: "LINK"; url: string }>
  | Readonly<{
      type: "TEXT";
      text: string;
      /** The prospect named on the first line, as in "@name". */
      username: string | null;
    }>;

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

/** Credits up to a million dollars, as "25", "25,40", "25.4" or "$25". */
const creditRequestOf = (argument: string): CreditRequest => {
  if (argument === "") {
    return { type: "SHOW" };
  }
  const amount = /^\$?\s*(\d{1,6})(?:[.,](\d{1,2}))?\s*\$?$/.exec(argument);
  if (amount === null) {
    return { type: "INVALID" };
  }
  const [, dollars = "0", cents = "0"] = amount;
  return {
    type: "SET",
    amountMicroUsd:
      Number(dollars) * 1_000_000 + Number(cents.padEnd(2, "0")) * 10_000,
  };
};

const isWebLink = (text: string): boolean =>
  !/\s/.test(text) &&
  URL.canParse(text) &&
  ["http:", "https:"].includes(new URL(text).protocol);

export const classifyText = (text: string): TextInput => {
  const trimmed = text.trim();

  if (trimmed.startsWith("/")) {
    const name = commandName(trimmed);
    if (name === "credito") {
      const argument = trimmed.replace(/^\/\S+/, "").trim();
      return { type: "CREDIT", request: creditRequestOf(argument) };
    }
    return isCommand(name)
      ? { type: "COMMAND", command: name }
      : { type: "UNKNOWN_COMMAND" };
  }

  // A conversation pasted under the prospect's @username.
  const [firstLine = "", ...rest] = trimmed.split("\n");
  const named =
    rest.length === 0 ? null : usernameFromMention(firstLine.trim());
  const pasted = rest.join("\n").trim();
  if (named !== null && pasted !== "") {
    return { type: "TEXT", text: pasted, username: named };
  }

  const username = usernameFromMention(trimmed) ?? usernameFromLinks(trimmed);
  if (username !== null) {
    return { type: "INSTAGRAM_PROFILE", username };
  }

  return isWebLink(trimmed)
    ? { type: "LINK", url: trimmed }
    : { type: "TEXT", text: trimmed, username: null };
};
