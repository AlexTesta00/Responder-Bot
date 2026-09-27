import { describe, expect, it, vi } from "vitest";

import type { AiEngine, Generation } from "../ai/engine.ts";
import type { NewSuggestions } from "../ai/outputs.ts";
import type { GenerationLog } from "../ai/runs.ts";
import type {
  ConversationMessage,
  ConversationState,
} from "../conversations/domain.ts";
import type { ProspectProfile } from "../prospects/memory.ts";
import {
  createInMemoryProspectStore,
  type ProspectStore,
} from "../prospects/store.ts";
import type { Logger } from "../shared/logger.ts";
import { err, ok } from "../shared/result.ts";
import {
  createButtonActions,
  type AnswerAction,
  type AnswerPress,
} from "./buttons.ts";
import { conversationMove, pauseOf } from "./memory.ts";

const CHAT = 42;

const NEW: NewSuggestions = {
  suggestions: [
    { style: "BEST", text: "Ti mando un esempio?" },
    { style: "ALTERNATIVE", text: "Come lavori oggi?" },
    { style: "DIRECT", text: "Ti preparo un preventivo?" },
  ],
  note: null,
};

const generated = (
  result: Generation<NewSuggestions>["result"],
): Generation<NewSuggestions> => ({
  result,
  report: {
    mode: "NEW_SUGGESTIONS",
    prompt: "test-prompt@1",
    model: "claude-test",
    durationMs: 1_000,
    inputTokens: 900,
    outputTokens: 200,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costMicroUsd: 7_000,
    stopReason: "end_turn",
  },
});

const profile = (
  username: string,
  conversation: ConversationState | null,
): ProspectProfile => ({
  username,
  displayName: null,
  businessType: null,
  facts: [],
  hypotheses: [],
  conversation,
  summary: `Riassunto di ${username}.`,
  objections: [],
  commitments: [],
});

const ENGAGED: ConversationState = {
  stage: "ENGAGED",
  intent: "INTERESTED",
  interest: "MEDIUM",
  nextGoal: "UNDERSTAND_PROCESS",
};

const alex = (text: string): ConversationMessage => ({ author: "ALEX", text });
const them = (text: string): ConversationMessage => ({
  author: "PROSPECT",
  text,
});

const SHOWN_REPLIES = ["Dipende: cosa ti serve?", "Come lavori?", "Da 800 €."];
const SHOWN_FIRST = ["Ciao Mario!", "Come gestisci gli START?", "Bel profilo!"];

/** A store with Mario linked to message 1001 and Giulia to message 2001. */
const setup = async (
  mario: Readonly<{
    conversation?: ConversationState | null;
    messages?: readonly ConversationMessage[];
  }> = {},
) => {
  // One second more at each reading, so that a send always follows the
  // analysis it comes after.
  let seconds = 0;
  const prospects = createInMemoryProspectStore({
    now: () => {
      seconds += 1;
      return new Date(Date.UTC(2026, 8, 27, 8, 0, seconds));
    },
  });
  const marioMemory = await prospects.save({
    profile: profile(
      "mariofit",
      mario.conversation === undefined ? ENGAGED : mario.conversation,
    ),
    newMessages: mario.messages ?? [them("Quanto costa un sito?")],
  });
  const giuliaMemory = await prospects.save({
    profile: profile("giulia.bakery", ENGAGED),
    newMessages: [them("Mi serve un sito per gli ordini.")],
  });
  await prospects.linkMessages(marioMemory.prospect.id, CHAT, [1_001]);
  await prospects.linkMessages(giuliaMemory.prospect.id, CHAT, [2_001]);
  return { prospects, marioMemory, giuliaMemory, ...actions(prospects) };
};

const actions = (prospects: ProspectStore) => {
  const suggestAgain = vi.fn<AiEngine["suggestAgain"]>(() =>
    Promise.resolve(generated(ok(NEW))),
  );
  const record = vi.fn<GenerationLog["record"]>(() => Promise.resolve());
  const save = vi.spyOn(prospects, "save");
  const log = {
    info: vi.fn<Logger["info"]>(),
    warn: vi.fn<Logger["warn"]>(),
    error: vi.fn<Logger["error"]>(),
  };
  const notExpected = () => Promise.reject(new Error("not expected"));
  const press = createButtonActions({
    ai: {
      identifyProspect: notExpected,
      analyzeScreenshots: notExpected,
      replyToConversation: notExpected,
      suggestAgain,
    },
    prospects,
    generations: { record },
  });
  return {
    suggestAgain,
    record,
    save,
    log,
    tap: (
      buttonPress: AnswerPress,
      messageId = 1_001,
      suggestions: readonly string[] = SHOWN_REPLIES,
    ) => press(buttonPress, { chatId: CHAT, messageId, suggestions }, log),
  };
};

describe("createButtonActions", () => {
  it("writes new suggestions from the memory of the tapped message's prospect", async () => {
    const { tap, suggestAgain, record, marioMemory } = await setup();

    const answer = await tap({ action: "NATURAL", kind: "REPLIES" });

    expect(suggestAgain).toHaveBeenCalledExactlyOnceWith(
      {
        action: "NATURAL",
        kind: "REPLIES",
        previous: [
          { style: "BEST", text: "Dipende: cosa ti serve?" },
          { style: "ALTERNATIVE", text: "Come lavori?" },
          { style: "DIRECT", text: "Da 800 €." },
        ],
      },
      marioMemory,
    );
    expect(answer).toStrictEqual({
      type: "SUGGESTED",
      action: "NATURAL",
      generation: generated(ok(NEW)),
      kind: "REPLIES",
      username: "mariofit",
      prospectId: marioMemory.prospect.id,
      upgraded: false,
      previousLost: false,
      declared: false,
      costMicroUsd: 7_000,
    });
    expect(record).toHaveBeenCalledExactlyOnceWith({
      prospectId: marioMemory.prospect.id,
      report: generated(ok(NEW)).report,
      outcome: "OK",
    });
  });

  it("never mixes up the memory of two prospects", async () => {
    const { tap, suggestAgain, giuliaMemory } = await setup();

    await tap({ action: "MORE", kind: "REPLIES" }, 2_001, ["a", "b", "c"]);

    const [call] = suggestAgain.mock.calls;
    expect(call?.[1]).toStrictEqual(giuliaMemory);
    expect(JSON.stringify(call)).not.toContain("mariofit");
    expect(JSON.stringify(call)).not.toContain("Dipende");
  });

  it("never changes the memory", async () => {
    const { tap, save } = await setup();

    await tap({ action: "MORE", kind: "REPLIES" });
    await tap({ action: "ANALYZE", kind: "REPLIES" });

    expect(save).not.toHaveBeenCalled();
  });

  it("writes replies instead of first messages once the conversation started", async () => {
    const { tap, suggestAgain } = await setup();

    const answer = await tap(
      { action: "DIRECT", kind: "FIRST_MESSAGES" },
      1_001,
      SHOWN_FIRST,
    );

    expect(suggestAgain.mock.calls[0]?.[0]).toStrictEqual({
      action: "DIRECT",
      kind: "REPLIES",
      previous: [],
    });
    expect(answer).toMatchObject({
      type: "SUGGESTED",
      kind: "REPLIES",
      upgraded: true,
      previousLost: false,
    });
  });

  it("keeps first messages for a prospect Alex has not written to", async () => {
    const { tap, suggestAgain } = await setup({
      conversation: null,
      messages: [],
    });

    await tap({ action: "MORE", kind: "FIRST_MESSAGES" }, 1_001, SHOWN_FIRST);

    expect(suggestAgain.mock.calls[0]?.[0]).toMatchObject({
      kind: "FIRST_MESSAGES",
      previous: [
        { style: "BEST", text: "Ciao Mario!" },
        { style: "CURIOSITY", text: "Come gestisci gli START?" },
        { style: "NATURAL", text: "Bel profilo!" },
      ],
    });
  });

  it("follows up the first messages shown, even once the conversation started", async () => {
    const { tap, suggestAgain } = await setup({
      conversation: { ...ENGAGED, stage: "OPENING" },
      messages: [alex("Ciao Mario!")],
    });

    const answer = await tap(
      { action: "FOLLOW_UP", kind: "FIRST_MESSAGES" },
      1_001,
      SHOWN_FIRST,
    );

    expect(suggestAgain.mock.calls[0]?.[0]).toStrictEqual({
      action: "FOLLOW_UP",
      kind: "FOLLOW_UPS",
      previous: [
        { style: "BEST", text: "Ciao Mario!" },
        { style: "CURIOSITY", text: "Come gestisci gli START?" },
        { style: "NATURAL", text: "Bel profilo!" },
      ],
    });
    expect(answer).toMatchObject({ kind: "FOLLOW_UPS", upgraded: false });
  });

  it("follows up the first message of a profile", async () => {
    const { tap, suggestAgain } = await setup({
      conversation: null,
      messages: [],
    });

    const answer = await tap(
      { action: "FOLLOW_UP", kind: "FIRST_MESSAGES" },
      1_001,
      SHOWN_FIRST,
    );

    expect(suggestAgain.mock.calls[0]?.[0]).toMatchObject({
      action: "FOLLOW_UP",
      kind: "FOLLOW_UPS",
    });
    expect(answer).toMatchObject({ type: "SUGGESTED", kind: "FOLLOW_UPS" });
  });

  it("says so when the suggestions to rewrite cannot be read back", async () => {
    const { tap, suggestAgain } = await setup();

    const answer = await tap({ action: "NATURAL", kind: "REPLIES" }, 1_001, []);

    expect(suggestAgain.mock.calls[0]?.[0]).toMatchObject({ previous: [] });
    expect(answer).toMatchObject({ type: "SUGGESTED", previousLost: true });
  });

  it.each<AnswerAction>(["MORE", "NATURAL", "DIRECT", "FOLLOW_UP"])(
    "writes nothing with %s when the prospect asked not to be contacted",
    async (action) => {
      const { tap, suggestAgain } = await setup({
        conversation: { ...ENGAGED, stage: "DO_NOT_CONTACT" },
      });

      expect(await tap({ action, kind: "REPLIES" })).toMatchObject({
        type: "PAUSED",
        pause: "DO_NOT_CONTACT",
        username: "mariofit",
      });
      expect(suggestAgain).not.toHaveBeenCalled();
    },
  );

  it.each<AnswerAction>(["MORE", "NATURAL", "DIRECT", "FOLLOW_UP"])(
    "writes nothing with %s after the closing to an uninterested prospect",
    async (action) => {
      const { tap, suggestAgain } = await setup({
        conversation: { ...ENGAGED, stage: "NOT_INTERESTED" },
        messages: [them("Non mi interessa"), alex("Nessun problema!")],
      });

      expect(await tap({ action, kind: "REPLIES" })).toMatchObject({
        type: "PAUSED",
        pause: "CLOSED",
      });
      expect(suggestAgain).not.toHaveBeenCalled();
    },
  );

  it.each<AnswerAction>(["MORE", "NATURAL", "DIRECT", "FOLLOW_UP"])(
    "writes nothing with %s after the follow-ups allowed",
    async (action) => {
      const { tap, suggestAgain } = await setup({
        messages: [
          them("Ci penso"),
          alex("Ciao!"),
          alex("Ci sei?"),
          alex("Ehi"),
        ],
      });

      expect(await tap({ action, kind: "FOLLOW_UPS" })).toMatchObject({
        type: "PAUSED",
        pause: "FOLLOW_UP_LIMIT",
      });
      expect(suggestAgain).not.toHaveBeenCalled();
    },
  );

  it("marks as sent the message 💬 follows up, before the rules count it", async () => {
    const twoUnanswered = [them("Ci penso"), alex("Ciao!"), alex("Ci sei?")];
    const replies = await setup({ messages: twoUnanswered });
    const followUps = await setup({ messages: twoUnanswered });

    expect(
      await replies.tap({ action: "MORE", kind: "REPLIES" }),
    ).toMatchObject({ type: "SUGGESTED" });
    expect(
      await followUps.tap({ action: "FOLLOW_UP", kind: "REPLIES" }),
    ).toMatchObject({ type: "PAUSED", pause: "FOLLOW_UP_LIMIT" });
    expect(
      (await followUps.prospects.load("mariofit"))?.contact.sends,
    ).toMatchObject([{ kind: "REPLIES", style: null, text: null }]);
  });

  it("counts a message 💬 marked only once", async () => {
    const { tap, prospects } = await setup({
      messages: [them("Ci penso"), alex("Ciao!")],
    });

    const first = await tap({ action: "FOLLOW_UP", kind: "REPLIES" });
    const second = await tap({ action: "FOLLOW_UP", kind: "REPLIES" });

    expect(first).toMatchObject({ type: "SUGGESTED", declared: true });
    expect(second).toMatchObject({ type: "SUGGESTED", declared: false });
    expect((await prospects.load("mariofit"))?.contact.sends).toHaveLength(1);
  });

  it("writes nothing when 💬 cannot mark the message as sent", async () => {
    const store = createInMemoryProspectStore();
    const broken: ProspectStore = {
      ...store,
      recordSend: () => Promise.reject(new Error("ECONNREFUSED")),
    };
    const { tap, suggestAgain } = actions(broken);

    expect(await tap({ action: "FOLLOW_UP", kind: "REPLIES" })).toStrictEqual({
      type: "UNAVAILABLE",
    });
    expect(suggestAgain).not.toHaveBeenCalled();
  });

  it("shows the memory without the AI, even when Alex should not write", async () => {
    const { tap, suggestAgain, marioMemory, prospects } = await setup({
      conversation: { ...ENGAGED, stage: "DO_NOT_CONTACT" },
    });

    const answer = await tap({ action: "ANALYZE", kind: "REPLIES" });

    expect(answer).toStrictEqual({
      type: "CARD",
      memory: marioMemory,
      history: await prospects.stageHistory("mariofit"),
      pause: "DO_NOT_CONTACT",
    });
    expect(suggestAgain).not.toHaveBeenCalled();
  });

  it("knows no prospect for a message it did not link", async () => {
    const { tap, suggestAgain } = await setup();

    expect(await tap({ action: "MORE", kind: "REPLIES" }, 9_999)).toStrictEqual(
      { type: "NOT_LINKED" },
    );
    expect(suggestAgain).not.toHaveBeenCalled();
  });

  it("writes nothing when the memory cannot be read", async () => {
    const broken: ProspectStore = {
      ...createInMemoryProspectStore(),
      prospectOfMessage: () => Promise.reject(new Error("ECONNREFUSED")),
    };
    const { tap, suggestAgain } = actions(broken);

    expect(await tap({ action: "MORE", kind: "REPLIES" })).toStrictEqual({
      type: "UNAVAILABLE",
    });
    expect(suggestAgain).not.toHaveBeenCalled();
  });

  it("records the generation even when it fails", async () => {
    const { tap, suggestAgain, record, marioMemory } = await setup();
    suggestAgain.mockResolvedValueOnce(
      generated(err({ type: "UNAVAILABLE", status: 529 })),
    );

    const answer = await tap({ action: "MORE", kind: "REPLIES" });

    expect(answer).toMatchObject({ type: "SUGGESTED" });
    expect(record).toHaveBeenCalledWith({
      prospectId: marioMemory.prospect.id,
      report: generated(ok(NEW)).report,
      outcome: "UNAVAILABLE",
    });
  });
});

describe("pauseOf", () => {
  const memoryWith = async (
    conversation: ConversationState | null,
    messages: readonly ConversationMessage[],
  ) =>
    createInMemoryProspectStore().save({
      profile: profile("mariofit", conversation),
      newMessages: messages,
    });

  it.each([
    [ENGAGED, [them("Ciao")]],
    [{ ...ENGAGED, stage: "DO_NOT_CONTACT" }, [them("Non scrivermi")]],
    [{ ...ENGAGED, stage: "NOT_INTERESTED" }, [them("No"), alex("Ok!")]],
    [ENGAGED, [them("Ci penso"), alex("a"), alex("b"), alex("c")]],
    [null, []],
  ] as const)(
    "agrees with an analysis that observed nothing new: %j",
    async (conversation, messages) => {
      const memory = await memoryWith(conversation, messages);
      const nothingNew = {
        displayName: null,
        businessType: null,
        facts: [],
        hypotheses: [],
        conversation: null,
        summary: null,
        objections: null,
        commitments: null,
        messages: [],
      };

      expect(pauseOf(memory)).toBe(
        conversationMove(memory, nothingNew)?.pause ?? null,
      );
    },
  );

  it("counts the messages Alex marked as sent", async () => {
    let seconds = 0;
    const store = createInMemoryProspectStore({
      now: () => {
        seconds += 1;
        return new Date(Date.UTC(2026, 8, 27, 8, 0, seconds));
      },
    });
    const memory = await store.save({
      profile: profile("mariofit", ENGAGED),
      newMessages: [them("Ci penso"), alex("a"), alex("b")],
    });
    await store.linkMessages(memory.prospect.id, 42, [1_001]);

    expect(pauseOf(memory)).toBeNull();

    await store.recordSend({
      chatId: 42,
      messageId: 1_001,
      kind: "FOLLOW_UPS",
      style: "BEST",
      text: null,
    });
    const marked = await store.load("mariofit");
    expect(marked === null ? null : pauseOf(marked)).toBe("FOLLOW_UP_LIMIT");
  });
});
