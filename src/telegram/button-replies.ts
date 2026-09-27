// What Alex sees after tapping a button: the notice at the top of the chat
// (at most 200 characters) and the replies when the bot writes nothing.
import type { ButtonAction } from "../copilot/buttons.ts";
import type { MarkedSend } from "../copilot/sends.ts";
import { dayAndTime, fromDay } from "../shared/time.ts";

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

/**
 * The notice after ✅, once the send is recorded or not: it tells what
 * comes next, so it is never shown before the send is written.
 */
export const sentNotice = (marked: MarkedSend, now: Date): string => {
  switch (marked.type) {
    case "NOT_LINKED":
      return "🤷 Non so di quale prospect parla questo messaggio: non l'ho segnato.";
    case "UNAVAILABLE":
      return "⚠️ Memoria non disponibile: non l'ho segnato. Riprova tra poco.";
    case "UNCHANGED":
      return `✅ Già segnato come inviato il ${dayAndTime(marked.sentAt)}.`;
    case "CORRECTED":
      return marked.style === null
        ? "✅ Segnato come inviato."
        : `✅ Corretto: segnato ${marked.style} come inviato.`;
    case "RECORDED": {
      const { situation } = marked;
      if (situation?.type === "WAITING") {
        return `✅ Segnato come inviato. Se non risponde, te lo ricordo in /oggi ${fromDay(situation.dueDay, now)}.`;
      }
      if (
        situation?.type === "PAUSED" &&
        situation.pause === "FOLLOW_UP_LIMIT"
      ) {
        return "✅ Segnato. Era l'ultimo follow-up: se non risponde mi fermo qui.";
      }
      if (situation?.type === "PAUSED" && situation.pause === "CLOSED") {
        return "✅ Segnato: saluto finale inviato. Non ti proporrò altri messaggi finché non ti riscrive.";
      }
      return "✅ Segnato come inviato.";
    }
  }
};

export const EXPIRED_BUTTON_NOTICE =
  "⌛ Questo bottone non vale più: usa l'ultima risposta o mandami di nuovo lo screenshot.";

export const BUSY_NOTICE = "⏳ Ci sto già lavorando: arriva tra poco.";

export const NOT_LINKED_REPLY =
  "🤷 Non so più di quale prospect parla questo messaggio: mandami di nuovo gli screenshot, o scrivi @username nella prima riga del testo.";

export const MEMORY_UNAVAILABLE_REPLY =
  "⚠️ Memoria non disponibile: ora non posso preparare nuovi messaggi. Riprova tra qualche minuto.";
