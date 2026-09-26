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

/** Development without a database: the logs already describe each run. */
export const discardGenerationRuns: GenerationLog = {
  record: () => Promise.resolve(),
};
