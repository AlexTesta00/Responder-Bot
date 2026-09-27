import { describe, expect, it } from "vitest";

import type { SuggestionKind } from "../ai/outputs.ts";
import type { ButtonAction } from "../copilot/buttons.ts";
import { decodeButton, encodeButton } from "./button-data.ts";

const ACTIONS: readonly ButtonAction[] = [
  "MORE",
  "NATURAL",
  "DIRECT",
  "FOLLOW_UP",
  "ANALYZE",
];
const KINDS: readonly SuggestionKind[] = [
  "FIRST_MESSAGES",
  "REPLIES",
  "FOLLOW_UPS",
];
const PRESSES = ACTIONS.flatMap((action) =>
  KINDS.map((kind) => ({ type: "ANSWER" as const, action, kind })),
);

describe("button data", () => {
  it.each(PRESSES)("reads back $action under $kind", (press) => {
    expect(decodeButton(encodeButton(press))).toStrictEqual(press);
  });

  it.each(PRESSES)("fits in Telegram's 64 bytes: $action $kind", (press) => {
    expect(Buffer.byteLength(encodeButton(press))).toBeLessThanOrEqual(8);
  });

  it("is short and readable", () => {
    expect(
      encodeButton({ type: "ANSWER", action: "MORE", kind: "FIRST_MESSAGES" }),
    ).toBe("1:more:F");
  });

  // Buttons already sent in Telegram chats keep working.
  it.each([
    ["1:more:F", "MORE", "FIRST_MESSAGES"],
    ["1:nat:R", "NATURAL", "REPLIES"],
    ["1:dir:U", "DIRECT", "FOLLOW_UPS"],
    ["1:fu:R", "FOLLOW_UP", "REPLIES"],
    ["1:an:F", "ANALYZE", "FIRST_MESSAGES"],
  ] as const)("still reads %s", (data, action, kind) => {
    expect(decodeButton(data)).toStrictEqual({ type: "ANSWER", action, kind });
  });

  it.each([
    undefined,
    "",
    "2:more:F",
    "1:MORE:F",
    "1:more",
    "1:more:X",
    "1:more:F:extra",
    "1:more:💪",
    "x".repeat(65),
  ])("does not read %j", (data) => {
    expect(decodeButton(data)).toBeNull();
  });
});
