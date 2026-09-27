// What Alex should do next with a prospect: reply, write the first
// message, send a follow-up now or later, or nothing. Stricter than the
// transition rules, never looser: a follow-up is due only after waiting,
// and never for a paused conversation or a client.
import type { ConversationState } from "../conversations/domain.ts";
import type { Pause } from "../conversations/transition.ts";
import type { ProspectMemory } from "../prospects/memory.ts";
import { romeDay, type RomeDay } from "../shared/time.ts";
import { contactOfMemory, pauseFor, type Contact } from "./contact.ts";

/**
 * Calendar days to wait before each follow-up, from Alex's latest message:
 * 3 before the first, 5 more before the second and last, as Alex chose.
 */
export const FOLLOW_UP_WAIT_DAYS = [3, 5] as const;

/** The days to wait before the follow-up `number`. */
export const waitBefore = (number: 1 | 2): number =>
  number === 1 ? FOLLOW_UP_WAIT_DAYS[0] : FOLLOW_UP_WAIT_DAYS[1];

/** At least this long for a prospect who said they are busy. */
export const BUSY_WAIT_DAYS = 7;

export type Situation =
  /** The transition rules say Alex should not write now. */
  | Readonly<{ type: "PAUSED"; pause: Pause }>
  /** The prospect wrote last: it is Alex's turn. */
  | Readonly<{ type: "TO_REPLY"; since: Date }>
  /** A profile Alex has not written to yet. */
  | Readonly<{ type: "TO_CONTACT" }>
  /** A client waiting to reply: no sales follow-ups. */
  | Readonly<{ type: "WON" }>
  /** The wait is over: the follow-up `number` of 2 can be sent. */
  | Readonly<{ type: "FOLLOW_UP_DUE"; number: 1 | 2; lastOutboundAt: Date }>
  /** A reply is awaited; the follow-up `number` is due from `dueDay`. */
  | Readonly<{
      type: "WAITING";
      number: 1 | 2;
      lastOutboundAt: Date;
      dueDay: RomeDay;
    }>;

export type SituationFacts = Readonly<{
  conversation: ConversationState | null;
  contact: Contact;
  lastProspectMessageAt: Date | null;
}>;

const busy = (conversation: ConversationState | null): boolean =>
  conversation?.stage === "BUSY" || conversation?.intent === "BUSY";

export const situationOf = (
  { conversation, contact, lastProspectMessageAt }: SituationFacts,
  now: Date,
): Situation => {
  const { unanswered } = contact;
  const pause = pauseFor(conversation, unanswered);
  if (pause !== null) {
    return { type: "PAUSED", pause };
  }
  if (unanswered === 0) {
    return lastProspectMessageAt === null
      ? { type: "TO_CONTACT" }
      : { type: "TO_REPLY", since: lastProspectMessageAt };
  }
  if (conversation?.stage === "WON") {
    return { type: "WON" };
  }
  // More would already be a pause: the next follow-up is the first or the last.
  const number = unanswered === 1 ? 1 : 2;
  const wait = Math.max(
    waitBefore(number),
    busy(conversation) ? BUSY_WAIT_DAYS : 0,
  );
  const lastOutboundAt = contact.lastOutboundAt ?? now;
  const dueDay = romeDay(lastOutboundAt) + wait;
  return romeDay(now) >= dueDay
    ? { type: "FOLLOW_UP_DUE", number, lastOutboundAt }
    : { type: "WAITING", number, lastOutboundAt, dueDay };
};

export const situationOfMemory = (
  memory: ProspectMemory,
  now: Date,
): Situation =>
  situationOf(
    {
      conversation: memory.prospect.conversation,
      contact: contactOfMemory(memory),
      lastProspectMessageAt: memory.contact.lastProspectMessageAt,
    },
    now,
  );
