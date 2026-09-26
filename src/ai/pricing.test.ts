import { describe, expect, it } from "vitest";

import { costOf, pricesOf, type ModelUsage } from "./pricing.ts";

const usage = (tokens: Partial<ModelUsage> & Pick<ModelUsage, "model">) => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0,
  ...tokens,
});

describe("pricesOf", () => {
  it("knows the models by alias and by dated id", () => {
    expect(pricesOf("claude-opus-5")).toMatchObject({ input: 5, output: 25 });
    expect(pricesOf("claude-haiku-4-5-20251001")).toMatchObject({
      input: 1,
      output: 5,
    });
  });

  it("does not mistake one model for another with a longer name", () => {
    expect(pricesOf("claude-opus-5-5")).toMatchObject({ input: 4 });
    expect(pricesOf("claude-opus-5-preview")).toBeUndefined();
  });

  it("has no prices for unknown models", () => {
    expect(pricesOf("gpt-5")).toBeUndefined();
    expect(pricesOf("constructor")).toBeUndefined();
  });
});

describe("costOf", () => {
  it("prices every kind of token in millionths of a dollar", () => {
    expect(
      costOf([
        usage({
          model: "claude-opus-5",
          inputTokens: 1_000,
          outputTokens: 2_000,
          cacheReadTokens: 10_000,
          cacheWrite5mTokens: 4_000,
          cacheWrite1hTokens: 1_000,
        }),
      ]),
      // 1000×5 + 2000×25 + 10000×0.5 + 4000×6.25 + 1000×10
    ).toBe(95_000);
  });

  it("adds up the models of a generation served by a fallback", () => {
    expect(
      costOf([
        usage({ model: "claude-opus-5", inputTokens: 1_000 }),
        usage({ model: "claude-sonnet-5", outputTokens: 100 }),
      ]),
    ).toBe(6_000);
  });

  it("rounds to a whole millionth", () => {
    expect(
      costOf([usage({ model: "claude-haiku-4-5", cacheReadTokens: 15 })]),
    ).toBe(2);
  });

  it("cannot estimate a model without known prices", () => {
    expect(
      costOf([
        usage({ model: "claude-opus-5", inputTokens: 1_000 }),
        usage({ model: "claude-unknown", inputTokens: 1_000 }),
      ]),
    ).toBeNull();
  });

  it("costs nothing without tokens", () => {
    expect(costOf([])).toBe(0);
  });
});
