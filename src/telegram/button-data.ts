// The data a callback button sends back when tapped: a version, the action
// and the kind of the suggestions it sits under, such as "1:more:R". It
// never holds ids, usernames or texts: the prospect comes from the message
// tapped. Telegram allows 1-64 bytes; these take at most 8.
import type { SuggestionKind } from "../ai/outputs.ts";
import type { ButtonAction, ButtonPress } from "../copilot/buttons.ts";

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

export const encodeButton = ({ action, kind }: ButtonPress): string =>
  `${VERSION}:${ACTION_CODES[action]}:${KIND_CODES[kind]}`;

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

/** The press a button's data describes, or null for unknown data. */
export const decodeButton = (data: string | undefined): ButtonPress | null => {
  const [version, actionCode = "", kindCode = "", ...rest] = (data ?? "").split(
    ":",
  );
  if (version !== VERSION || rest.length > 0) {
    return null;
  }
  const action = actionOf(actionCode);
  const kind = kindOf(kindCode);
  return action === null || kind === null ? null : { action, kind };
};
