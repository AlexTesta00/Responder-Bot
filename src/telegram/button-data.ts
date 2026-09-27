// The data a callback button sends back when tapped: a version, the action
// and the kind of the suggestions it sits under, such as "1:more:R". It
// never holds ids, usernames or texts: the prospect comes from the message
// tapped. Telegram allows 1-64 bytes; these take at most 8.
import type { SuggestionIndex, SuggestionKind } from "../ai/outputs.ts";
import type { ButtonAction } from "../copilot/buttons.ts";

/** What a tapped button asks for, told apart by what it does. */
export type ButtonPress =
  /** Under suggestions: write them again, or show the memory. */
  | Readonly<{ type: "ANSWER"; action: ButtonAction; kind: SuggestionKind }>
  /**
   * ✅: Alex sent the suggestion `index` of the message, or one not said
   * when `index` is null.
   */
  | Readonly<{
      type: "SENT";
      kind: SuggestionKind;
      index: SuggestionIndex | null;
    }>;

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

// Marks a send, as in "1:ok:R:2" or, without the suggestion, "1:ok:R".
const SENT_CODE = "ok";

export const encodeButton = (press: ButtonPress): string => {
  switch (press.type) {
    case "ANSWER":
      return `${VERSION}:${ACTION_CODES[press.action]}:${KIND_CODES[press.kind]}`;
    case "SENT":
      return [
        VERSION,
        SENT_CODE,
        KIND_CODES[press.kind],
        ...(press.index === null ? [] : [String(press.index)]),
      ].join(":");
  }
};

const indexOf = (code: string): SuggestionIndex | null => {
  switch (code) {
    case "0":
      return 0;
    case "1":
      return 1;
    case "2":
      return 2;
    default:
      return null;
  }
};

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
  const [kindCode = "", ...extra] = args;
  const kind = kindOf(kindCode);
  if (kind === null) {
    return null;
  }
  if (code === SENT_CODE) {
    const [indexCode, ...more] = extra;
    if (indexCode === undefined) {
      return { type: "SENT", kind, index: null };
    }
    const index = indexOf(indexCode);
    return index === null || more.length > 0
      ? null
      : { type: "SENT", kind, index };
  }
  const action = actionOf(code);
  return action === null || extra.length > 0
    ? null
    : { type: "ANSWER", action, kind };
};
