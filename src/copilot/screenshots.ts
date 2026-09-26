// The analysis of screenshots with the memory of the prospect they show:
// recognize the prospect, load what the bot remembers, analyze, remember.
import type { AiEngine, Generation } from "../ai/engine.ts";
import type { ScreenshotsAnalysis } from "../ai/outputs.ts";
import { runOf, type GenerationLog, type GenerationRun } from "../ai/runs.ts";
import type { DownloadedImage } from "../inputs/images.ts";
import {
  remember,
  type Observation,
  type ProspectMemory,
} from "../prospects/memory.ts";
import type { ProspectStore } from "../prospects/store.ts";
import { errorFields } from "../shared/errors.ts";
import type { Logger } from "../shared/logger.ts";

export type NotSavedReason =
  /** No username is visible, so there is no telling who the prospect is. */
  | "NO_USERNAME"
  /** The analysis saw someone other than the prospect recognized first. */
  | "OTHER_PERSON"
  /** The memory could not be read or written. */
  | "UNAVAILABLE";

/** What the analysis did to the memory of the prospect. */
export type MemoryOutcome =
  | Readonly<{ type: "CREATED" }>
  /** `knownMessages` were remembered before this analysis. */
  | Readonly<{ type: "UPDATED"; knownMessages: number }>
  | Readonly<{ type: "NOT_SAVED"; reason: NotSavedReason }>;

export type ScreenshotsAnswer = Readonly<{
  generation: Generation<ScreenshotsAnalysis>;
  /** Null when there is nothing to remember: a failed or unrelated analysis. */
  memory: MemoryOutcome | null;
}>;

export type AnalyzeScreenshots = (
  images: readonly DownloadedImage[],
  note: string | null,
  log: Logger,
) => Promise<ScreenshotsAnswer>;

export type ScreenshotsDependencies = Readonly<{
  ai: AiEngine;
  prospects: ProspectStore;
  generations: GenerationLog;
}>;

type Loaded =
  | Readonly<{ available: true; memory: ProspectMemory | null }>
  | Readonly<{ available: false }>;

type ProspectAnalysis = Extract<
  ScreenshotsAnalysis,
  Readonly<{ kind: "PROFILE" | "CONVERSATION" }>
>;

/** Token usage and timings of a generation; never what it read or wrote. */
export const logGeneration = <T>(
  { result, report }: Generation<T>,
  log: Logger,
): void => {
  const fields = {
    ai_mode: report.mode,
    prompt: report.prompt,
    model: report.model,
    duration_ms: report.durationMs,
    input_tokens: report.inputTokens,
    output_tokens: report.outputTokens,
    cache_read_tokens: report.cacheReadTokens,
    stop_reason: report.stopReason,
  };
  if (result.ok) {
    log.info(fields, "ai generation completed");
  } else {
    log.warn({ ...fields, ai_error: result.error }, "ai generation failed");
  }
};

const observationOf = (analysis: ProspectAnalysis): Observation => ({
  displayName: analysis.prospect.displayName,
  businessType: analysis.prospect.businessType,
  facts: analysis.facts,
  hypotheses: analysis.hypotheses,
  conversation:
    analysis.kind === "CONVERSATION"
      ? {
          stage: analysis.analysis.stage,
          intent: analysis.analysis.intent,
          interest: analysis.analysis.interest,
          nextGoal: analysis.analysis.nextGoal,
        }
      : null,
  summary: analysis.summary,
  // A profile says nothing about objections and promises: they are kept.
  objections: analysis.kind === "CONVERSATION" ? analysis.objections : null,
  commitments: analysis.kind === "CONVERSATION" ? analysis.commitments : null,
  messages: analysis.kind === "CONVERSATION" ? analysis.messages : [],
});

export const createScreenshotsAnalyst = ({
  ai,
  prospects,
  generations,
}: ScreenshotsDependencies): AnalyzeScreenshots => {
  // Without its memory the bot still answers: the analysis goes on without
  // history, and Alex is told it was not saved.
  const load = async (username: string, log: Logger): Promise<Loaded> => {
    try {
      const memory = await prospects.load(username);
      if (memory !== null) {
        log.info(
          {
            prospect_id: memory.prospect.id,
            messages: memory.messages.length,
          },
          "prospect memory loaded",
        );
      }
      return { available: true, memory };
    } catch (error) {
      log.error(errorFields(error), "prospect memory unavailable");
      return { available: false };
    }
  };

  const store = async (
    username: string,
    memory: ProspectMemory | null,
    analysis: ProspectAnalysis,
    log: Logger,
  ): Promise<
    Readonly<{ outcome: MemoryOutcome; prospectId: string | null }>
  > => {
    const update = remember(username, memory, observationOf(analysis));
    try {
      const saved = await prospects.save(update);
      log.info(
        {
          prospect_id: saved.prospect.id,
          created: memory === null,
          new_messages: update.newMessages.length,
        },
        "prospect memory saved",
      );
      return {
        outcome:
          memory === null
            ? { type: "CREATED" }
            : { type: "UPDATED", knownMessages: memory.messages.length },
        prospectId: saved.prospect.id,
      };
    } catch (error) {
      log.error(errorFields(error), "prospect memory not saved");
      return {
        outcome: { type: "NOT_SAVED", reason: "UNAVAILABLE" },
        prospectId: memory?.prospect.id ?? null,
      };
    }
  };

  const rememberAnalysis = async (
    recognized: string | null,
    loaded: Loaded,
    analysis: ScreenshotsAnalysis | null,
    log: Logger,
  ): Promise<
    Readonly<{ outcome: MemoryOutcome | null; prospectId: string | null }>
  > => {
    const knownId = loaded.available
      ? (loaded.memory?.prospect.id ?? null)
      : null;
    if (analysis === null || analysis.kind === "UNRELATED") {
      return { outcome: null, prospectId: knownId };
    }

    // Two readings of the same screenshots must agree before anything is
    // written: one prospect's data must never end up in another's memory.
    const seen = analysis.prospect.username;
    if (recognized !== null && seen !== null && seen !== recognized) {
      log.warn(
        { prospect_id: knownId },
        "prospect memory not saved: two different usernames",
      );
      return {
        outcome: { type: "NOT_SAVED", reason: "OTHER_PERSON" },
        prospectId: null,
      };
    }

    const username = recognized ?? seen;
    if (username === null) {
      return {
        outcome: { type: "NOT_SAVED", reason: "NO_USERNAME" },
        prospectId: null,
      };
    }

    // Only the analysis read the username: its memory is not loaded yet.
    const current = recognized === null ? await load(username, log) : loaded;
    return current.available
      ? store(username, current.memory, analysis, log)
      : {
          outcome: { type: "NOT_SAVED", reason: "UNAVAILABLE" },
          prospectId: null,
        };
  };

  const record = async (
    runs: readonly GenerationRun[],
    log: Logger,
  ): Promise<void> => {
    try {
      for (const run of runs) {
        await generations.record(run);
      }
    } catch (error) {
      log.warn(errorFields(error), "generation runs not recorded");
    }
  };

  return async (images, note, log) => {
    const identity = await ai.identifyProspect(images);
    logGeneration(identity, log);
    const recognized = identity.result.ok
      ? identity.result.value.username
      : null;
    const loaded: Loaded =
      recognized === null
        ? { available: true, memory: null }
        : await load(recognized, log);

    const generation = await ai.analyzeScreenshots(
      images,
      note,
      loaded.available ? loaded.memory : null,
    );
    logGeneration(generation, log);

    const { outcome, prospectId } = await rememberAnalysis(
      recognized,
      loaded,
      generation.result.ok ? generation.result.value : null,
      log,
    );
    await record(
      [runOf(identity, prospectId), runOf(generation, prospectId)],
      log,
    );
    return { generation, memory: outcome };
  };
};
