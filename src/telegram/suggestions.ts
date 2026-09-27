import type { AiError, SuggestionAction } from "../ai/engine.ts";
import type {
  ConversationAnalysis,
  ConversationReply,
  NewSuggestions,
  ProspectSnapshot,
  ScreenshotsAnalysis,
  Suggestion,
  SuggestionKind,
  SuggestionStyle,
} from "../ai/outputs.ts";
import type { MemoryOutcome } from "../copilot/memory.ts";
import type { Commitment } from "../conversations/domain.ts";
import { MAX_FOLLOW_UPS, type Pause } from "../conversations/transition.ts";
import type { InlineKeyboard } from "./client.ts";
import {
  actionRows,
  analyzeButton,
  copyAndSentRows,
  copyRows,
  isCopyable,
} from "./keyboard.ts";
import { fitsInMessage } from "./message-length.ts";

/** Makes text safe to embed in a Telegram HTML message. */
export const escapeHtml = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** A message ready to send: Telegram HTML and the buttons under it. */
export type Presented = Readonly<{
  html: string;
  keyboard: InlineKeyboard | null;
}>;

/** A last line in HTML, such as what the answer cost. */
export type Footer = string | null;

const footerLines = (footer: Footer): string[] =>
  footer === null ? [] : ["", footer];

/** Plain text, escaped, without buttons. */
export const plainMessage = (
  text: string,
  footer: Footer = null,
): Presented => ({
  html: [escapeHtml(text), ...footerLines(footer)].join("\n"),
  keyboard: null,
});

// Enough to be useful at a glance on a phone.
const MAX_LISTED_ITEMS = 5;

// Enough to recognize the message the replies answer.
const MAX_QUOTED_LENGTH = 120;

const LABELS: Readonly<Record<SuggestionStyle, string>> = {
  BEST: "🔥 <b>BEST</b>",
  CURIOSITY: "👀 <b>CURIOSITY</b>",
  NATURAL: "🙂 <b>NATURAL</b>",
  ALTERNATIVE: "👀 <b>ALTERNATIVE</b>",
  DIRECT: "🎯 <b>DIRECT</b>",
};

const TOO_LONG_TO_COPY =
  "✂️ Troppo lungo per il tasto Copia: tieni premuto il testo qui sopra per copiarlo.";

const NOTHING_SUGGESTED = "🚫 Nessun messaggio suggerito.";

export const section = (title: string, items: readonly string[]): string[] =>
  items.length === 0
    ? []
    : [
        "",
        `<b>${title}</b>`,
        ...items
          .slice(0, MAX_LISTED_ITEMS)
          .map((item) => `• ${escapeHtml(item)}`),
      ];

// Cut by code points: halving an emoji would leave text Telegram refuses.
const quoted = (text: string): string => {
  const characters = Array.from(text);
  return characters.length <= MAX_QUOTED_LENGTH
    ? text
    : `${characters.slice(0, MAX_QUOTED_LENGTH).join("").trimEnd()}…`;
};

/** Tells Alex whether the prospect's history was used and kept. */
export const memoryLine = (memory: MemoryOutcome): string => {
  switch (memory.type) {
    case "CREATED":
      return "🧠 Nuovo prospect: l'ho salvato in memoria.";
    case "UPDATED": {
      const { knownMessages } = memory;
      if (knownMessages === 0) {
        return "🧠 Già in memoria: ho tenuto conto dell'analisi precedente.";
      }
      const messages =
        knownMessages === 1
          ? "1 messaggio precedente"
          : `${String(knownMessages)} messaggi precedenti`;
      return `🧠 Già in memoria: ho tenuto conto di ${messages}.`;
    }
    case "NOT_SAVED":
      switch (memory.reason) {
        case "NO_PROSPECT":
          return "💡 Non so di quale prospect si tratta, quindi non l'ho salvata: rispondi a un mio messaggio su quel prospect, o scrivi @username nella prima riga.";
        case "NO_USERNAME":
          return "⚠️ Non vedo lo username: questa analisi non è in memoria. La prossima volta includi uno screenshot in cui si legge.";
        case "OTHER_PERSON":
          return "⚠️ Non sono sicuro di chi sia: non ho aggiornato la memoria.";
        case "UNAVAILABLE":
          return "⚠️ Memoria non disponibile: analisi fatta senza lo storico e non salvata.";
      }
  }
};

/** Why the bot suggests nothing now, in place of the suggestions. */
export const pauseMessage = (pause: Pause): string => {
  switch (pause) {
    case "DO_NOT_CONTACT":
      return "🔒 Ha chiesto di non ricevere altri messaggi: niente suggerimenti finché non ti riscrive.";
    case "CLOSED":
      return "👋 Non c'è interesse e il saluto finale è già partito: niente suggerimenti finché non ti riscrive.";
    case "FOLLOW_UP_LIMIT":
      return `🤐 Hai già mandato ${String(MAX_FOLLOW_UPS)} follow-up senza risposta: meglio aspettare che risponda.`;
  }
};

export const commitmentLine = (commitment: Commitment): string =>
  `${commitment.by === "ALEX" ? "Tu" : "Prospect"}: ${commitment.text}`;

/** The first line, which also shows in the notification. */
const heading = (
  icon: string,
  fallback: string,
  username: string | null,
  businessType: string | null,
): string =>
  [
    `${icon} <b>${username === null ? fallback : `@${escapeHtml(username)}`}</b>`,
    businessType === null ? null : escapeHtml(businessType),
  ]
    .filter((part) => part !== null)
    .join(" · ");

/** Each suggestion in its own block; <pre> is kept for suggestions only. */
const suggestionLines = (suggestion: Suggestion): string[] => [
  "",
  LABELS[suggestion.style],
  `<pre>${escapeHtml(suggestion.text)}</pre>`,
  ...(isCopyable(suggestion.text) ? [] : [TOO_LONG_TO_COPY]),
];

/** What a long answer leaves out first, to fit in one message. */
const LEFT_OUT_FIRST = [
  "HYPOTHESES",
  "FACTS",
  "COMMITMENTS",
  "OBJECTIONS",
  "NOTE",
  "RATIONALE",
] as const;

type Optional = (typeof LEFT_OUT_FIRST)[number];

/** What frames an answer, beyond what the model wrote. */
export type AnswerContext = Readonly<{
  memory: MemoryOutcome | null;
  /** Why no message should be suggested now. */
  pause: Pause | null;
  /** Whether the answer is about a prospect the bot remembers: buttons need one. */
  linked: boolean;
  footer: Footer;
}>;

type Answer = Readonly<{
  heading: string;
  kind: SuggestionKind;
  linked: boolean;
  /** Memory that could not be used or kept: Alex must see it. */
  warning: string | null;
  lastProspectMessage: string | null;
  suggestions: readonly Suggestion[];
  pause: Pause | null;
  analysis: ConversationAnalysis | null;
  /** The prospect was new, or already known. */
  memoryNote: string | null;
  objections: readonly string[];
  commitments: readonly Commitment[];
  facts: readonly string[];
  hypotheses: readonly string[];
  note: string | null;
  footer: Footer;
}>;

const answerOf = (
  heading: string,
  kind: SuggestionKind,
  { memory, pause, linked, footer }: AnswerContext,
  details: Omit<
    Answer,
    | "heading"
    | "kind"
    | "linked"
    | "warning"
    | "memoryNote"
    | "pause"
    | "footer"
  >,
): Answer => ({
  heading,
  kind,
  linked,
  warning: memory?.type === "NOT_SAVED" ? memoryLine(memory) : null,
  memoryNote:
    memory === null || memory.type === "NOT_SAVED" ? null : memoryLine(memory),
  pause,
  footer,
  ...details,
});

/**
 * The answer as one message: the heading, the suggestions or why there are
 * none, then the analysis in a block Alex can expand, less `leftOut`.
 */
const compose = (answer: Answer, leftOut: ReadonlySet<Optional>): string => {
  const nothingSuggested =
    answer.pause === null && answer.suggestions.length === 0;
  const kept = (part: Optional): boolean => !leftOut.has(part);
  const note =
    answer.note === null ? [] : ["", `📝 ${escapeHtml(answer.note)}`];

  const top = [
    answer.heading,
    ...(answer.warning === null ? [] : [answer.warning]),
    ...(answer.lastProspectMessage === null
      ? []
      : [`↩️ «${escapeHtml(quoted(answer.lastProspectMessage))}»`]),
  ];
  const middle =
    answer.pause !== null
      ? ["", pauseMessage(answer.pause)]
      : nothingSuggested
        ? ["", NOTHING_SUGGESTED, ...note]
        : answer.suggestions.flatMap(suggestionLines);

  const { analysis } = answer;
  const details = [
    ...(analysis === null
      ? []
      : [
          `<b>Stage</b> ${analysis.stage} · <b>Intent</b> ${analysis.intent} · <b>Interesse</b> ${analysis.interest}`,
          `🎯 <b>Obiettivo</b> ${analysis.nextGoal}` +
            (kept("RATIONALE") ? `: ${escapeHtml(analysis.rationale)}` : ""),
        ]),
    ...(answer.memoryNote === null ? [] : [answer.memoryNote]),
    ...(kept("OBJECTIONS")
      ? section("Obiezioni aperte", answer.objections)
      : []),
    ...(kept("COMMITMENTS")
      ? section("Promesse", answer.commitments.map(commitmentLine))
      : []),
    ...(kept("FACTS") ? section("Cosa ho visto", answer.facts) : []),
    ...(kept("HYPOTHESES")
      ? section("Ipotesi da verificare", answer.hypotheses)
      : []),
    ...(!nothingSuggested && kept("NOTE") ? note : []),
  ];
  const expandable =
    details.length === 0
      ? []
      : [
          "",
          `<blockquote expandable>🔍 <b>Analisi</b>\n${details.join("\n")}</blockquote>`,
        ];

  return [...top, ...middle, ...expandable, ...footerLines(answer.footer)].join(
    "\n",
  );
};

/** The fullest version of the answer that fits in one Telegram message. */
const fitted = (answer: Answer): string => {
  const versions = LEFT_OUT_FIRST.map((_part, index) =>
    compose(answer, new Set(LEFT_OUT_FIRST.slice(0, index))),
  );
  const shortest = compose(answer, new Set(LEFT_OUT_FIRST));
  return versions.find(fitsInMessage) ?? shortest;
};

/**
 * Copy buttons for the suggestions and, for a prospect the bot remembers,
 * the buttons that write them again and 🔍. Without suggestions, only 🔍.
 */
const suggestionRows = (
  suggestions: readonly Suggestion[],
  kind: SuggestionKind,
  linked: boolean,
): InlineKeyboard => {
  if (suggestions.length === 0) {
    return linked ? [[analyzeButton(kind)]] : [];
  }
  return linked
    ? [...copyAndSentRows(suggestions, kind), ...actionRows(kind)]
    : copyRows(suggestions);
};

const withRows = (html: string, rows: InlineKeyboard): Presented => ({
  html,
  keyboard: rows.length === 0 ? null : rows,
});

const presented = (answer: Answer): Presented =>
  withRows(
    fitted(answer),
    suggestionRows(
      answer.pause === null ? answer.suggestions : [],
      answer.kind,
      answer.linked,
    ),
  );

/** Why Alex should not write now, with 🔍 when the prospect is known. */
export const pauseAnswer = (pause: Pause, kind: SuggestionKind): Presented =>
  withRows(pauseMessage(pause), [[analyzeButton(kind)]]);

const profileHeading = (
  icon: string,
  fallback: string,
  prospect: ProspectSnapshot,
) => heading(icon, fallback, prospect.username, prospect.businessType);

/** The message presenting the analysis of screenshots. */
export const screenshotsAnswer = (
  analysis: ScreenshotsAnalysis,
  context: AnswerContext,
): Presented => {
  switch (analysis.kind) {
    case "PROFILE":
      return presented(
        answerOf(
          profileHeading("👤", "Profilo", analysis.prospect),
          "FIRST_MESSAGES",
          context,
          {
            lastProspectMessage: null,
            suggestions: analysis.suggestions,
            analysis: null,
            objections: [],
            commitments: [],
            facts: analysis.facts,
            hypotheses: analysis.hypotheses,
            note: analysis.note,
          },
        ),
      );
    case "CONVERSATION":
      return presented(
        answerOf(
          profileHeading("💬", "Conversazione", analysis.prospect),
          "REPLIES",
          context,
          {
            lastProspectMessage: analysis.analysis.lastProspectMessage,
            suggestions: analysis.suggestions,
            analysis: analysis.analysis,
            objections: analysis.objections,
            commitments: analysis.commitments,
            facts: analysis.facts,
            hypotheses: analysis.hypotheses,
            note: analysis.note,
          },
        ),
      );
    case "UNRELATED":
      return {
        html: [
          "🤔 Non sembra un profilo o una conversazione di Instagram.",
          ...(analysis.note === null
            ? []
            : ["", `📝 ${escapeHtml(analysis.note)}`]),
          ...footerLines(context.footer),
        ].join("\n"),
        keyboard: null,
      };
  }
};

/** The message presenting the reply to a pasted conversation. */
export const conversationAnswer = (
  reply: ConversationReply,
  /** The prospect Alex named, when known. */
  username: string | null,
  context: AnswerContext,
): Presented =>
  presented(
    answerOf(
      heading("💬", "Conversazione", username, null),
      "REPLIES",
      context,
      {
        lastProspectMessage: reply.analysis.lastProspectMessage,
        suggestions: reply.suggestions,
        analysis: reply.analysis,
        objections: reply.objections,
        commitments: reply.commitments,
        facts: reply.facts,
        hypotheses: reply.hypotheses,
        note: reply.note,
      },
    ),
  );

/** How the new suggestions of a button came about. */
export type NewSuggestionsView = Readonly<{
  action: SuggestionAction;
  /** The kind of the new suggestions. */
  kind: SuggestionKind;
  username: string;
  /** First messages were asked, and replies written instead. */
  upgraded: boolean;
  /** The suggestions to rewrite could not be read back. */
  previousLost: boolean;
  /** 💬 has just marked the message Alex tapped as sent. */
  declared: boolean;
}>;

const ACTION_ICONS: Readonly<Record<SuggestionAction, string>> = {
  MORE: "🔄",
  NATURAL: "🙂",
  DIRECT: "🎯",
  FOLLOW_UP: "💬",
  NEXT_FOLLOW_UP: "💬",
};

const RESULT_TITLES: Readonly<
  Record<SuggestionAction, Readonly<Record<SuggestionKind, string>>>
> = {
  MORE: {
    FIRST_MESSAGES: "altri 3 primi messaggi",
    REPLIES: "altre 3 risposte",
    FOLLOW_UPS: "altri 3 follow-up",
  },
  NATURAL: {
    FIRST_MESSAGES: "primi messaggi più naturali",
    REPLIES: "risposte più naturali",
    FOLLOW_UPS: "follow-up più naturali",
  },
  DIRECT: {
    FIRST_MESSAGES: "primi messaggi più diretti",
    REPLIES: "risposte più dirette",
    FOLLOW_UPS: "follow-up più diretti",
  },
  FOLLOW_UP: {
    FIRST_MESSAGES: "follow-up",
    REPLIES: "follow-up",
    FOLLOW_UPS: "follow-up",
  },
  NEXT_FOLLOW_UP: {
    FIRST_MESSAGES: "follow-up",
    REPLIES: "follow-up",
    FOLLOW_UPS: "follow-up",
  },
};

const DECLARED = "✅ Ho segnato come inviato il messaggio di prima.";

const UPGRADED =
  "ℹ️ La conversazione è già iniziata: ti propongo risposte invece di primi messaggi.";

const PREVIOUS_LOST =
  "ℹ️ Non riesco più a leggere i messaggi di prima: li ho scritti partendo da ciò che ricordo.";

/** The new suggestions a button asked for, with the same buttons. */
export const newSuggestionsAnswer = (
  { suggestions, note }: NewSuggestions,
  view: NewSuggestionsView,
  footer: Footer,
): Presented => {
  const nothingSuggested = suggestions.length === 0;
  const compose = (withNote: boolean): string =>
    [
      `${ACTION_ICONS[view.action]} <b>@${escapeHtml(view.username)}</b> · ${RESULT_TITLES[view.action][view.kind]}`,
      ...(view.declared ? [DECLARED] : []),
      ...(view.upgraded ? [UPGRADED] : []),
      ...(view.previousLost ? [PREVIOUS_LOST] : []),
      ...(nothingSuggested
        ? ["", NOTHING_SUGGESTED]
        : suggestions.flatMap(suggestionLines)),
      ...((withNote || nothingSuggested) && note !== null
        ? ["", `📝 ${escapeHtml(note)}`]
        : []),
      ...footerLines(footer),
    ].join("\n");
  const full = compose(true);
  return withRows(
    fitsInMessage(full) ? full : compose(false),
    suggestionRows(suggestions, view.kind, true),
  );
};

/** Plain-text explanation of a generation that failed. */
export const aiProblemReply = (error: AiError): string => {
  switch (error.type) {
    case "REFUSED":
      return "⚠️ L'AI ha rifiutato di analizzare questo contenuto.";
    case "TRUNCATED":
    case "INVALID_OUTPUT":
      return "⚠️ L'analisi non è riuscita. Riprova tra poco.";
    case "UNAVAILABLE":
      return "⚠️ Il servizio AI non è raggiungibile in questo momento. Riprova tra qualche minuto.";
    case "REJECTED":
      return "⚠️ Il servizio AI ha rifiutato la richiesta: controlla API key e credito su console.anthropic.com.";
  }
};
