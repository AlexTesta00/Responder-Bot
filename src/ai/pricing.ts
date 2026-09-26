// What a generation costs, estimated from the tokens the API reports and the
// list prices of the Claude API (platform.claude.com/docs/en/about-claude/pricing,
// September 2026). It is an estimate: the Claude Console has the real figures,
// and no API exposes the remaining credit.

/** List prices, in USD per million tokens. */
export type ModelPrices = Readonly<{
  input: number;
  /** Writing a prefix to the 5-minute prompt cache. */
  cacheWrite5m: number;
  /** Writing a prefix to the 1-hour prompt cache. */
  cacheWrite1h: number;
  /** Reading a prefix from the prompt cache. */
  cacheRead: number;
  output: number;
}>;

// Cache writes cost 1.25 times the input for 5 minutes and twice for an hour
// on every model; cache reads differ from model to model.
const prices = (
  input: number,
  cacheRead: number,
  output: number,
): ModelPrices => ({
  input,
  cacheWrite5m: input * 1.25,
  cacheWrite1h: input * 2,
  cacheRead,
  output,
});

/** The models the bot uses, and those the API may fall back to. */
export const MODEL_PRICES: ReadonlyMap<string, ModelPrices> = new Map([
  ["claude-fable-5-1", prices(10, 0.25, 50)],
  ["claude-fable-5", prices(10, 1, 50)],
  ["claude-opus-5-5", prices(4, 0.2, 20)],
  ["claude-opus-5", prices(5, 0.5, 25)],
  ["claude-opus-4-8", prices(5, 0.5, 25)],
  ["claude-opus-4-7", prices(5, 0.5, 25)],
  ["claude-opus-4-6", prices(5, 0.5, 25)],
  ["claude-opus-4-5", prices(5, 0.5, 25)],
  ["claude-sonnet-5", prices(2, 0.2, 10)],
  ["claude-sonnet-4-6", prices(3, 0.3, 15)],
  ["claude-sonnet-4-5", prices(3, 0.3, 15)],
  ["claude-haiku-4-5", prices(1, 0.1, 5)],
]);

/** Prices of a model, by alias or by dated id such as claude-haiku-4-5-20251001. */
export const pricesOf = (model: string): ModelPrices | undefined =>
  MODEL_PRICES.get(model) ?? MODEL_PRICES.get(model.replace(/-\d{8}$/, ""));

/** The tokens one model billed during a generation. */
export type ModelUsage = Readonly<{
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
}>;

/**
 * Estimated cost in millionths of a dollar, or null when a model has no known
 * prices. Tokens times USD per million tokens is exactly that unit.
 */
export const costOf = (usage: readonly ModelUsage[]): number | null => {
  const costs = usage.map((tokens) => {
    const price = pricesOf(tokens.model);
    return price === undefined
      ? null
      : tokens.inputTokens * price.input +
          tokens.outputTokens * price.output +
          tokens.cacheReadTokens * price.cacheRead +
          tokens.cacheWrite5mTokens * price.cacheWrite5m +
          tokens.cacheWrite1hTokens * price.cacheWrite1h;
  });
  return costs.every((cost) => cost !== null)
    ? Math.round(costs.reduce((total, cost) => total + cost, 0))
    : null;
};
