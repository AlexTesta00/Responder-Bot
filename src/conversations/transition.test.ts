import { describe, expect, it } from "vitest";

import type { ConversationMessage, ConversationState } from "./domain.ts";
import {
  activityOf,
  transition,
  unansweredMessages,
  type Activity,
} from "./transition.ts";

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

const reading = (
  changes: Partial<ConversationState> = {},
): ConversationState => ({ ...DISCOVERY, ...changes });

const activity = (
  newProspectMessages: number,
  unanswered: number,
): Activity => ({ newProspectMessages, unansweredMessages: unanswered });

describe("unansweredMessages", () => {
  it.each([
    [[], 0],
    [[alex("Ciao")], 1],
    [[alex("Ciao"), prospect("Ciao!")], 0],
    [[alex("Ciao"), prospect("Ciao!"), alex("Ti va?"), alex("Ci sei?")], 2],
  ])("counts the unanswered messages of %j", (messages, count) => {
    expect(unansweredMessages(messages)).toBe(count);
  });
});

describe("activityOf", () => {
  it("counts what the prospect wrote since the previous analysis", () => {
    expect(
      activityOf(
        [alex("Ciao"), prospect("Ciao!")],
        [alex("Ti va di sentirci?"), prospect("Sì"), alex("Perfetto")],
      ),
    ).toStrictEqual({ newProspectMessages: 1, unansweredMessages: 1 });
  });
});

describe("transition", () => {
  it("follows the model's reading", () => {
    expect(transition(null, DISCOVERY, activity(1, 0))).toStrictEqual({
      state: DISCOVERY,
      pause: null,
    });
  });

  it("stops at a request not to be contacted", () => {
    const stop = reading({ intent: "DO_NOT_CONTACT", stage: "ENGAGED" });

    expect(transition(DISCOVERY, stop, activity(1, 0))).toStrictEqual({
      state: { ...stop, stage: "DO_NOT_CONTACT" },
      pause: "DO_NOT_CONTACT",
    });
  });

  it("keeps it until the prospect writes again", () => {
    const stopped = reading({
      stage: "DO_NOT_CONTACT",
      intent: "DO_NOT_CONTACT",
    });

    expect(transition(stopped, DISCOVERY, activity(0, 1))).toStrictEqual({
      state: stopped,
      pause: "DO_NOT_CONTACT",
    });
    expect(transition(stopped, DISCOVERY, activity(1, 0))).toStrictEqual({
      state: DISCOVERY,
      pause: null,
    });
  });

  it("suggests a kind closing to someone not interested, then stops", () => {
    const notInterested = reading({
      stage: "NOT_INTERESTED",
      intent: "NOT_INTERESTED",
      nextGoal: "CLOSE_GRACEFULLY",
    });

    expect(transition(DISCOVERY, notInterested, activity(1, 0))).toStrictEqual({
      state: notInterested,
      pause: null,
    });
    expect(
      transition(notInterested, notInterested, activity(0, 1)),
    ).toStrictEqual({ state: notInterested, pause: "CLOSED" });
    // Even if the model reads the silence differently.
    expect(transition(notInterested, DISCOVERY, activity(0, 1))).toStrictEqual({
      state: notInterested,
      pause: "CLOSED",
    });
  });

  it("does not suggest another closing when Alex already sent one", () => {
    const notInterested = reading({ stage: "NOT_INTERESTED" });

    expect(transition(DISCOVERY, notInterested, activity(1, 1))).toStrictEqual({
      state: notInterested,
      pause: "CLOSED",
    });
  });

  it("listens again to a prospect who writes back after saying no", () => {
    const notInterested = reading({ stage: "NOT_INTERESTED" });

    expect(transition(notInterested, DISCOVERY, activity(1, 0))).toStrictEqual({
      state: DISCOVERY,
      pause: null,
    });
  });

  it("allows two follow-ups without a reply", () => {
    expect(transition(DISCOVERY, DISCOVERY, activity(0, 2))).toStrictEqual({
      state: DISCOVERY,
      pause: null,
    });
  });

  it("stops after the second follow-up without a reply", () => {
    expect(transition(DISCOVERY, DISCOVERY, activity(0, 3))).toStrictEqual({
      state: { ...DISCOVERY, stage: "GHOSTED" },
      pause: "FOLLOW_UP_LIMIT",
    });
  });
});
