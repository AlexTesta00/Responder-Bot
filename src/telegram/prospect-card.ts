// What the bot remembers about a prospect, with what Alex should do next:
// shown by 🔍, /prospect and the lists. Built from the memory, without the
// AI and at no cost.
import type { StageChange } from "../conversations/domain.ts";
import { MAX_FOLLOW_UPS } from "../conversations/transition.ts";
import { contactOfMemory, type Contact } from "../followups/contact.ts";
import { situationOfMemory, type Situation } from "../followups/situation.ts";
import type { ProspectMemory } from "../prospects/memory.ts";
import { fromDay, fullDate, relativeDay } from "../shared/time.ts";
import { cardRows } from "./keyboard.ts";
import { fitsInMessage } from "./message-length.ts";
import {
  commitmentLine,
  escapeHtml,
  pauseMessage,
  section,
  type Presented,
} from "./suggestions.ts";

// The latest changes are enough to see where the conversation is going.
const MAX_HISTORY = 5;

const DAY_MONTH = new Intl.DateTimeFormat("it-IT", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "Europe/Rome",
});

/** What a long card leaves out first, to fit in one message. */
const LEFT_OUT_FIRST = ["HISTORY", "HYPOTHESES", "FACTS", "SUMMARY"] as const;

type Optional = (typeof LEFT_OUT_FIRST)[number];

/**
 * The prospect's @username, linking to the Instagram profile: tapping it
 * opens Instagram, and it never mentions a Telegram account.
 */
export const profileLink = (username: string): string =>
  `<a href="https://www.instagram.com/${escapeHtml(username)}/">@${escapeHtml(username)}</a>`;

const ordinal = (number: 1 | 2): string =>
  number === 1 ? "il 1° di 2" : "il 2° e ultimo di 2";

/** What Alex should do next, in place of the pause alone. */
const situationLine = (
  situation: Situation,
  contact: Contact,
  now: Date,
): string => {
  switch (situation.type) {
    case "PAUSED":
      return pauseMessage(situation.pause);
    case "TO_REPLY":
      return "🔥 Tocca a te: aspetta una tua risposta.";
    case "TO_CONTACT":
      return "👤 Da contattare: quando scrivi, tocca ✅ Inviato sotto i primi messaggi, o ✅ Già scritto qui.";
    case "WON":
      return "🏆 Cliente acquisito: nessun follow-up.";
    case "FOLLOW_UP_DUE":
      return `⏰ Follow-up da fare: ${ordinal(situation.number)} (il tuo ultimo messaggio: ${relativeDay(situation.lastOutboundAt, now)}).`;
    case "WAITING":
      return `⏳ Aspetti la sua risposta · follow-up inviati: ${String(contact.followUpsSent)} di ${String(MAX_FOLLOW_UPS)} · il prossimo ${fromDay(situation.dueDay, now)}`;
  }
};

const lastContactLine = (contact: Contact, now: Date): string =>
  contact.lastContact === null
    ? "🕐 Nessun contatto registrato."
    : `🕐 <b>Ultimo contatto</b> ${relativeDay(contact.lastContact.at, now)} · ${
        contact.lastContact.by === "PROSPECT"
          ? "messaggio suo"
          : "messaggio tuo"
      }`;

const counts = (memory: ProspectMemory, contact: Contact): string => {
  const { prospect, messages } = memory;
  const { unanswered } = contact;
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
    `aggiornato il ${fullDate(prospect.updatedAt)}`,
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
  now: Date,
  leftOut: ReadonlySet<Optional>,
): string => {
  const { prospect } = memory;
  const contact = contactOfMemory(memory);
  const kept = (part: Optional): boolean => !leftOut.has(part);
  const reading = prospect.conversation;
  return [
    [
      `🔍 <b>${profileLink(prospect.username)}</b>`,
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
    lastContactLine(contact, now),
    situationLine(situationOfMemory(memory, now), contact, now),
    counts(memory, contact),
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

/**
 * The card of a prospect, as full as one Telegram message allows, with
 * the buttons its situation calls for.
 */
export const prospectCard = (
  memory: ProspectMemory,
  history: readonly StageChange[],
  now: Date,
): Presented => {
  const versions = LEFT_OUT_FIRST.map((_part, index) =>
    compose(memory, history, now, new Set(LEFT_OUT_FIRST.slice(0, index))),
  );
  const rows = cardRows(situationOfMemory(memory, now));
  return {
    html:
      versions.find(fitsInMessage) ??
      compose(memory, history, now, new Set(LEFT_OUT_FIRST)),
    keyboard: rows.length === 0 ? null : rows,
  };
};
