// The lists of the outreach, starting from /oggi: whom to answer and whom to
// follow up. Each prospect gets a button that opens the card; the button
// holds only its position, and the bot remembers which prospect it opens.
import type { ConversationIntent } from "../conversations/domain.ts";
import { firstOf, type Agenda, type AgendaEntry } from "../followups/agenda.ts";
import type { Prospect } from "../prospects/memory.ts";
import { longDay, relativeDay } from "../shared/time.ts";
import { openRows } from "./keyboard.ts";
import { fitsInMessage } from "./message-length.ts";
import { profileLink } from "./prospect-card.ts";
import { escapeHtml, type Presented } from "./suggestions.ts";

/** A list, with the id of the prospect each of its buttons opens, in order. */
export type PresentedList = Presented & Readonly<{ items: readonly string[] }>;

/** Prospects shown in each section of /oggi; the others are a command away. */
export const TODAY_LIMIT = 5;

const PROMISE_LENGTH = 80;

/** What the prospect's latest message asks for, when it says something. */
const REPLY_PHRASES: Readonly<Record<ConversationIntent, string | null>> = {
  CURIOUS: null,
  INTERESTED: null,
  NEUTRAL: null,
  POSITIVE: null,
  SKEPTICAL: "ha dei dubbi",
  CONFUSED: "non ha capito bene",
  BUSY: "ora ha poco tempo",
  PRICE_REQUEST: "ha chiesto il prezzo",
  PRICE_OBJECTION: "trova alto il prezzo",
  ALREADY_HAS_PROVIDER: "ha già un fornitore",
  ASKING_FOR_MORE_INFO: "vuole più informazioni",
  READY_FOR_CALL: "vuole sentirti in call",
  NOT_INTERESTED: "non vuole andare avanti: chiudi con un saluto",
  DO_NOT_CONTACT: null,
  UNKNOWN: null,
};

const NO_PROSPECTS =
  "Non ho ancora nessun prospect in memoria. Mandami 1-3 screenshot del profilo di un'attività: ti propongo i primi messaggi e lo salvo.";

const ALL_DONE =
  "✅ Tutto in pari: nessuno aspetta una tua risposta e nessun follow-up è in scadenza.";

const TAP_HINT =
  "Tocca un bottone qui sotto per aprire la scheda, o il nome per aprire Instagram.";

// Cut by code points: halving an emoji would leave text Telegram refuses.
const cut = (text: string, length: number): string => {
  const characters = Array.from(text);
  return characters.length <= length
    ? text
    : `${characters.slice(0, length).join("").trimEnd()}…`;
};

/** The prospect's @username, opening Instagram, and what they do. */
const nameLine = ({ username, businessType }: Prospect): string =>
  businessType === null
    ? profileLink(username)
    : `${profileLink(username)} · ${escapeHtml(businessType)}`;

/** Alex's first open promise, and how many more there are. */
const promiseLines = ({ commitments }: Prospect): readonly string[] => {
  const [first, ...others] = commitments.filter(({ by }) => by === "ALEX");
  if (first === undefined) {
    return [];
  }
  const more = others.length === 0 ? "" : ` (+${String(others.length)})`;
  return [
    `🤝 Hai promesso: ${escapeHtml(cut(first.text, PROMISE_LENGTH))}${more}`,
  ];
};

export const followUpNumber = (number: 1 | 2): string =>
  number === 1 ? "1° follow-up" : "2° e ultimo follow-up";

const replyEntry = (
  { prospect, situation }: AgendaEntry<"TO_REPLY">,
  now: Date,
): readonly string[] => {
  const day = relativeDay(situation.since, now);
  const phrase =
    prospect.conversation === null
      ? null
      : REPLY_PHRASES[prospect.conversation.intent];
  return [
    nameLine(prospect),
    phrase === null ? `ha risposto ${day}` : `${phrase} · ${day}`,
  ];
};

const followUpEntry = (
  { prospect, situation }: AgendaEntry<"FOLLOW_UP_DUE">,
  now: Date,
): readonly string[] => [
  nameLine(prospect),
  `ultimo contatto: ${relativeDay(situation.lastOutboundAt, now)} · ${followUpNumber(situation.number)}`,
];

/** "…e altri 3: /lista", for the entries a list leaves out. */
const leftOut = (more: number, command: string): readonly string[] =>
  more === 0
    ? []
    : [
        "",
        `…e ${more === 1 ? "un altro" : `altri ${String(more)}`}: ${command}`,
      ];

/** A titled section, one entry after the other, or nothing when empty. */
const section = (
  title: string,
  total: number,
  entries: readonly (readonly string[])[],
  more: readonly string[],
): readonly string[] =>
  total === 0
    ? []
    : [
        "",
        `${title} (${String(total)})`,
        ...entries.flatMap((lines) => ["", ...lines]),
        ...more,
      ];

type ListButton = Readonly<{ label: string; prospectId: string }>;

const button =
  (icon: string) =>
  ({ prospect }: AgendaEntry): ListButton => ({
    label: `${icon} @${prospect.username}`,
    prospectId: prospect.id,
  });

/** The buttons of a list, and the prospects they open, by position. */
const withButtons = (
  html: string,
  buttons: readonly ListButton[],
): PresentedList => ({
  html,
  keyboard:
    buttons.length === 0 ? null : openRows(buttons.map(({ label }) => label)),
  items: buttons.map(({ prospectId }) => prospectId),
});

/**
 * /oggi: the prospects to answer and to follow up, a few each, with the
 * awaited and the new ones counted. Alex's promises are left out first when
 * the list would not fit in a message.
 */
export const todayList = (agenda: Agenda, now: Date): PresentedList => {
  const title = `📋 <b>OGGI</b> · ${longDay(now)}`;
  const known = Object.values(agenda).some((entries) => entries.length > 0);
  if (!known) {
    return withButtons([title, "", NO_PROSPECTS].join("\n"), []);
  }

  const replies = firstOf(agenda.reply, TODAY_LIMIT);
  const followUps = firstOf(agenda.followUp, TODAY_LIMIT);
  const buttons = [
    ...replies.shown.map(button("🔥")),
    ...followUps.shown.map(button("⏰")),
  ];
  const counts = [
    ...(agenda.waiting.length === 0
      ? []
      : [
          `⏳ ${String(agenda.waiting.length)} in attesa di risposta: /followup`,
        ]),
    ...(agenda.toContact.length === 0
      ? []
      : [`👤 ${String(agenda.toContact.length)} da contattare: /nuovo`]),
  ];
  const html = (promises: boolean): string =>
    [
      title,
      ...(buttons.length === 0
        ? ["", ALL_DONE]
        : [
            ...section(
              "🔥 <b>DA RISPONDERE</b>",
              agenda.reply.length,
              replies.shown.map((entry) => [
                ...replyEntry(entry, now),
                ...(promises ? promiseLines(entry.prospect) : []),
              ]),
              leftOut(replies.more, "/lista"),
            ),
            ...section(
              "⏰ <b>FOLLOW-UP</b>",
              agenda.followUp.length,
              followUps.shown.map((entry) => [
                ...followUpEntry(entry, now),
                ...(promises ? promiseLines(entry.prospect) : []),
              ]),
              leftOut(followUps.more, "/followup"),
            ),
          ]),
      ...(counts.length === 0 ? [] : ["", ...counts]),
      ...(buttons.length === 0 ? [] : ["", TAP_HINT]),
    ].join("\n");
  const full = html(true);
  return withButtons(fitsInMessage(full) ? full : html(false), buttons);
};
