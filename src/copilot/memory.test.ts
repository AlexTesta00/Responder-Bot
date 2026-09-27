import { describe, expect, it } from "vitest";

import type {
  ConversationMessage,
  ConversationState,
} from "../conversations/domain.ts";
import { memoryOf } from "../prospects/memory.test-support.ts";
import type { Observation, ProspectMemory, Send } from "../prospects/memory.ts";
import { conversationMove, moved } from "./memory.ts";

const alex = (text: string): ConversationMessage => ({ author: "ALEX", text });
const prospect = (text: string): ConversationMessage => ({
  author: "PROSPECT",
  text,
});

const DISCOVERY: ConversationState = {
  stage: "DISCOVERY",
  intent: "INTERESTED",
  interest: "MEDIUM",
  nextGoal: "VALIDATE_PROBLEM",
};

const memoryWith = (
  conversation: ConversationState | null,
  messages: readonly ConversationMessage[],
  sends: readonly Send[] = [],
): ProspectMemory =>
  memoryOf(
    {
      prospect: {
        id: "prospect-1",
        username: "mariofit",
        displayName: null,
        businessType: null,
        facts: [],
        hypotheses: [],
        conversation,
        summary: null,
        objections: [],
        commitments: [],
        createdAt: new Date("2026-09-20T10:00:00Z"),
        updatedAt: new Date("2026-09-20T10:00:00Z"),
      },
      messages,
    },
    sends,
  );

/** Marked as sent after the analysis of 20 September. */
const sent = (day: number): Send => ({
  kind: "FOLLOW_UPS",
  style: "BEST",
  text: null,
  sentAt: new Date(Date.UTC(2026, 8, day, 10)),
});

const observation = (
  conversation: ConversationState | null,
  messages: readonly ConversationMessage[],
): Observation => ({
  displayName: null,
  businessType: null,
  facts: [],
  hypotheses: [],
  conversation,
  summary: null,
  objections: null,
  commitments: null,
  messages,
});

describe("conversationMove", () => {
  it("follows a new reading", () => {
    expect(
      conversationMove(null, observation(DISCOVERY, [prospect("Ciao!")])),
    ).toStrictEqual({ state: DISCOVERY, pause: null });
  });

  it("has nothing to move without any state", () => {
    expect(conversationMove(null, observation(null, []))).toBeNull();
  });

  it("keeps an earlier pause when a profile brings no reading", () => {
    const stopped = { ...DISCOVERY, stage: "DO_NOT_CONTACT" } as const;

    expect(
      conversationMove(memoryWith(stopped, []), observation(null, [])),
    ).toStrictEqual({ state: stopped, pause: "DO_NOT_CONTACT" });
  });

  it("counts only the messages the memory does not hold yet", () => {
    const stored = [prospect("Ciao!"), alex("Ti va di sentirci?")];

    // The same two messages again, plus two follow-ups: three unanswered.
    const move = conversationMove(
      memoryWith(DISCOVERY, stored),
      observation(DISCOVERY, [
        ...stored,
        alex("Ci sei?"),
        alex("Ultimo messaggio, promesso"),
      ]),
    );

    expect(move).toStrictEqual({
      state: { ...DISCOVERY, stage: "GHOSTED" },
      pause: "FOLLOW_UP_LIMIT",
    });
  });

  it("lifts the pauses when the prospect writes again", () => {
    const stopped = { ...DISCOVERY, stage: "DO_NOT_CONTACT" } as const;

    expect(
      conversationMove(
        memoryWith(stopped, [prospect("Non scrivermi più")]),
        observation(DISCOVERY, [prospect("Scusa, ci ho ripensato")]),
      ),
    ).toStrictEqual({ state: DISCOVERY, pause: null });
  });
});

describe("conversationMove with the messages Alex marked as sent", () => {
  it("counts them when the analysis saw nothing new", () => {
    const memory = memoryWith(
      DISCOVERY,
      [prospect("Ci penso"), alex("Ciao!"), alex("Ci sei?")],
      [sent(22)],
    );

    expect(conversationMove(memory, observation(DISCOVERY, []))).toStrictEqual({
      state: { ...DISCOVERY, stage: "GHOSTED" },
      pause: "FOLLOW_UP_LIMIT",
    });
  });

  it("forgets them once the prospect writes again", () => {
    const memory = memoryWith(
      DISCOVERY,
      [prospect("Ci penso"), alex("Ciao!")],
      [sent(22), sent(24)],
    );

    expect(
      conversationMove(memory, observation(DISCOVERY, [prospect("Eccomi!")])),
    ).toStrictEqual({ state: DISCOVERY, pause: null });
  });

  it("stops a profile written to three times, storing no reading", () => {
    const memory = memoryWith(null, [], [sent(21), sent(24), sent(29)]);
    // The profile sent again: no conversation to read.
    const move = conversationMove(memory, observation(null, []));

    expect(move).toStrictEqual({ state: null, pause: "FOLLOW_UP_LIMIT" });
    expect(moved(observation(null, []), move).conversation).toBeNull();
  });
});

describe("moved", () => {
  it("remembers the state the rules decided", () => {
    const ghosted = { ...DISCOVERY, stage: "GHOSTED" } as const;

    expect(
      moved(observation(DISCOVERY, []), { state: ghosted, pause: null })
        .conversation,
    ).toStrictEqual(ghosted);
    expect(moved(observation(DISCOVERY, []), null).conversation).toStrictEqual(
      DISCOVERY,
    );
  });
});
