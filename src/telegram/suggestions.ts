import type { AiError } from "../ai/engine.ts";
import type {
  ConversationAnalysis,
  ConversationReply,
  ProspectSnapshot,
  ScreenshotsAnalysis,
  Suggestion,
  SuggestionStyle,
} from "../ai/outputs.ts";
import type { MemoryOutcome } from "../copilot/memory.ts";
import type { Commitment } from "../conversations/domain.ts";
import { MAX_FOLLOW_UPS, type Pause } from "../conversations/transition.ts";
import type { InlineKeyboard } from "./client.ts";
import { copyRows, isCopyable } from "./keyboard.ts";
import { fitsInMessage } from "./message-length.ts";

/** Makes text safe to embed in a Telegram HTML message. */
export const escapeHtml = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** A message ready to send: Telegram HTML and the buttons under it. */
export type Presented = Readonly<{
  html: string;
  keyboard: InlineKeyboard | null;
}>;

/** Plain text, escaped, without buttons. */
export const plainMessage = (text: string): Presented => ({
  html: escapeHtml(text),
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

const section = (title: string, items: readonly string[]): string[] =>
  items.length === 0
    ? []
    : [
        "",
        `<b>${title}</b>`,
        ...items
          .slice(0, MAX_LISTED_ITEMS)
          .map((item) => `• ${escapeHtml(item)}`),
      ];

const quoted = (text: string): string =>
  text.length <= MAX_QUOTED_LENGTH
    ? text
    : `${text.slice(0, MAX_QUOTED_LENGTH).trimEnd()}…`;

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

const commitmentLine = (commitment: Commitment): string =>
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

type Answer = Readonly<{
  heading: string;
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
}>;

const answerOf = (
  heading: string,
  memory: MemoryOutcome | null,
  pause: Pause | null,
  details: Omit<Answer, "heading" | "warning" | "memoryNote" | "pause">,
): Answer => ({
  heading,
  warning: memory?.type === "NOT_SAVED" ? memoryLine(memory) : null,
  memoryNote:
    memory === null || memory.type === "NOT_SAVED" ? null : memoryLine(memory),
  pause,
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

  return [...top, ...middle, ...expandable].join("\n");
};

/** The fullest version of the answer that fits in one Telegram message. */
const fitted = (answer: Answer): string => {
  const versions = LEFT_OUT_FIRST.map((_part, index) =>
    compose(answer, new Set(LEFT_OUT_FIRST.slice(0, index))),
  );
  const shortest = compose(answer, new Set(LEFT_OUT_FIRST));
  return versions.find(fitsInMessage) ?? shortest;
};

const presented = (answer: Answer): Presented => {
  const rows = answer.pause === null ? copyRows(answer.suggestions) : [];
  return {
    html: fitted(answer),
    keyboard: rows.length === 0 ? null : rows,
  };
};

const profileHeading = (
  icon: string,
  fallback: string,
  prospect: ProspectSnapshot,
) => heading(icon, fallback, prospect.username, prospect.businessType);

/** The message presenting the analysis of screenshots. */
export const screenshotsAnswer = (
  analysis: ScreenshotsAnalysis,
  memory: MemoryOutcome | null,
  pause: Pause | null,
): Presented => {
  switch (analysis.kind) {
    case "PROFILE":
      return presented(
        answerOf(
          profileHeading("👤", "Profilo", analysis.prospect),
          memory,
          pause,
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
          memory,
          pause,
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
  memory: MemoryOutcome | null,
  pause: Pause | null,
): Presented =>
  presented(
    answerOf(heading("💬", "Conversazione", username, null), memory, pause, {
      lastProspectMessage: reply.analysis.lastProspectMessage,
      suggestions: reply.suggestions,
      analysis: reply.analysis,
      objections: reply.objections,
      commitments: reply.commitments,
      facts: reply.facts,
      hypotheses: reply.hypotheses,
      note: reply.note,
    }),
  );

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
