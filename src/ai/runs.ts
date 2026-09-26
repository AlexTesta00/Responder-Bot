import type { Generation, GenerationReport } from "./engine.ts";

/** A generation as it is recorded: what it cost, never what it said. */
export type GenerationRun = Readonly<{
  prospectId: string | null;
  report: GenerationReport;
  /** OK, or the type of the error. */
  outcome: string;
}>;

/** Where generations are recorded, for costs and statistics. */
export type GenerationLog = Readonly<{
  record: (run: GenerationRun) => Promise<void>;
}>;

export const runOf = <T>(
  generation: Generation<T>,
  prospectId: string | null,
): GenerationRun => ({
  prospectId,
  report: generation.report,
  outcome: generation.result.ok ? "OK" : generation.result.error.type,
});

/**
 * What the runs cost together, adding up those with an estimate; null when
 * none has one.
 */
export const totalCost = (runs: readonly GenerationRun[]): number | null => {
  const costs = runs
    .map((run) => run.report.costMicroUsd)
    .filter((cost) => cost !== null);
  return costs.length === 0
    ? null
    : costs.reduce((total, cost) => total + cost, 0);
};
