// The analysis of screenshots with the memory of the prospect they show:
// recognize the prospect, load what the bot remembers, analyze, move the
// conversation on and remember.
import type { AiEngine, Generation } from "../ai/engine.ts";
import type { ScreenshotsAnalysis } from "../ai/outputs.ts";
import { runOf, type GenerationLog } from "../ai/runs.ts";
import type { Pause } from "../conversations/transition.ts";
import type { DownloadedImage } from "../inputs/images.ts";
import type { Observation } from "../prospects/memory.ts";
import type { ProspectStore } from "../prospects/store.ts";
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

export type ScreenshotsAnswer = Readonly<{
  generation: Generation<ScreenshotsAnalysis>;
  /** Null when there is nothing to remember: a failed or unrelated analysis. */
  memory: MemoryOutcome | null;
  /** Why no message should be suggested now, whatever the analysis wrote. */
  pause: Pause | null;
  /** The prospect the answer is about, when known. */
  prospectId: string | null;
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

type ProspectAnalysis = Extract<
  ScreenshotsAnalysis,
  Readonly<{ kind: "PROFILE" | "CONVERSATION" }>
>;

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
  const steps = createMemorySteps({ prospects, generations });

  const rememberAnalysis = async (
    recognized: string | null,
    loaded: Loaded,
    analysis: ProspectAnalysis,
    log: Logger,
  ): Promise<Stored & Readonly<{ pause: Pause | null }>> => {
    const observation = observationOf(analysis);
    // Without the memory, the rules still read what the screenshots show.
    const pauseWithoutMemory =
      conversationMove(null, observation)?.pause ?? null;

    // Two readings of the same screenshots must agree before anything is
    // written: one prospect's data must never end up in another's memory.
    const seen = analysis.prospect.username;
    if (recognized !== null && seen !== null && seen !== recognized) {
      log.warn({}, "prospect memory not saved: two different usernames");
      return { ...notSaved("OTHER_PERSON"), pause: pauseWithoutMemory };
    }

    const username = recognized ?? seen;
    if (username === null) {
      return { ...notSaved("NO_USERNAME"), pause: pauseWithoutMemory };
    }

    // Only the analysis read the username: its memory is not loaded yet.
    const current =
      recognized === null ? await steps.load(username, log) : loaded;
    if (!current.available) {
      return { ...notSaved("UNAVAILABLE"), pause: pauseWithoutMemory };
    }
    const move = conversationMove(current.memory, observation);
    const stored = await steps.store(
      username,
      current.memory,
      moved(observation, move),
      log,
    );
    return { ...stored, pause: move?.pause ?? null };
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
        : await steps.load(recognized, log);

    const generation = await ai.analyzeScreenshots(
      images,
      note,
      loaded.available ? loaded.memory : null,
    );
    logGeneration(generation, log);

    const analysis = generation.result.ok ? generation.result.value : null;
    const knownId = loaded.available
      ? (loaded.memory?.prospect.id ?? null)
      : null;
    const answer =
      analysis === null || analysis.kind === "UNRELATED"
        ? { outcome: null, prospectId: knownId, pause: null }
        : await rememberAnalysis(recognized, loaded, analysis, log);

    await steps.record(
      [
        runOf(identity, answer.prospectId),
        runOf(generation, answer.prospectId),
      ],
      log,
    );
    return {
      generation,
      memory: answer.outcome,
      pause: answer.pause,
      prospectId: answer.prospectId,
    };
  };
};
