import { describe, expect, it } from "vitest";

import type {
  ConversationMessage,
  ConversationState,
} from "../conversations/domain.ts";
import { memoryOf } from "../prospects/memory.test-support.ts";
import type { ContactFacts, Prospect, Send } from "../prospects/memory.ts";
import {
  AWAITING_FIRST_REPLY,
  contactOf,
  contactOfMemory,
  pauseFor,
  unansweredAfter,
} from "./contact.ts";

/** Day `n` of September 2026, at 10:00 UTC. */
const t = (n: number): Date => new Date(Date.UTC(2026, 8, n, 10));

const send = (n: number): Send => ({
  kind: "REPLIES",
  style: "BEST",
  text: null,
  sentAt: t(n),
});

const facts = (fields: Partial<ContactFacts>): ContactFacts => ({
  lastProspectMessageAt: null,
  lastAlexMessageAt: null,
  lastMessageAt: null,
  sends: [],
  ...fields,
});

const ENGAGED: ConversationState = {
  stage: "ENGAGED",
  intent: "INTERESTED",
  interest: "MEDIUM",
  nextGoal: "UNDERSTAND_PROCESS",
};

describe("contactOf", () => {
  // Step by step, a prospect Alex writes to after the profile alone.
  it.each<[string, number, ContactFacts, number, Date | null]>([
    ["first message marked as sent", 0, facts({ sends: [send(1)] }), 1, t(1)],
    [
      "a screenshot shows it, unanswered",
      1,
      facts({ lastAlexMessageAt: t(2), lastMessageAt: t(2), sends: [send(1)] }),
      1,
      // The tap is when it was sent, not the screenshot.
      t(1),
    ],
    [
      "the prospect replies",
      0,
      facts({
        lastProspectMessageAt: t(3),
        lastAlexMessageAt: t(2),
        lastMessageAt: t(3),
      }),
      0,
      null,
    ],
    [
      "Alex's reply marked as sent",
      0,
      facts({
        lastProspectMessageAt: t(3),
        lastAlexMessageAt: t(2),
        lastMessageAt: t(3),
        sends: [send(4)],
      }),
      1,
      t(4),
    ],
    [
      "the first follow-up marked as sent",
      0,
      facts({
        lastProspectMessageAt: t(3),
        lastAlexMessageAt: t(2),
        lastMessageAt: t(3),
        sends: [send(4), send(5)],
      }),
      2,
      t(5),
    ],
    [
      "a cropped screenshot shows only the follow-up",
      1,
      facts({
        lastProspectMessageAt: t(3),
        lastAlexMessageAt: t(6),
        lastMessageAt: t(6),
        sends: [send(4), send(5)],
      }),
      // Not 1: the reply before the follow-up is still unanswered.
      2,
      t(5),
    ],
    [
      "the second follow-up marked as sent",
      1,
      facts({
        lastProspectMessageAt: t(3),
        lastAlexMessageAt: t(6),
        lastMessageAt: t(6),
        sends: [send(4), send(5), send(7)],
      }),
      3,
      t(7),
    ],
    [
      "the prospect writes again",
      0,
      facts({
        lastProspectMessageAt: t(8),
        lastAlexMessageAt: t(6),
        lastMessageAt: t(8),
      }),
      0,
      null,
    ],
  ])(
    "%s",
    (_step, storedUnanswered, contactFacts, unanswered, lastOutboundAt) => {
      const contact = contactOf(storedUnanswered, contactFacts);

      expect(contact.unanswered).toBe(unanswered);
      expect(contact.followUpsSent).toBe(Math.max(0, unanswered - 1));
      expect(contact.lastOutboundAt).toStrictEqual(lastOutboundAt);
    },
  );

  it("waits from the analysis for a message Alex never marked", () => {
    expect(
      contactOf(1, facts({ lastAlexMessageAt: t(2), lastMessageAt: t(2) })),
    ).toMatchObject({ unanswered: 1, lastOutboundAt: t(2) });
  });

  it("lists the sends no analysis has seen yet", () => {
    expect(
      contactOf(
        1,
        facts({
          lastAlexMessageAt: t(2),
          lastMessageAt: t(2),
          sends: [send(1), send(3)],
        }),
      ).pending,
    ).toStrictEqual([send(3)]);
  });

  it("knows who wrote last", () => {
    expect(
      contactOf(
        0,
        facts({
          lastProspectMessageAt: t(3),
          lastAlexMessageAt: t(2),
          lastMessageAt: t(3),
        }),
      ).lastContact,
    ).toStrictEqual({ at: t(3), by: "PROSPECT" });
    expect(contactOf(0, facts({ sends: [send(4)] })).lastContact).toStrictEqual(
      { at: t(4), by: "ALEX" },
    );
    expect(contactOf(0, facts({})).lastContact).toBeNull();
  });

  it("never counts fewer unanswered messages than the screenshots show", () => {
    for (let stored = 0; stored <= 3; stored += 1) {
      for (let before = 0; before <= 3; before += 1) {
        for (let later = 0; later <= 2; later += 1) {
          const sends = [
            ...Array.from({ length: before }, (_, index) => send(2 + index)),
            ...Array.from({ length: later }, (_, index) => send(20 + index)),
          ];
          const contact = contactOf(
            stored,
            facts({
              lastAlexMessageAt: stored > 0 ? t(10) : null,
              lastMessageAt: t(10),
              sends,
            }),
          );

          expect(contact.unanswered).toBeGreaterThanOrEqual(stored);
          expect(contact.unanswered).toBeGreaterThanOrEqual(later);
        }
      }
    }
  });
});

describe("unansweredAfter", () => {
  const prospect: Prospect = {
    id: "prospect-1",
    username: "mariofit",
    displayName: null,
    businessType: null,
    facts: [],
    hypotheses: [],
    conversation: ENGAGED,
    summary: null,
    objections: [],
    commitments: [],
    createdAt: t(1),
    updatedAt: t(3),
  };
  const alex = (text: string): ConversationMessage => ({
    author: "ALEX",
    text,
  });
  const them = (text: string): ConversationMessage => ({
    author: "PROSPECT",
    text,
  });
  const memory = memoryOf({ prospect, messages: [them("Quanto costa?")] }, [
    send(4),
    send(5),
  ]);

  it("keeps the marked sends when the analysis added nothing", () => {
    expect(unansweredAfter(memory, [])).toBe(
      contactOfMemory(memory).unanswered,
    );
    expect(unansweredAfter(memory, [])).toBe(2);
  });

  it("starts again when the prospect wrote", () => {
    expect(unansweredAfter(memory, [alex("Ciao"), them("Eccomi")])).toBe(0);
  });

  it("counts the marked sends among Alex's messages the analysis added", () => {
    expect(unansweredAfter(memory, [alex("Ti mando un esempio?")])).toBe(2);
    expect(
      unansweredAfter(memory, [alex("Uno"), alex("Due"), alex("Tre")]),
    ).toBe(3);
  });

  it("counts a new prospect's messages", () => {
    expect(unansweredAfter(null, [alex("Ciao Mario!")])).toBe(1);
  });
});

describe("pauseFor", () => {
  it.each<[ConversationState | null, number, string | null]>([
    [null, 0, null],
    [null, 2, null],
    // Written to after the profile alone: the same limit of follow-ups.
    [null, 3, "FOLLOW_UP_LIMIT"],
    [ENGAGED, 2, null],
    [ENGAGED, 3, "FOLLOW_UP_LIMIT"],
    [{ ...ENGAGED, stage: "DO_NOT_CONTACT" }, 0, "DO_NOT_CONTACT"],
    [{ ...ENGAGED, stage: "NOT_INTERESTED" }, 1, "CLOSED"],
    [{ ...ENGAGED, stage: "NOT_INTERESTED" }, 0, null],
  ])("pauses %j with %i unanswered: %s", (conversation, unanswered, pause) => {
    expect(pauseFor(conversation, unanswered)).toBe(pause);
  });

  it("presumes the opening of a conversation, to reach the rules", () => {
    expect(AWAITING_FIRST_REPLY).toStrictEqual({
      stage: "OPENING",
      intent: "UNKNOWN",
      interest: "UNKNOWN",
      nextGoal: "GET_REPLY",
    });
  });
});
