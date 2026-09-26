import { describe, expect, it, vi } from "vitest";

import type { AiEngine, AiError, Generation } from "../ai/engine.ts";
import type { ProspectIdentity, ScreenshotsAnalysis } from "../ai/outputs.ts";
import type { PromptMode } from "../ai/prompts/modes.ts";
import type { GenerationLog } from "../ai/runs.ts";
import type { DownloadedImage } from "../inputs/images.ts";
import type { ProspectProfile } from "../prospects/memory.ts";
import {
  createInMemoryProspectStore,
  type ProspectStore,
} from "../prospects/store.ts";
import type { Logger } from "../shared/logger.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { createScreenshotsAnalyst } from "./screenshots.ts";

const IMAGES: readonly DownloadedImage[] = [
  { format: "image/png", bytes: Uint8Array.from([0x89, 0x50]) },
];

const generation = <T>(
  mode: PromptMode,
  result: Result<T, AiError>,
): Generation<T> => ({
  result,
  report: {
    mode,
    prompt: "test-prompt@1",
    model: "claude-test",
    durationMs: 1_000,
    inputTokens: 1_500,
    outputTokens: 200,
    cacheReadTokens: 0,
    stopReason: "end_turn",
  },
});

const identity = (username: string | null): Generation<ProspectIdentity> =>
  generation("PROSPECT_IDENTITY", ok({ username, displayName: null }));

const conversation = (username: string | null): ScreenshotsAnalysis => ({
  kind: "CONVERSATION",
  prospect: { username, displayName: "Mario", businessType: "trainer" },
  messages: [
    { author: "ALEX", text: "Ciao Mario!" },
    { author: "PROSPECT", text: "Ciao, quanto costa un sito?" },
  ],
  facts: ["Chiede il prezzo di un sito."],
  hypotheses: [],
  analysis: {
    lastProspectMessage: "Ciao, quanto costa un sito?",
    stage: "ENGAGED",
    intent: "PRICE_REQUEST",
    interest: "MEDIUM",
    nextGoal: "UNDERSTAND_PROCESS",
    rationale: "Chiede il prezzo senza contesto.",
  },
  objections: ["Il prezzo di un sito gli sembra alto."],
  commitments: [],
  summary: "Ha risposto chiedendo il prezzo di un sito.",
  suggestions: [{ style: "BEST", text: "Dipende: cosa ti serve?" }],
  note: null,
});

const profile = (username: string, summary: string): ProspectProfile => ({
  username,
  displayName: null,
  businessType: null,
  facts: [`Fatto riservato a ${username}`],
  hypotheses: [],
  conversation: null,
  summary,
  objections: [],
  commitments: [],
});

type SetupOptions = Readonly<{
  /** The username the quick look reads. */
  recognized?: string | null;
  analysis?: ScreenshotsAnalysis;
  prospects?: ProspectStore;
}>;

const setup = ({
  recognized = "mariofit",
  analysis = conversation("mariofit"),
  prospects = createInMemoryProspectStore(),
}: SetupOptions = {}) => {
  const ai = {
    identifyProspect: vi.fn<AiEngine["identifyProspect"]>(() =>
      Promise.resolve(identity(recognized)),
    ),
    analyzeScreenshots: vi.fn<AiEngine["analyzeScreenshots"]>(() =>
      Promise.resolve(generation("SCREENSHOTS", ok(analysis))),
    ),
    replyToConversation: vi.fn<AiEngine["replyToConversation"]>(() =>
      Promise.reject(new Error("not expected")),
    ),
  };
  const record = vi.fn<GenerationLog["record"]>(() => Promise.resolve());
  const log = {
    info: vi.fn<Logger["info"]>(),
    warn: vi.fn<Logger["warn"]>(),
    error: vi.fn<Logger["error"]>(),
  };
  const analyze = createScreenshotsAnalyst({
    ai,
    prospects,
    generations: { record },
  });
  return {
    ai,
    prospects,
    record,
    log,
    analyze: () => analyze(IMAGES, "nota di Alex", log),
  };
};

describe("createScreenshotsAnalyst", () => {
  it("creates the memory of a new prospect", async () => {
    const { ai, prospects, analyze } = setup();

    const answer = await analyze();

    expect(answer.memory).toStrictEqual({ type: "CREATED" });
    expect(ai.analyzeScreenshots).toHaveBeenCalledExactlyOnceWith(
      IMAGES,
      "nota di Alex",
      null,
    );
    expect(await prospects.load("mariofit")).toMatchObject({
      prospect: {
        username: "mariofit",
        summary: "Ha risposto chiedendo il prezzo di un sito.",
        conversation: { stage: "ENGAGED", intent: "PRICE_REQUEST" },
      },
      messages: [
        { author: "ALEX", text: "Ciao Mario!" },
        { author: "PROSPECT", text: "Ciao, quanto costa un sito?" },
      ],
    });
  });

  it("analyzes a known prospect with its memory, then updates it", async () => {
    const prospects = createInMemoryProspectStore();
    const before = await prospects.save({
      profile: profile("mariofit", "Primo messaggio inviato."),
      newMessages: [{ author: "ALEX", text: "Ciao Mario!" }],
    });
    const { ai, analyze } = setup({ prospects });

    const answer = await analyze();

    expect(ai.analyzeScreenshots.mock.calls[0]?.[2]).toStrictEqual(before);
    expect(answer.memory).toStrictEqual({ type: "UPDATED", knownMessages: 1 });
    expect((await prospects.load("mariofit"))?.messages).toStrictEqual([
      { author: "ALEX", text: "Ciao Mario!" },
      { author: "PROSPECT", text: "Ciao, quanto costa un sito?" },
    ]);
  });

  it("never gives one prospect's memory to the analysis of another", async () => {
    const prospects = createInMemoryProspectStore();
    await prospects.save({
      profile: profile("mariofit", "Memoria di Mario"),
      newMessages: [{ author: "PROSPECT", text: "Messaggio di Mario" }],
    });
    const giulia = await prospects.save({
      profile: profile("giulia.bakery", "Memoria di Giulia"),
      newMessages: [{ author: "PROSPECT", text: "Messaggio di Giulia" }],
    });
    const { ai, analyze } = setup({
      prospects,
      recognized: "giulia.bakery",
      analysis: conversation("giulia.bakery"),
    });

    await analyze();

    const memory = ai.analyzeScreenshots.mock.calls[0]?.[2];
    expect(memory).toStrictEqual(giulia);
    expect(JSON.stringify(memory)).not.toContain("Mario");
    expect(JSON.stringify(memory)).not.toContain("mariofit");
  });

  it("gives no memory when it cannot tell whose screenshots they are", async () => {
    const prospects = createInMemoryProspectStore();
    await prospects.save({
      profile: profile("mariofit", "Memoria di Mario"),
      newMessages: [],
    });
    const { ai, analyze } = setup({
      prospects,
      recognized: null,
      analysis: conversation(null),
    });

    const answer = await analyze();

    expect(ai.analyzeScreenshots.mock.calls[0]?.[2]).toBeNull();
    expect(answer.memory).toStrictEqual({
      type: "NOT_SAVED",
      reason: "NO_USERNAME",
    });
  });

  it("leaves both memories untouched when two readings disagree", async () => {
    const prospects = createInMemoryProspectStore();
    const mario = await prospects.save({
      profile: profile("mariofit", "Memoria di Mario"),
      newMessages: [],
    });
    const { analyze, log } = setup({
      prospects,
      analysis: conversation("giulia.bakery"),
    });

    const answer = await analyze();

    expect(answer.memory).toStrictEqual({
      type: "NOT_SAVED",
      reason: "OTHER_PERSON",
    });
    expect(await prospects.load("mariofit")).toStrictEqual(mario);
    expect(await prospects.load("giulia.bakery")).toBeNull();
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it("remembers the username only the analysis could read", async () => {
    const { prospects, analyze } = setup({ recognized: null });

    const answer = await analyze();

    expect(answer.memory).toStrictEqual({ type: "CREATED" });
    expect(await prospects.load("mariofit")).not.toBeNull();
  });

  it("keeps answering when the memory cannot be read", async () => {
    const broken: ProspectStore = {
      load: () => Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1")),
      save: () => Promise.reject(new Error("not expected")),
      stageHistory: () => Promise.resolve([]),
    };
    const { ai, analyze, log } = setup({ prospects: broken });

    const answer = await analyze();

    expect(ai.analyzeScreenshots.mock.calls[0]?.[2]).toBeNull();
    expect(answer.generation.result.ok).toBe(true);
    expect(answer.memory).toStrictEqual({
      type: "NOT_SAVED",
      reason: "UNAVAILABLE",
    });
    const [fields, message] = log.error.mock.calls[0] ?? [];
    expect(message).toBe("prospect memory unavailable");
    // The error's message could quote data: only its name and codes are kept.
    expect(fields).toMatchObject({ error_name: "Error" });
    expect(JSON.stringify(fields)).not.toContain("127.0.0.1");
  });

  it("says so when the memory cannot be saved", async () => {
    const readOnly: ProspectStore = {
      load: () => Promise.resolve(null),
      save: () => Promise.reject(new Error("ER_LOCK_DEADLOCK")),
      stageHistory: () => Promise.resolve([]),
    };
    const { analyze, log } = setup({ prospects: readOnly });

    const answer = await analyze();

    expect(answer.memory).toStrictEqual({
      type: "NOT_SAVED",
      reason: "UNAVAILABLE",
    });
    expect(log.error).toHaveBeenCalledOnce();
  });

  it("remembers nothing of a failed or unrelated analysis", async () => {
    const failed = setup();
    failed.ai.analyzeScreenshots.mockResolvedValue(
      generation("SCREENSHOTS", err({ type: "UNAVAILABLE", status: 529 })),
    );
    const unrelated = setup({
      analysis: { kind: "UNRELATED", note: "Un tramonto." },
    });

    expect((await failed.analyze()).memory).toBeNull();
    expect((await unrelated.analyze()).memory).toBeNull();
    expect(await failed.prospects.load("mariofit")).toBeNull();
    expect(await unrelated.prospects.load("mariofit")).toBeNull();
  });

  it("records both generations, linked to the prospect", async () => {
    const { prospects, record, analyze } = setup();

    await analyze();

    const id = (await prospects.load("mariofit"))?.prospect.id;
    expect(record.mock.calls.map(([run]) => run)).toStrictEqual([
      {
        prospectId: id,
        report: identity("mariofit").report,
        outcome: "OK",
      },
      {
        prospectId: id,
        report: { ...identity("mariofit").report, mode: "SCREENSHOTS" },
        outcome: "OK",
      },
    ]);
  });

  it("answers even when the costs cannot be recorded", async () => {
    const { record, analyze, log } = setup();
    record.mockRejectedValue(new Error("ER_NO_SUCH_TABLE"));

    const answer = await analyze();

    expect(answer.memory).toStrictEqual({ type: "CREATED" });
    expect(log.warn.mock.calls.map(([, message]) => message)).toStrictEqual([
      "generation runs not recorded",
    ]);
  });
});
