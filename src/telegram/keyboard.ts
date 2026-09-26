// The buttons under an answer: a copy button for each suggestion, the best
// one first and alone, then at most two per row so that the labels fit on a
// phone.
import type { Suggestion, SuggestionKind } from "../ai/outputs.ts";
import type { ButtonPress } from "../copilot/buttons.ts";
import { encodeButton } from "./button-data.ts";
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
  callback("🔍 Analizza", { action: "ANALYZE", kind });

/**
 * The buttons that write suggestions again, under suggestions of `kind`,
 * then 🔍. Under follow-ups there is no other follow-up: the next one needs
 * a screenshot of the chat, which the transition rules count exactly.
 */
export const actionRows = (kind: SuggestionKind): InlineKeyboard => {
  const more = callback("🔄 Altre 3", { action: "MORE", kind });
  const natural = callback("🙂 Più naturale", { action: "NATURAL", kind });
  const direct = callback("🎯 Più diretto", { action: "DIRECT", kind });
  const followUp = callback("💬 Follow-up", { action: "FOLLOW_UP", kind });
  return kind === "FOLLOW_UPS"
    ? [
        [more, natural],
        [direct, analyzeButton(kind)],
      ]
    : [[more, natural], [direct, followUp], [analyzeButton(kind)]];
};

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
