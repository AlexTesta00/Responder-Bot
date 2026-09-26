// The steps every analysis shares: load what the bot remembers about a
// prospect, move the conversation through its transition rules, remember the
// result and record what the generations cost.
import type { Generation } from "../ai/engine.ts";
import type { GenerationLog, GenerationRun } from "../ai/runs.ts";
import {
  activityOf,
  transition,
  type Transition,
} from "../conversations/transition.ts";
import {
  messagesToAppend,
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
  /** A pasted conversation that Alex did not link to a prospect. */
  | "NO_PROSPECT"
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

export type Loaded =
  | Readonly<{ available: true; memory: ProspectMemory | null }>
  | Readonly<{ available: false }>;

export type Stored = Readonly<{
  outcome: MemoryOutcome;
  prospectId: string | null;
}>;

export const notSaved = (reason: NotSavedReason): Stored => ({
  outcome: { type: "NOT_SAVED", reason },
  prospectId: null,
});

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

/**
 * How the conversation moves with what an analysis observed. Without a new
 * reading, as with a profile, the stored state stays and so do its pauses;
 * with no state at all there is nothing to move.
 */
export const conversationMove = (
  memory: ProspectMemory | null,
  observation: Observation,
): Transition | null => {
  const stored = memory?.messages ?? [];
  const activity = activityOf(
    stored,
    messagesToAppend(stored, observation.messages),
  );
  const previous = memory?.prospect.conversation ?? null;
  if (observation.conversation !== null) {
    return transition(previous, observation.conversation, activity);
  }
  return previous === null ? null : transition(previous, previous, activity);
};

/** The observation with the state the transition rules decided. */
export const moved = (
  observation: Observation,
  move: Transition | null,
): Observation =>
  move === null ? observation : { ...observation, conversation: move.state };

export type MemorySteps = Readonly<{
  load: (username: string, log: Logger) => Promise<Loaded>;
  store: (
    username: string,
    memory: ProspectMemory | null,
    observation: Observation,
    log: Logger,
  ) => Promise<Stored>;
  record: (runs: readonly GenerationRun[], log: Logger) => Promise<void>;
}>;

export const createMemorySteps = ({
  prospects,
  generations,
}: Readonly<{
  prospects: ProspectStore;
  generations: GenerationLog;
}>): MemorySteps => ({
  // Without its memory the bot still answers: the analysis goes on without
  // history, and Alex is told it was not saved.
  load: async (username, log) => {
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
  },

  store: async (username, memory, observation, log) => {
    const update = remember(username, memory, observation);
    try {
      const saved = await prospects.save(update);
      log.info(
        {
          prospect_id: saved.prospect.id,
          created: memory === null,
          new_messages: update.newMessages.length,
          stage: saved.prospect.conversation?.stage ?? null,
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
  },

  record: async (runs, log) => {
    try {
      for (const run of runs) {
        await generations.record(run);
      }
    } catch (error) {
      log.warn(errorFields(error), "generation runs not recorded");
    }
  },
});
