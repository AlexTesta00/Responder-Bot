// The steps every analysis shares: load what the bot remembers about a
// prospect, move the conversation through its transition rules, remember the
// result and record what the generations cost.
import type { Generation } from "../ai/engine.ts";
import type { GenerationLog, GenerationRun } from "../ai/runs.ts";
import type { ConversationState } from "../conversations/domain.ts";
import { transition, type Pause } from "../conversations/transition.ts";
import {
  contactOfMemory,
  pauseFor,
  unansweredAfter,
} from "../followups/contact.ts";
import {
  messagesToAppend,
  remember,
  type Observation,
  type ProspectMemory,
} from "../prospects/memory.ts";
import type { ProspectStore } from "../prospects/store.ts";
import { errorFields } from "../shared/errors.ts";
import type { Logger } from "../shared/logger.ts";

/** How Alex said which prospect a text or a button is about. */
export type ProspectReference =
  /** The @username written on the first line. */
  | Readonly<{ type: "USERNAME"; username: string }>
  /** A reply to, or a button under, a message the bot sent about them. */
  | Readonly<{ type: "REPLY"; chatId: number; messageId: number }>;

export type Resolved =
  | Readonly<{ type: "FOUND"; username: string }>
  | Readonly<{ type: "UNKNOWN" }>
  | Readonly<{ type: "UNAVAILABLE" }>;

/**
 * The prospect a reference leads to. A message of the bot leads to the
 * prospect it was linked to, never to a guess.
 */
export const resolveReference = async (
  prospects: ProspectStore,
  reference: ProspectReference | null,
  log: Logger,
): Promise<Resolved> => {
  if (reference === null) {
    return { type: "UNKNOWN" };
  }
  if (reference.type === "USERNAME") {
    return { type: "FOUND", username: reference.username };
  }
  try {
    const username = await prospects.prospectOfMessage(
      reference.chatId,
      reference.messageId,
    );
    return username === null
      ? { type: "UNKNOWN" }
      : { type: "FOUND", username };
  } catch (error) {
    log.error(errorFields(error), "prospect of the reply unavailable");
    return { type: "UNAVAILABLE" };
  }
};

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
    cache_write_tokens: report.cacheWriteTokens,
    cost_micro_usd: report.costMicroUsd,
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
/**
 * What the transition rules decided: the state to remember, or null when
 * there is none to store, and why Alex should not write now.
 */
export type Move = Readonly<{
  state: ConversationState | null;
  pause: Pause | null;
}>;

export const conversationMove = (
  memory: ProspectMemory | null,
  observation: Observation,
): Move | null => {
  const added = messagesToAppend(memory?.messages ?? [], observation.messages);
  // Alex's messages the analysis saw, and those Alex marked as sent.
  const activity = {
    newProspectMessages: added.filter(({ author }) => author === "PROSPECT")
      .length,
    unansweredMessages: unansweredAfter(memory, added),
  };
  const previous = memory?.prospect.conversation ?? null;
  if (observation.conversation !== null) {
    return transition(previous, observation.conversation, activity);
  }
  if (previous !== null) {
    return transition(previous, previous, activity);
  }
  // No reading yet: the follow-up limit still holds, and nothing is stored.
  const pause = pauseFor(null, activity.unansweredMessages);
  return pause === null ? null : { state: null, pause };
};

/**
 * Why no message should be suggested now, from the memory alone: the same
 * transition rules as an analysis that observed nothing new, counting the
 * messages Alex marked as sent.
 */
export const pauseOf = (memory: ProspectMemory): Pause | null =>
  pauseFor(memory.prospect.conversation, contactOfMemory(memory).unanswered);

/** The observation with the state the transition rules decided. */
export const moved = (
  observation: Observation,
  move: Move | null,
): Observation => {
  const state = move?.state ?? null;
  return state === null ? observation : { ...observation, conversation: state };
};

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
