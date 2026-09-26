import type { AiError } from "../ai/engine.ts";
import type { MemoryOutcome } from "../copilot/memory.ts";
import type {
  ConversationAnalysis,
  ConversationReply,
  ProspectSnapshot,
  ScreenshotsAnalysis,
  Suggestion,
  SuggestionStyle,
} from "../ai/outputs.ts";

/** Makes text safe to embed in a Telegram HTML message. */
export const escapeHtml = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

// Enough to be useful at a glance on a phone.
const MAX_LISTED_ITEMS = 5;

const LABELS: Readonly<Record<SuggestionStyle, string>> = {
  BEST: "🔥 <b>BEST</b>",
  CURIOSITY: "👀 <b>CURIOSITY</b>",
  NATURAL: "🙂 <b>NATURAL</b>",
  ALTERNATIVE: "👀 <b>ALTERNATIVE</b>",
  DIRECT: "🎯 <b>DIRECT</b>",
};

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

const heading = (
  icon: string,
  title: string,
  prospect: ProspectSnapshot,
): string =>
  [
    `${icon} <b>${title}</b>`,
    prospect.username === null ? null : `@${escapeHtml(prospect.username)}`,
    prospect.businessType === null ? null : escapeHtml(prospect.businessType),
  ]
    .filter((part) => part !== null)
    .join(" · ");

const noteLines = (note: string | null): string[] =>
  note === null ? [] : ["", `📝 ${escapeHtml(note)}`];

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

const memoryLines = (memory: MemoryOutcome | null): string[] =>
  memory === null ? [] : [memoryLine(memory)];

const analysisLines = (analysis: ConversationAnalysis): string[] => [
  ...(analysis.lastProspectMessage === null
    ? []
    : [
        `<b>Ultimo messaggio</b>: «${escapeHtml(analysis.lastProspectMessage)}»`,
      ]),
  `<b>Stage</b> ${analysis.stage} · <b>Intent</b> ${analysis.intent} · <b>Interesse</b> ${analysis.interest}`,
  `🎯 <b>Obiettivo</b> ${analysis.nextGoal}: ${escapeHtml(analysis.rationale)}`,
];

// Each suggestion sits in its own block, easy to copy on a phone.
const suggestionsMessage = (
  title: string,
  suggestions: readonly Suggestion[],
): string =>
  suggestions.length === 0
    ? "🚫 Nessun messaggio suggerito."
    : [
        `<b>${title}</b>`,
        ...suggestions.flatMap((suggestion) => [
          "",
          LABELS[suggestion.style],
          `<pre>${escapeHtml(suggestion.text)}</pre>`,
        ]),
      ].join("\n");

/** HTML messages presenting the analysis of screenshots, in sending order. */
export const screenshotsMessages = (
  analysis: ScreenshotsAnalysis,
  memory: MemoryOutcome | null,
): readonly string[] => {
  switch (analysis.kind) {
    case "PROFILE":
      return [
        [
          heading("👤", "Profilo", analysis.prospect),
          ...memoryLines(memory),
          ...section("Cosa ho visto", analysis.facts),
          ...section("Ipotesi da verificare", analysis.hypotheses),
          ...noteLines(analysis.note),
        ].join("\n"),
        suggestionsMessage("Primi messaggi", analysis.suggestions),
      ];
    case "CONVERSATION":
      return [
        [
          heading("💬", "Conversazione", analysis.prospect),
          ...memoryLines(memory),
          ...analysisLines(analysis.analysis),
          ...section("Cosa ho visto", analysis.facts),
          ...section("Ipotesi da verificare", analysis.hypotheses),
          ...noteLines(analysis.note),
        ].join("\n"),
        suggestionsMessage("Risposte", analysis.suggestions),
      ];
    case "UNRELATED":
      return [
        [
          "🤔 Non sembra un profilo o una conversazione di Instagram.",
          ...noteLines(analysis.note),
        ].join("\n"),
      ];
  }
};

/** HTML messages presenting the reply to a pasted conversation. */
export const conversationMessages = (
  reply: ConversationReply,
): readonly string[] => [
  [
    "💬 <b>Conversazione</b>",
    ...analysisLines(reply.analysis),
    ...section("Cosa ho visto", reply.facts),
    ...section("Ipotesi da verificare", reply.hypotheses),
    ...noteLines(reply.note),
  ].join("\n"),
  suggestionsMessage("Risposte", reply.suggestions),
];

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
