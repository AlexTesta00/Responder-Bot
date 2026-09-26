// What Alex sees after tapping a button: the notice at the top of the chat
// (at most 200 characters) and the replies when the bot writes nothing.
import type { ButtonAction } from "../copilot/buttons.ts";

/** The notice shown as soon as Alex taps, while the bot works. */
export const pressNotice = (action: ButtonAction): string | undefined => {
  switch (action) {
    case "MORE":
      return "🔄 Scrivo altre 3 proposte…";
    case "NATURAL":
      return "🙂 Le riscrivo più naturali…";
    case "DIRECT":
      return "🎯 Le riscrivo più dirette…";
    case "FOLLOW_UP":
      return "💬 Preparo il follow-up…";
    case "ANALYZE":
      // What the bot remembers arrives at once.
      return undefined;
  }
};

export const EXPIRED_BUTTON_NOTICE =
  "⌛ Questo bottone non vale più: usa l'ultima risposta o mandami di nuovo lo screenshot.";

export const BUSY_NOTICE = "⏳ Ci sto già lavorando: arriva tra poco.";

export const NOT_LINKED_REPLY =
  "🤷 Non so più di quale prospect parla questo messaggio: mandami di nuovo gli screenshot, o scrivi @username nella prima riga del testo.";

export const MEMORY_UNAVAILABLE_REPLY =
  "⚠️ Memoria non disponibile: ora non posso preparare nuovi messaggi. Riprova tra qualche minuto.";
