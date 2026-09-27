// The buttons under an answer: a copy button for each suggestion, the best
// one first and alone, then at most two per row so that the labels fit on a
// phone.
import {
  indexOfStyle,
  type Suggestion,
  type SuggestionKind,
} from "../ai/outputs.ts";
import type { AnswerAction } from "../copilot/buttons.ts";
import type { Situation } from "../followups/situation.ts";
import { encodeButton, type ButtonPress } from "./button-data.ts";
import type { InlineButton, InlineKeyboard } from "./client.ts";

/** Telegram copies at most 256 characters with a copy button. */
export const MAX_COPY_LENGTH = 256;

export const isCopyable = (text: string): boolean =>
  text.length <= MAX_COPY_LENGTH;

/** Groups buttons two by two. */
export const inPairs = <T>(items: readonly T[]): T[][] =>
  items.flatMap((_item, index) =>
    index % 2 === 0 ? [items.slice(index, index + 2)] : [],
  );

const copyButton = (suggestion: Suggestion): InlineButton => ({
  type: "COPY",
  label:
    suggestion.style === "BEST" ? "📋 Copia BEST" : `📋 ${suggestion.style}`,
  text: suggestion.text,
  primary: suggestion.style === "BEST",
});

const callback = (label: string, press: ButtonPress): InlineButton => ({
  type: "CALLBACK",
  label,
  data: encodeButton(press),
});

/** Shows what the bot remembers about the prospect. */
export const analyzeButton = (kind: SuggestionKind): InlineButton =>
  callback("🔍 Analizza", { type: "ANSWER", action: "ANALYZE", kind });

/**
 * The buttons that write suggestions again, under suggestions of `kind`,
 * then 🔍. Under follow-ups there is no other follow-up: the next one needs
 * a screenshot of the chat, which the transition rules count exactly.
 */
export const actionRows = (kind: SuggestionKind): InlineKeyboard => {
  const answer = (label: string, action: AnswerAction): InlineButton =>
    callback(label, { type: "ANSWER", action, kind });
  const more = answer("🔄 Altre 3", "MORE");
  const natural = answer("🙂 Più naturale", "NATURAL");
  const direct = answer("🎯 Più diretto", "DIRECT");
  const followUp = answer("💬 Follow-up", "FOLLOW_UP");
  return kind === "FOLLOW_UPS"
    ? [
        [more, natural],
        [direct, analyzeButton(kind)],
      ]
    : [[more, natural], [direct, followUp], [analyzeButton(kind)]];
};

/**
 * For a prospect the bot remembers, one row per suggestion: its copy
 * button and ✅ to mark it as sent. A suggestion too long to copy keeps
 * only ✅, named after its style.
 */
export const copyAndSentRows = (
  suggestions: readonly Suggestion[],
  kind: SuggestionKind,
): InlineKeyboard =>
  suggestions.flatMap((suggestion) => {
    const index = indexOfStyle(kind, suggestion.style);
    const copy = isCopyable(suggestion.text) ? [copyButton(suggestion)] : [];
    const sent =
      index === null
        ? []
        : [
            callback(
              copy.length === 0
                ? `✅ Inviato ${suggestion.style}`
                : "✅ Inviato",
              { type: "SENT", kind, index },
            ),
          ];
    const row = [...copy, ...sent];
    return row.length === 0 ? [] : [row];
  });

/**
 * The buttons of a prospect's card: write what the situation calls for,
 * or say that Alex already wrote. Nothing for a pause or a client.
 */
export const cardRows = (situation: Situation): InlineKeyboard => {
  const write = (label: string, kind: SuggestionKind): InlineButton =>
    callback(label, { type: "WRITE", kind });
  const done = (label: string, kind: SuggestionKind): InlineButton =>
    callback(label, { type: "SENT", kind, index: null });
  switch (situation.type) {
    case "TO_REPLY":
      return [
        [
          write("↩️ Proponi risposte", "REPLIES"),
          done("✅ Già risposto", "REPLIES"),
        ],
      ];
    case "FOLLOW_UP_DUE":
      return [
        [
          write("💬 Proponi follow-up", "FOLLOW_UPS"),
          done("✅ Già scritto", "FOLLOW_UPS"),
        ],
      ];
    case "WAITING":
      return [[done("✅ Già scritto", "FOLLOW_UPS")]];
    case "TO_CONTACT":
      return [
        [
          write("✍️ Proponi primi messaggi", "FIRST_MESSAGES"),
          done("✅ Già scritto", "FIRST_MESSAGES"),
        ],
      ];
    case "PAUSED":
    case "WON":
      return [];
  }
};

/** Labels longer than this get a row of their own. */
const MAX_PAIRED_LABEL = 18;

const isShort = ({ label }: InlineButton): boolean =>
  Array.from(label).length <= MAX_PAIRED_LABEL;

/**
 * The buttons of a list, each opening the card of its item: two a row, and
 * a row of its own for a long label.
 */
export const openRows = (labels: readonly string[]): InlineKeyboard =>
  labels
    .map((label, index) => callback(label, { type: "OPEN", index }))
    .reduce<readonly (readonly InlineButton[])[]>((rows, button) => {
      const last = rows.at(-1);
      const [alone] = last ?? [];
      return last?.length === 1 &&
        alone !== undefined &&
        isShort(alone) &&
        isShort(button)
        ? [...rows.slice(0, -1), [alone, button]]
        : [...rows, [button]];
    }, []);

/** Copy buttons for the suggestions short enough to be copied. */
export const copyRows = (
  suggestions: readonly Suggestion[],
): InlineKeyboard => {
  const buttons = suggestions
    .filter((suggestion) => isCopyable(suggestion.text))
    .map(copyButton);
  const [first, ...rest] = buttons;
  if (first === undefined) {
    return [];
  }
  return first.type === "COPY" && first.primary
    ? [[first], ...inPairs(rest)]
    : inPairs(buttons);
};
