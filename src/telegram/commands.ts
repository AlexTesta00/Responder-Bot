import type { MessageContent } from "./update.ts";

const START_REPLY = [
  "Ciao! 👋 Sono il tuo copilota per l'outreach su Instagram.",
  "",
  "Sto ancora imparando: per ora rispondo solo ai comandi. Presto potrai mandarmi profili e screenshot delle conversazioni, e ti suggerirò il prossimo messaggio da inviare.",
  "",
  "Scrivi /help per vedere i comandi disponibili.",
].join("\n");

const HELP_REPLY = [
  "Comandi disponibili:",
  "/start – presentazione del bot",
  "/help – questo elenco",
].join("\n");

const FALLBACK_REPLY =
  "Per ora capisco solo /start e /help. Scrivi /help per vedere i comandi.";

type Command = "start" | "help";

/** Recognizes "/start", "/help@SomeBot" and commands followed by arguments. */
const parseCommand = (text: string): Command | undefined => {
  const name = /^\/([a-z]+)(?:@\w+)?(?:\s|$)/i.exec(text.trim())?.[1];
  const command = name?.toLowerCase();
  return command === "start" || command === "help" ? command : undefined;
};

/** The reply the bot sends to an authorized message. */
export const replyTo = (content: MessageContent): string => {
  const command =
    content.type === "TEXT" ? parseCommand(content.text) : undefined;

  switch (command) {
    case "start":
      return START_REPLY;
    case "help":
      return HELP_REPLY;
    case undefined:
      return FALLBACK_REPLY;
  }
};
