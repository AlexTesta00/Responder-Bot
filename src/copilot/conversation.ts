// A conversation Alex pasted as text: find whose it is, load what the bot
// remembers about them, suggest the replies, move the conversation on and
// remember.
import type { AiEngine, Generation } from "../ai/engine.ts";
import type { ConversationReply } from "../ai/outputs.ts";
import { runOf, type GenerationLog } from "../ai/runs.ts";
import type { Pause } from "../conversations/transition.ts";
import type { Observation } from "../prospects/memory.ts";
import type { ProspectStore } from "../prospects/store.ts";
import { errorFields } from "../shared/errors.ts";
import type { Logger } from "../shared/logger.ts";
import {
  conversationMove,
  createMemorySteps,
  logGeneration,
  moved,
  notSaved,
  type Loaded,
  type MemoryOutcome,
  type Stored,
} from "./memory.ts";

/** How Alex said whose conversation it is. */
export type ProspectReference =
  /** The @username written on the first line. */
  | Readonly<{ type: "USERNAME"; username: string }>
  /** A reply to a message the bot sent about the prospect. */
  | Readonly<{ type: "REPLY"; chatId: number; messageId: number }>;

export type ConversationAnswer = Readonly<{
  generation: Generation<ConversationReply>;
  /** The prospect Alex named, when the reference led to one. */
  username: string | null;
  /** Null when the generation failed: there is nothing to remember. */
  memory: MemoryOutcome | null;
  /** Why no message should be suggested now, whatever the analysis wrote. */
  pause: Pause | null;
  /** The prospect the answer is about, when known. */
  prospectId: string | null;
}>;

export type ReplyToConversation = (
  text: string,
  reference: ProspectReference | null,
  log: Logger,
) => Promise<ConversationAnswer>;

export type ConversationDependencies = Readonly<{
  ai: AiEngine;
  prospects: ProspectStore;
  generations: GenerationLog;
}>;

type Resolved =
  | Readonly<{ type: "FOUND"; username: string }>
  | Readonly<{ type: "UNKNOWN" }>
  | Readonly<{ type: "UNAVAILABLE" }>;

const observationOf = (reply: ConversationReply): Observation => ({
  displayName: null,
  businessType: null,
  facts: reply.facts,
  hypotheses: reply.hypotheses,
  conversation: {
    stage: reply.analysis.stage,
    intent: reply.analysis.intent,
    interest: reply.analysis.interest,
    nextGoal: reply.analysis.nextGoal,
  },
  summary: reply.summary,
  objections: reply.objections,
  commitments: reply.commitments,
  messages: reply.messages,
});

export const createConversationAnalyst = ({
  ai,
  prospects,
  generations,
}: ConversationDependencies): ReplyToConversation => {
  const steps = createMemorySteps({ prospects, generations });

  const resolve = async (
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

  const loadResolved = async (
    resolved: Resolved,
    log: Logger,
  ): Promise<Loaded> => {
    switch (resolved.type) {
      case "FOUND":
        return steps.load(resolved.username, log);
      case "UNKNOWN":
        return { available: true, memory: null };
      case "UNAVAILABLE":
        return { available: false };
    }
  };

  const storeReply = async (
    resolved: Resolved,
    loaded: Loaded,
    observation: Observation,
    log: Logger,
  ): Promise<Stored & Readonly<{ pause: Pause | null }>> => {
    const memory = loaded.available ? loaded.memory : null;
    const move = conversationMove(memory, observation);
    const pause = move?.pause ?? null;
    if (resolved.type === "UNKNOWN") {
      return { ...notSaved("NO_PROSPECT"), pause };
    }
    if (resolved.type === "UNAVAILABLE" || !loaded.available) {
      return { ...notSaved("UNAVAILABLE"), pause };
    }
    const stored = await steps.store(
      resolved.username,
      memory,
      moved(observation, move),
      log,
    );
    return { ...stored, pause };
  };

  return async (text, reference, log) => {
    const resolved = await resolve(reference, log);
    const loaded = await loadResolved(resolved, log);

    const generation = await ai.replyToConversation(
      text,
      loaded.available ? loaded.memory : null,
    );
    logGeneration(generation, log);

    const knownId = loaded.available
      ? (loaded.memory?.prospect.id ?? null)
      : null;
    const answer = generation.result.ok
      ? await storeReply(
          resolved,
          loaded,
          observationOf(generation.result.value),
          log,
        )
      : { outcome: null, prospectId: knownId, pause: null };

    await steps.record([runOf(generation, answer.prospectId)], log);
    return {
      generation,
      username: resolved.type === "FOUND" ? resolved.username : null,
      memory: answer.outcome,
      pause: answer.pause,
      prospectId: answer.prospectId,
    };
  };
};
