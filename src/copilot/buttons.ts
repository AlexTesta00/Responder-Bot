// A button under an answer: find the prospect of the message Alex tapped,
// apply the transition rules to what the bot remembers, then write new
// suggestions or show what the bot remembers. Buttons observe nothing new,
// so they never change the memory.
import type { AiEngine, Generation, SuggestionAction } from "../ai/engine.ts";
import type {
  NewSuggestions,
  Suggestion,
  SuggestionKind,
  SuggestionStyle,
} from "../ai/outputs.ts";
import { runOf, totalCost, type GenerationLog } from "../ai/runs.ts";
import type { StageChange } from "../conversations/domain.ts";
import type { Pause } from "../conversations/transition.ts";
import type { ProspectMemory } from "../prospects/memory.ts";
import type { ProspectStore, SendOutcome } from "../prospects/store.ts";
import { errorFields } from "../shared/errors.ts";
import type { Logger } from "../shared/logger.ts";
import {
  createMemorySteps,
  logGeneration,
  pauseOf,
  resolveReference,
} from "./memory.ts";

/** What the buttons under suggestions ask for. */
export type AnswerAction = Exclude<SuggestionAction, "NEXT_FOLLOW_UP">;

/** What a button does: write suggestions again, or show the memory. */
export type ButtonAction = AnswerAction | "ANALYZE";

/** A tap on a button, under suggestions of `kind`. */
export type ButtonPress = Readonly<{
  action: ButtonAction;
  kind: SuggestionKind;
}>;

/** The message Alex tapped: where it is and the suggestions it shows. */
export type TappedMessage = Readonly<{
  chatId: number;
  messageId: number;
  /** The texts of the suggestions shown, in order; empty if unreadable. */
  suggestions: readonly string[];
}>;

export type ButtonAnswer =
  | Readonly<{
      type: "SUGGESTED";
      action: SuggestionAction;
      generation: Generation<NewSuggestions>;
      /** The kind of the new suggestions. */
      kind: SuggestionKind;
      username: string;
      prospectId: string;
      /** First messages asked when the conversation had already started. */
      upgraded: boolean;
      /** The suggestions to rewrite could not be read back. */
      previousLost: boolean;
      /** 💬 has just marked the tapped message as sent. */
      declared: boolean;
      costMicroUsd: number | null;
    }>
  /** The transition rules say Alex should not write now. */
  | Readonly<{
      type: "PAUSED";
      pause: Pause;
      username: string;
      prospectId: string;
    }>
  /** What the bot remembers about the prospect. */
  | Readonly<{
      type: "CARD";
      memory: ProspectMemory;
      history: readonly StageChange[];
      pause: Pause | null;
    }>
  /** The tapped message is about no prospect the bot remembers. */
  | Readonly<{ type: "NOT_LINKED" }>
  /** The memory could not be read: without it, nothing is written. */
  | Readonly<{ type: "UNAVAILABLE" }>;

export type PressButton = (
  press: ButtonPress,
  tapped: TappedMessage,
  log: Logger,
) => Promise<ButtonAnswer>;

export type ButtonDependencies = Readonly<{
  ai: AiEngine;
  prospects: ProspectStore;
  generations: GenerationLog;
}>;

const STYLES: Readonly<Record<SuggestionKind, readonly SuggestionStyle[]>> = {
  FIRST_MESSAGES: ["BEST", "CURIOSITY", "NATURAL"],
  REPLIES: ["BEST", "ALTERNATIVE", "DIRECT"],
  FOLLOW_UPS: ["BEST", "ALTERNATIVE", "DIRECT"],
};

/** The suggestions shown, when the message still holds all three. */
const suggestionsShown = (
  kind: SuggestionKind,
  texts: readonly string[],
): readonly Suggestion[] | null => {
  const styles = STYLES[kind];
  if (texts.length !== styles.length) {
    return null;
  }
  return styles.map((style, index) => ({ style, text: texts[index] ?? "" }));
};

const conversationStarted = (memory: ProspectMemory): boolean =>
  memory.messages.length > 0 || memory.prospect.conversation !== null;

export const createButtonActions = ({
  ai,
  prospects,
  generations,
}: ButtonDependencies): PressButton => {
  const steps = createMemorySteps({ prospects, generations });

  const historyOf = async (
    username: string,
    log: Logger,
  ): Promise<readonly StageChange[]> => {
    try {
      return await prospects.stageHistory(username);
    } catch (error) {
      log.warn(errorFields(error), "stage history unavailable");
      return [];
    }
  };

  /**
   * 💬 says that Alex sent one of the suggestions of the tapped message:
   * it is marked as sent before the rules count it. Null when it cannot be
   * marked, and the follow-up limit could not be known.
   */
  const declare = async (
    kind: SuggestionKind,
    tapped: TappedMessage,
    log: Logger,
  ): Promise<SendOutcome["type"] | null> => {
    try {
      const outcome = await prospects.recordSend({
        chatId: tapped.chatId,
        messageId: tapped.messageId,
        kind,
        style: null,
        text: null,
      });
      log.info(
        {
          ...(outcome.type === "NOT_LINKED"
            ? {}
            : { prospect_id: outcome.prospectId }),
          kind,
          outcome: outcome.type,
        },
        "send recorded",
      );
      return outcome.type;
    } catch (error) {
      log.error(errorFields(error), "send not recorded");
      return null;
    }
  };

  return async ({ action, kind }, tapped, log) => {
    const declared =
      action === "FOLLOW_UP" ? await declare(kind, tapped, log) : "NONE";
    if (declared === null) {
      return { type: "UNAVAILABLE" };
    }
    if (declared === "NOT_LINKED") {
      return { type: "NOT_LINKED" };
    }

    // Fail closed: without the memory, neither the context nor the pauses
    // are known, so nothing is written.
    const resolved = await resolveReference(
      prospects,
      { type: "REPLY", chatId: tapped.chatId, messageId: tapped.messageId },
      log,
    );
    if (resolved.type !== "FOUND") {
      return resolved.type === "UNKNOWN"
        ? { type: "NOT_LINKED" }
        : { type: "UNAVAILABLE" };
    }
    const { username } = resolved;
    const loaded = await steps.load(username, log);
    if (!loaded.available) {
      return { type: "UNAVAILABLE" };
    }
    const { memory } = loaded;
    if (memory === null) {
      return { type: "NOT_LINKED" };
    }
    const prospectId = memory.prospect.id;

    if (action === "ANALYZE") {
      return {
        type: "CARD",
        memory,
        history: await historyOf(username, log),
        pause: pauseOf(memory),
      };
    }

    // First messages make no sense once the conversation has started. A
    // follow-up is about the message Alex sent, so it keeps the texts shown.
    const upgraded =
      action !== "FOLLOW_UP" &&
      kind === "FIRST_MESSAGES" &&
      conversationStarted(memory);
    const written: SuggestionKind =
      action === "FOLLOW_UP" ? "FOLLOW_UPS" : upgraded ? "REPLIES" : kind;
    const shown = upgraded ? [] : suggestionsShown(kind, tapped.suggestions);
    const rewriting = action === "NATURAL" || action === "DIRECT";

    // The memory counts what Alex marked as sent, 💬 included.
    const pause = pauseOf(memory);
    if (pause !== null) {
      return { type: "PAUSED", pause, username, prospectId };
    }

    const generation = await ai.suggestAgain(
      { action, kind: written, previous: shown ?? [] },
      memory,
    );
    logGeneration(generation, log);
    const runs = [runOf(generation, prospectId)];
    await steps.record(runs, log);
    return {
      type: "SUGGESTED",
      action,
      generation,
      kind: written,
      username,
      prospectId,
      upgraded,
      previousLost: rewriting && !upgraded && shown === null,
      declared: declared === "RECORDED",
      costMicroUsd: totalCost(runs),
    };
  };
};
