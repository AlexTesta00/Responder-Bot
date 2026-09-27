// The data a callback button sends back when tapped: a version, the action
// and the kind of the suggestions it sits under, such as "1:more:R". It
// never holds ids, usernames or texts: the prospect comes from the message
// tapped. Telegram allows 1-64 bytes; these take at most 8.
import type { SuggestionKind } from "../ai/outputs.ts";
import type { ButtonAction } from "../copilot/buttons.ts";

/** What a tapped button asks for, told apart by what it does. */
export type ButtonPress =
  /** Under suggestions: write them again, or show the memory. */
  Readonly<{ type: "ANSWER"; action: ButtonAction; kind: SuggestionKind }>;

// Changing what the data means needs a new version: older buttons then
// decode to nothing and are answered as expired.
const VERSION = "1";

const ACTION_CODES = {
  MORE: "more",
  NATURAL: "nat",
  DIRECT: "dir",
  FOLLOW_UP: "fu",
  ANALYZE: "an",
} as const satisfies Record<ButtonAction, string>;

const KIND_CODES = {
  FIRST_MESSAGES: "F",
  REPLIES: "R",
  FOLLOW_UPS: "U",
} as const satisfies Record<SuggestionKind, string>;

export const encodeButton = (press: ButtonPress): string =>
  `${VERSION}:${ACTION_CODES[press.action]}:${KIND_CODES[press.kind]}`;

const actionOf = (code: string): ButtonAction | null => {
  switch (code) {
    case "more":
      return "MORE";
    case "nat":
      return "NATURAL";
    case "dir":
      return "DIRECT";
    case "fu":
      return "FOLLOW_UP";
    case "an":
      return "ANALYZE";
    default:
      return null;
  }
};

const kindOf = (code: string): SuggestionKind | null => {
  switch (code) {
    case "F":
      return "FIRST_MESSAGES";
    case "R":
      return "REPLIES";
    case "U":
      return "FOLLOW_UPS";
    default:
      return null;
  }
};

/**
 * The press a button's data describes, or null for unknown data. The code
 * of the action tells how to read the rest.
 */
export const decodeButton = (data: string | undefined): ButtonPress | null => {
  const [version, code = "", ...args] = (data ?? "").split(":");
  if (version !== VERSION) {
    return null;
  }
  const action = actionOf(code);
  if (action !== null) {
    const [kindCode = "", ...extra] = args;
    const kind = kindOf(kindCode);
    return kind === null || extra.length > 0
      ? null
      : { type: "ANSWER", action, kind };
  }
  return null;
};
