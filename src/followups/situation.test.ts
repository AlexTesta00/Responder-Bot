import { describe, expect, it } from "vitest";

import {
  CONVERSATION_INTENTS,
  CONVERSATION_STAGES,
  type ConversationState,
} from "../conversations/domain.ts";
import { MAX_FOLLOW_UPS } from "../conversations/transition.ts";
import { romeDay } from "../shared/time.ts";
import { pauseFor, type Contact } from "./contact.ts";
import {
  BUSY_WAIT_DAYS,
  FOLLOW_UP_WAIT_DAYS,
  situationOf,
  waitBefore,
  type Situation,
} from "./situation.ts";

// Alex's latest message: Thursday 24 September, 10:00 in Italy.
const SENT = new Date("2026-09-24T08:00:00Z");
const REPLIED = new Date("2026-09-23T08:00:00Z");

/** `days` calendar days after SENT, at 22:30 in Italy. */
const later = (days: number): Date =>
  new Date(SENT.getTime() + days * 86_400_000 + 12.5 * 3_600_000);

const ENGAGED: ConversationState = {
  stage: "ENGAGED",
  intent: "INTERESTED",
  interest: "MEDIUM",
  nextGoal: "UNDERSTAND_PROCESS",
};

const contact = (unanswered: number): Contact => ({
  unanswered,
  followUpsSent: Math.max(0, unanswered - 1),
  lastOutboundAt: unanswered === 0 ? null : SENT,
  pending: [],
  lastContact: null,
});

const situation = (
  conversation: ConversationState | null,
  unanswered: number,
  days: number,
  lastProspectMessageAt: Date | null = REPLIED,
): Situation =>
  situationOf(
    { conversation, contact: contact(unanswered), lastProspectMessageAt },
    later(days),
  );

describe("situationOf", () => {
  it("waits 3 days before the first follow-up and 5 before the last", () => {
    expect(FOLLOW_UP_WAIT_DAYS).toStrictEqual([3, 5]);
    expect(FOLLOW_UP_WAIT_DAYS).toHaveLength(MAX_FOLLOW_UPS);
    expect(situation(ENGAGED, 1, 2)).toStrictEqual({
      type: "WAITING",
      number: 1,
      lastOutboundAt: SENT,
      dueDay: romeDay(SENT) + 3,
    });
    expect(situation(ENGAGED, 1, 3)).toStrictEqual({
      type: "FOLLOW_UP_DUE",
      number: 1,
      lastOutboundAt: SENT,
    });
    expect(situation(ENGAGED, 2, 4)).toMatchObject({
      type: "WAITING",
      number: 2,
    });
    expect(situation(ENGAGED, 2, 5)).toMatchObject({
      type: "FOLLOW_UP_DUE",
      number: 2,
    });
  });

  it("waits at least a week for a prospect who is busy", () => {
    expect(BUSY_WAIT_DAYS).toBe(7);
    expect(situation({ ...ENGAGED, intent: "BUSY" }, 1, 6)).toMatchObject({
      type: "WAITING",
    });
    expect(situation({ ...ENGAGED, stage: "BUSY" }, 1, 7)).toMatchObject({
      type: "FOLLOW_UP_DUE",
    });
  });

  it("gives Alex the turn when the prospect wrote last", () => {
    expect(situation(ENGAGED, 0, 0)).toStrictEqual({
      type: "TO_REPLY",
      since: REPLIED,
    });
    // A kind closing is still due, and a client who writes gets an answer.
    expect(
      situation({ ...ENGAGED, stage: "NOT_INTERESTED" }, 0, 0),
    ).toMatchObject({ type: "TO_REPLY" });
    expect(situation({ ...ENGAGED, stage: "WON" }, 0, 0)).toMatchObject({
      type: "TO_REPLY",
    });
  });

  it("knows the profiles still to contact", () => {
    expect(situation(null, 0, 0, null)).toStrictEqual({ type: "TO_CONTACT" });
    expect(situation(null, 1, 3, null)).toMatchObject({
      type: "FOLLOW_UP_DUE",
      number: 1,
    });
  });

  it("sends no sales follow-ups to clients", () => {
    expect(situation({ ...ENGAGED, stage: "WON" }, 1, 10)).toStrictEqual({
      type: "WON",
    });
  });

  it("stops where the transition rules stop", () => {
    expect(situation(ENGAGED, 3, 10)).toStrictEqual({
      type: "PAUSED",
      pause: "FOLLOW_UP_LIMIT",
    });
    expect(
      situation({ ...ENGAGED, stage: "DO_NOT_CONTACT" }, 0, 10),
    ).toStrictEqual({ type: "PAUSED", pause: "DO_NOT_CONTACT" });
    expect(
      situation({ ...ENGAGED, stage: "NOT_INTERESTED" }, 1, 10),
    ).toStrictEqual({ type: "PAUSED", pause: "CLOSED" });
  });

  it("never proposes a follow-up the rules or the waits forbid", () => {
    const readings: readonly (ConversationState | null)[] = [
      null,
      ...CONVERSATION_STAGES.flatMap((stage) =>
        CONVERSATION_INTENTS.map((intent) => ({ ...ENGAGED, stage, intent })),
      ),
    ];
    for (const conversation of readings) {
      for (let unanswered = 0; unanswered <= 4; unanswered += 1) {
        for (let days = 0; days <= 10; days += 1) {
          for (const wrote of [REPLIED, null]) {
            const found = situation(conversation, unanswered, days, wrote);
            const pause = pauseFor(conversation, unanswered);

            expect(found.type === "PAUSED").toBe(pause !== null);
            if (found.type === "FOLLOW_UP_DUE") {
              const busy =
                conversation?.stage === "BUSY" ||
                conversation?.intent === "BUSY";
              expect(unanswered).toBeGreaterThanOrEqual(1);
              expect(unanswered).toBeLessThanOrEqual(MAX_FOLLOW_UPS);
              expect(days).toBeGreaterThanOrEqual(
                Math.max(waitBefore(found.number), busy ? BUSY_WAIT_DAYS : 0),
              );
              expect(conversation?.stage).not.toBe("WON");
            }
          }
        }
      }
    }
  });
});
