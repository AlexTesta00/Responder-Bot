import { describe, expect, it, vi } from "vitest";

import type { AiEngine, Generation } from "../ai/engine.ts";
import type { ConversationReply } from "../ai/outputs.ts";
import type { GenerationLog } from "../ai/runs.ts";
import type { ConversationMessage } from "../conversations/domain.ts";
import type { ProspectProfile } from "../prospects/memory.ts";
import {
  createInMemoryProspectStore,
  type ProspectStore,
} from "../prospects/store.ts";
import type { Logger } from "../shared/logger.ts";
import { err, ok } from "../shared/result.ts";
import {
  createConversationAnalyst,
  type ProspectReference,
} from "./conversation.ts";

const PASTED = "Mario: Quanto costa un sito come il tuo?";

const REPLY: ConversationReply = {
  messages: [{ author: "PROSPECT", text: "Quanto costa un sito come il tuo?" }],
  facts: [],
  hypotheses: [],
  analysis: {
    lastProspectMessage: "Quanto costa un sito come il tuo?",
    stage: "ENGAGED",
    intent: "PRICE_REQUEST",
    interest: "MEDIUM",
    nextGoal: "UNDERSTAND_PROCESS",
    rationale: "Chiede il prezzo senza contesto.",
  },
  objections: [],
  commitments: [{ by: "ALEX", text: "Mandargli un esempio." }],
  summary: "Ha chiesto il prezzo di un sito.",
  suggestions: [{ style: "BEST", text: "Dipende: cosa ti serve?" }],
  note: null,
};

const generated = (
  result: Generation<ConversationReply>["result"],
): Generation<ConversationReply> => ({
  result,
  report: {
    mode: "CONVERSATION_REPLY",
    prompt: "test-prompt@1",
    model: "claude-test",
    durationMs: 1_000,
    inputTokens: 900,
    outputTokens: 200,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costMicroUsd: 9_500,
    stopReason: "end_turn",
  },
});

const MARIO: ProspectProfile = {
  username: "mariofit",
  displayName: "Mario",
  businessType: "personal trainer",
  facts: [],
  hypotheses: [],
  conversation: null,
  summary: "Primo messaggio inviato.",
  objections: [],
  commitments: [],
};

const setup = (prospects: ProspectStore = createInMemoryProspectStore()) => {
  const replyToConversation = vi.fn<AiEngine["replyToConversation"]>(() =>
    Promise.resolve(generated(ok(REPLY))),
  );
  const record = vi.fn<GenerationLog["record"]>(() => Promise.resolve());
  const log = {
    info: vi.fn<Logger["info"]>(),
    warn: vi.fn<Logger["warn"]>(),
    error: vi.fn<Logger["error"]>(),
  };
  const reply = createConversationAnalyst({
    ai: {
      identifyProspect: () => Promise.reject(new Error("not expected")),
      analyzeScreenshots: () => Promise.reject(new Error("not expected")),
      replyToConversation,
    },
    prospects,
    generations: { record },
  });
  return {
    prospects,
    replyToConversation,
    record,
    log,
    reply: (reference: ProspectReference | null) =>
      reply(PASTED, reference, log),
  };
};

const withMario = async (
  messages: readonly ConversationMessage[] = [
    { author: "ALEX", text: "Ciao Mario!" },
  ],
) => {
  const prospects = createInMemoryProspectStore();
  const memory = await prospects.save({
    profile: MARIO,
    newMessages: messages,
  });
  await prospects.linkMessages(memory.prospect.id, 42, [1_001, 1_002]);
  return { prospects, memory };
};

describe("createConversationAnalyst", () => {
  it("remembers a conversation pasted under the prospect's @username", async () => {
    const { prospects, replyToConversation, reply } = setup();

    const answer = await reply({ type: "USERNAME", username: "mariofit" });

    expect(replyToConversation).toHaveBeenCalledExactlyOnceWith(PASTED, null);
    expect(answer.memory).toStrictEqual({ type: "CREATED" });
    expect(await prospects.load("mariofit")).toMatchObject({
      prospect: {
        summary: "Ha chiesto il prezzo di un sito.",
        commitments: [{ by: "ALEX", text: "Mandargli un esempio." }],
        conversation: { stage: "ENGAGED", intent: "PRICE_REQUEST" },
      },
      messages: REPLY.messages,
    });
  });

  it("continues the conversation of the message Alex replied to", async () => {
    const { prospects, memory } = await withMario();
    const { replyToConversation, reply } = setup(prospects);

    const answer = await reply({ type: "REPLY", chatId: 42, messageId: 1_002 });

    expect(replyToConversation).toHaveBeenCalledExactlyOnceWith(PASTED, memory);
    expect(answer).toMatchObject({
      memory: { type: "UPDATED", knownMessages: 1 },
      prospectId: memory.prospect.id,
      pause: null,
    });
  });

  it.each<[string, ProspectReference | null]>([
    ["no reference", null],
    [
      "a reply to a message about no prospect",
      { type: "REPLY", chatId: 42, messageId: 9_999 },
    ],
  ])("says it cannot remember with %s", async (_description, reference) => {
    const { prospects } = await withMario();
    const { replyToConversation, reply } = setup(prospects);

    const answer = await reply(reference);

    expect(replyToConversation).toHaveBeenCalledExactlyOnceWith(PASTED, null);
    expect(answer.memory).toStrictEqual({
      type: "NOT_SAVED",
      reason: "NO_PROSPECT",
    });
    expect((await prospects.load("mariofit"))?.messages).toHaveLength(1);
  });

  it("keeps answering when it cannot tell whose conversation it is", async () => {
    const broken: ProspectStore = {
      ...createInMemoryProspectStore(),
      prospectOfMessage: () => Promise.reject(new Error("ECONNREFUSED")),
    };
    const { replyToConversation, reply, log } = setup(broken);

    const answer = await reply({ type: "REPLY", chatId: 42, messageId: 1_001 });

    expect(replyToConversation).toHaveBeenCalledExactlyOnceWith(PASTED, null);
    expect(answer.memory).toStrictEqual({
      type: "NOT_SAVED",
      reason: "UNAVAILABLE",
    });
    expect(log.error).toHaveBeenCalledOnce();
  });

  it("pauses when the prospect asked not to be contacted", async () => {
    const { prospects } = await withMario([
      { author: "PROSPECT", text: "Non scrivermi più, grazie" },
    ]);
    const { replyToConversation, reply } = setup(prospects);
    replyToConversation.mockResolvedValue(
      generated(
        ok({
          ...REPLY,
          messages: [{ author: "PROSPECT", text: "Non scrivermi più, grazie" }],
          analysis: {
            ...REPLY.analysis,
            stage: "DO_NOT_CONTACT",
            intent: "DO_NOT_CONTACT",
          },
          suggestions: [],
        }),
      ),
    );

    const answer = await reply({ type: "USERNAME", username: "mariofit" });

    expect(answer.pause).toBe("DO_NOT_CONTACT");
    expect(await prospects.stageHistory("mariofit")).toMatchObject([
      { from: null, to: "DO_NOT_CONTACT" },
    ]);
  });

  it("records the generation, linked to the prospect", async () => {
    const { prospects, memory } = await withMario();
    const { record, reply } = setup(prospects);

    await reply({ type: "USERNAME", username: "mariofit" });

    expect(record.mock.calls.map(([run]) => run.prospectId)).toStrictEqual([
      memory.prospect.id,
    ]);
  });

  it("remembers nothing of a failed generation", async () => {
    const { prospects } = await withMario();
    const { replyToConversation, reply } = setup(prospects);
    replyToConversation.mockResolvedValue(
      generated(err({ type: "UNAVAILABLE", status: 529 })),
    );

    const answer = await reply({ type: "USERNAME", username: "mariofit" });

    expect(answer.memory).toBeNull();
    expect((await prospects.load("mariofit"))?.messages).toHaveLength(1);
  });
});
