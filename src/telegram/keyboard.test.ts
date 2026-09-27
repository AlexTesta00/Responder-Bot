import { describe, expect, it } from "vitest";

import type { Suggestion } from "../ai/outputs.ts";
import {
  actionRows,
  copyAndSentRows,
  copyRows,
  inPairs,
  isCopyable,
} from "./keyboard.ts";

const labels = (suggestions: readonly Suggestion[]) =>
  copyRows(suggestions).map((row) => row.map((button) => button.label));

describe("isCopyable", () => {
  it("allows the 256 UTF-16 units a copy button takes", () => {
    expect(isCopyable("x".repeat(256))).toBe(true);
    expect(isCopyable("x".repeat(257))).toBe(false);
    // An emoji outside the basic plane takes two units.
    expect(isCopyable(`${"x".repeat(254)}💪`)).toBe(true);
    expect(isCopyable(`${"x".repeat(255)}💪`)).toBe(false);
  });
});

describe("inPairs", () => {
  it("groups items two by two", () => {
    expect(inPairs([1, 2, 3])).toStrictEqual([[1, 2], [3]]);
    expect(inPairs([])).toStrictEqual([]);
  });
});

describe("copyRows", () => {
  it("puts the best suggestion alone on the first row", () => {
    expect(
      labels([
        { style: "BEST", text: "a" },
        { style: "ALTERNATIVE", text: "b" },
        { style: "DIRECT", text: "c" },
      ]),
    ).toStrictEqual([["📋 Copia BEST"], ["📋 ALTERNATIVE", "📋 DIRECT"]]);
  });

  it("makes the best suggestion the primary button", () => {
    const [[best] = [], [other] = []] = copyRows([
      { style: "BEST", text: "a" },
      { style: "CURIOSITY", text: "b" },
    ]);

    expect(best).toMatchObject({ type: "COPY", primary: true, text: "a" });
    expect(other).toMatchObject({ type: "COPY", primary: false, text: "b" });
  });

  it("leaves out suggestions too long to copy and closes the gap", () => {
    expect(
      labels([
        { style: "BEST", text: "x".repeat(300) },
        { style: "CURIOSITY", text: "b" },
        { style: "NATURAL", text: "c" },
      ]),
    ).toStrictEqual([["📋 CURIOSITY", "📋 NATURAL"]]);
  });

  it("has no rows without suggestions", () => {
    expect(copyRows([])).toStrictEqual([]);
  });
});

describe("actionRows", () => {
  const labelsOf = (kind: "FIRST_MESSAGES" | "REPLIES" | "FOLLOW_UPS") =>
    actionRows(kind).map((row) => row.map((button) => button.label));

  it("offers the buttons that write again, two per row, then 🔍", () => {
    expect(labelsOf("REPLIES")).toStrictEqual([
      ["🔄 Altre 3", "🙂 Più naturale"],
      ["🎯 Più diretto", "💬 Follow-up"],
      ["🔍 Analizza"],
    ]);
  });

  it("offers no follow-up under follow-ups", () => {
    expect(labelsOf("FOLLOW_UPS")).toStrictEqual([
      ["🔄 Altre 3", "🙂 Più naturale"],
      ["🎯 Più diretto", "🔍 Analizza"],
    ]);
  });

  it("tells each button the kind it sits under", () => {
    expect(actionRows("FIRST_MESSAGES").flat()).toContainEqual({
      type: "CALLBACK",
      label: "💬 Follow-up",
      data: "1:fu:F",
    });
  });
});

describe("copyAndSentRows", () => {
  it("puts ✅ beside the copy button of each suggestion", () => {
    const rows = copyAndSentRows(
      [
        { style: "BEST", text: "a" },
        { style: "ALTERNATIVE", text: "b" },
        { style: "DIRECT", text: "x".repeat(300) },
      ],
      "REPLIES",
    );

    expect(rows.map((row) => row.map((button) => button.label))).toStrictEqual([
      ["📋 Copia BEST", "✅ Inviato"],
      ["📋 ALTERNATIVE", "✅ Inviato"],
      // Too long to copy: only ✅, named after the suggestion.
      ["✅ Inviato DIRECT"],
    ]);
    expect(rows.map((row) => row.at(-1))).toMatchObject([
      { data: "1:ok:R:0" },
      { data: "1:ok:R:1" },
      { data: "1:ok:R:2" },
    ]);
  });

  it("names each suggestion by its style, whatever its place", () => {
    const [row] = copyAndSentRows(
      [{ style: "NATURAL", text: "c" }],
      "FIRST_MESSAGES",
    );

    expect(row?.at(-1)).toMatchObject({ data: "1:ok:F:2" });
  });
});
