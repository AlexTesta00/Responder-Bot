// What the bot remembers about a prospect, shown by the 🔍 button: built
// from the memory, without the AI and at no cost.
import type { StageChange } from "../conversations/domain.ts";
import type { Pause } from "../conversations/transition.ts";
import { contactOfMemory } from "../followups/contact.ts";
import type { ProspectMemory } from "../prospects/memory.ts";
import { fitsInMessage } from "./message-length.ts";
import {
  commitmentLine,
  escapeHtml,
  pauseMessage,
  section,
} from "./suggestions.ts";

// The latest changes are enough to see where the conversation is going.
const MAX_HISTORY = 5;

const DAY_MONTH = new Intl.DateTimeFormat("it-IT", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "Europe/Rome",
});

const FULL_DATE = new Intl.DateTimeFormat("it-IT", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Europe/Rome",
});

/** What a long card leaves out first, to fit in one message. */
const LEFT_OUT_FIRST = ["HISTORY", "HYPOTHESES", "FACTS", "SUMMARY"] as const;

type Optional = (typeof LEFT_OUT_FIRST)[number];

const counts = (memory: ProspectMemory): string => {
  const { prospect, messages } = memory;
  // With the messages Alex marked as sent.
  const { unanswered } = contactOfMemory(memory);
  return [
    messages.length === 1
      ? "💬 1 messaggio in memoria"
      : `💬 ${String(messages.length)} messaggi in memoria`,
    ...(unanswered === 0
      ? []
      : [
          unanswered === 1
            ? "1 tuo senza risposta"
            : `${String(unanswered)} tuoi senza risposta`,
        ]),
    `aggiornato il ${FULL_DATE.format(prospect.updatedAt)}`,
  ].join(" · ");
};

const historyLines = (history: readonly StageChange[]): string[] =>
  history.length === 0
    ? []
    : [
        "",
        "<b>Storia</b>",
        ...history
          .slice(-MAX_HISTORY)
          .map(
            (change) =>
              `• ${DAY_MONTH.format(change.at)} ${change.from ?? "inizio"} → ${change.to}`,
          ),
      ];

const compose = (
  memory: ProspectMemory,
  history: readonly StageChange[],
  pause: Pause | null,
  leftOut: ReadonlySet<Optional>,
): string => {
  const { prospect } = memory;
  const kept = (part: Optional): boolean => !leftOut.has(part);
  const reading = prospect.conversation;
  return [
    [
      `🔍 <b>@${escapeHtml(prospect.username)}</b>`,
      ...(prospect.businessType === null
        ? []
        : [escapeHtml(prospect.businessType)]),
    ].join(" · "),
    ...(reading === null
      ? ["👤 Solo profilo: nessuna conversazione in memoria."]
      : [
          `<b>Stage</b> ${reading.stage} · <b>Intent</b> ${reading.intent} · <b>Interesse</b> ${reading.interest}`,
          `🎯 <b>Obiettivo</b> ${reading.nextGoal}`,
        ]),
    ...(pause === null ? [] : [pauseMessage(pause)]),
    counts(memory),
    ...(kept("SUMMARY") && prospect.summary !== null
      ? ["", "<b>Riassunto</b>", escapeHtml(prospect.summary)]
      : []),
    ...section("Obiezioni aperte", prospect.objections),
    ...section("Promesse", prospect.commitments.map(commitmentLine)),
    ...(kept("FACTS") ? section("Cosa so", prospect.facts) : []),
    ...(kept("HYPOTHESES")
      ? section("Ipotesi da verificare", prospect.hypotheses)
      : []),
    ...(kept("HISTORY") ? historyLines(history) : []),
  ].join("\n");
};

/** The card of a prospect, as full as one Telegram message allows. */
export const prospectCard = (
  memory: ProspectMemory,
  history: readonly StageChange[],
  pause: Pause | null,
): string => {
  const versions = LEFT_OUT_FIRST.map((_part, index) =>
    compose(memory, history, pause, new Set(LEFT_OUT_FIRST.slice(0, index))),
  );
  return (
    versions.find(fitsInMessage) ??
    compose(memory, history, pause, new Set(LEFT_OUT_FIRST))
  );
};
