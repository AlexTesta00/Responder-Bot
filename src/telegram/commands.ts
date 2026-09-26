import { classifyText } from "../inputs/classify.ts";
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

/** The reply the bot sends to an authorized message. */
export const replyTo = (content: MessageContent): string => {
  const input = content.type === "TEXT" ? classifyText(content.text) : null;
  if (input?.type !== "COMMAND") {
    return FALLBACK_REPLY;
  }

  switch (input.command) {
    case "start":
      return START_REPLY;
    case "help":
      return HELP_REPLY;
  }
};
