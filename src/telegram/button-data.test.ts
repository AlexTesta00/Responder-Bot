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

describe("✅ button data", () => {
  const SENT = (["FIRST_MESSAGES", "REPLIES", "FOLLOW_UPS"] as const).flatMap(
    (kind) =>
      ([0, 1, 2, null] as const).map((index) => ({
        type: "SENT" as const,
        kind,
        index,
      })),
  );

  it.each(SENT)("reads back ✅ $index under $kind", (press) => {
    expect(decodeButton(encodeButton(press))).toStrictEqual(press);
    expect(Buffer.byteLength(encodeButton(press))).toBeLessThanOrEqual(8);
  });

  it("names the suggestion by its place, or none from the card", () => {
    expect(encodeButton({ type: "SENT", kind: "REPLIES", index: 2 })).toBe(
      "1:ok:R:2",
    );
    expect(
      encodeButton({ type: "SENT", kind: "FIRST_MESSAGES", index: null }),
    ).toBe("1:ok:F");
  });

  it.each([
    "1:ok",
    "1:ok:X:0",
    "1:ok:R:3",
    "1:ok:R:-1",
    "1:ok:R:2:0",
    "1:ok:R:",
  ])("does not read %j", (data) => {
    expect(decodeButton(data)).toBeNull();
  });
});

describe("card button data", () => {
  it.each(["FIRST_MESSAGES", "REPLIES", "FOLLOW_UPS"] as const)(
    "reads back a card's button for %s",
    (kind) => {
      const press = { type: "WRITE", kind } as const;
      expect(decodeButton(encodeButton(press))).toStrictEqual(press);
    },
  );

  it("is short, and takes nothing more", () => {
    expect(encodeButton({ type: "WRITE", kind: "FOLLOW_UPS" })).toBe("1:w:U");
    expect(decodeButton("1:w:U:0")).toBeNull();
  });
});
