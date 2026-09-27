// Where the contact with a prospect stands: how many of Alex's messages wait
// for a reply and since when. The analyses see some of Alex's messages in
// the screenshots, and Alex marks others as sent: a message can be both,
// so the count never adds them twice, and never goes below what the
// screenshots show.
import type {
  ConversationMessage,
  ConversationState,
  MessageAuthor,
} from "../conversations/domain.ts";
import {
  transition,
  unansweredMessages,
  type Pause,
} from "../conversations/transition.ts";
import type {
  ContactFacts,
  ProspectMemory,
  Send,
} from "../prospects/memory.ts";

export type Contact = Readonly<{
  /** Alex's messages after the prospect's latest one, without a reply. */
  unanswered: number;
  /** Of those, the follow-ups: every one but the first. */
  followUpsSent: number;
  /** When Alex last wrote, while a reply is awaited: waits start here. */
  lastOutboundAt: Date | null;
  /** Sends that no analysis has seen yet, oldest first. */
  pending: readonly Send[];
  /** The latest message of either side, as the bot knows it. */
  lastContact: Readonly<{ at: Date; by: MessageAuthor }> | null;
}>;

const after =
  (time: Date | null) =>
  (send: Send): boolean =>
    time === null || send.sentAt.getTime() > time.getTime();

const latest = (sends: readonly Send[]): Date | null =>
  sends.reduce<Date | null>(
    (last, { sentAt }) =>
      last === null || sentAt.getTime() > last.getTime() ? sentAt : last,
    null,
  );

/**
 * The contact from the facts of the memory. `storedUnanswered` counts
 * Alex's messages at the end of the stored conversation.
 */
export const contactOf = (
  storedUnanswered: number,
  facts: ContactFacts,
): Contact => {
  const relevant = facts.sends.filter(after(facts.lastProspectMessageAt));
  // Marked after the latest analysis that added messages: not seen yet.
  const pending = relevant.filter(after(facts.lastMessageAt));
  const absorbed = relevant.filter((send) => !pending.includes(send));
  const unanswered =
    pending.length + Math.max(storedUnanswered, absorbed.length);

  const lastOutboundAt = (() => {
    if (pending.length > 0) {
      return latest(pending);
    }
    if (unanswered === 0) {
      return null;
    }
    // Every unanswered message seen may be one Alex marked: its tap is the
    // real time. Otherwise one was never marked, and the analysis that saw
    // it is the latest it can have been sent.
    return absorbed.length >= storedUnanswered
      ? latest(absorbed)
      : facts.lastMessageAt;
  })();

  // Messages stored by the same analysis share their time: whose is the
  // latest follows from the count, not from the times.
  const lastContact =
    unanswered > 0 && lastOutboundAt !== null
      ? { at: lastOutboundAt, by: "ALEX" as const }
      : facts.lastProspectMessageAt === null
        ? null
        : { at: facts.lastProspectMessageAt, by: "PROSPECT" as const };

  return {
    unanswered,
    followUpsSent: Math.max(0, unanswered - 1),
    lastOutboundAt,
    pending,
    lastContact,
  };
};

export const contactOfMemory = (memory: ProspectMemory): Contact =>
  contactOf(unansweredMessages(memory.messages), memory.contact);

/**
 * How many of Alex's messages will wait for a reply once an analysis
 * stores the messages it added, as `contactOf` will count them then.
 */
export const unansweredAfter = (
  memory: ProspectMemory | null,
  added: readonly ConversationMessage[],
): number => {
  const all = [...(memory?.messages ?? []), ...added];
  if (memory === null) {
    return unansweredMessages(all);
  }
  if (added.length === 0) {
    return contactOfMemory(memory).unanswered;
  }
  if (added.some(({ author }) => author === "PROSPECT")) {
    return unansweredMessages(all);
  }
  // Only Alex's messages: the sends so far are among them, or before them.
  const sends = memory.contact.sends.filter(
    after(memory.contact.lastProspectMessageAt),
  );
  return Math.max(unansweredMessages(all), sends.length);
};

/**
 * The reading presumed for a prospect Alex wrote to after the profile
 * alone, only to apply the transition rules: it is never stored.
 */
export const AWAITING_FIRST_REPLY: ConversationState = {
  stage: "OPENING",
  intent: "UNKNOWN",
  interest: "UNKNOWN",
  nextGoal: "GET_REPLY",
};

/**
 * Why Alex should not write now, from the transition rules and the count
 * of unanswered messages alone, as for an analysis that saw nothing new.
 */
export const pauseFor = (
  conversation: ConversationState | null,
  unanswered: number,
): Pause | null => {
  const state = conversation ?? (unanswered > 0 ? AWAITING_FIRST_REPLY : null);
  return state === null
    ? null
    : transition(state, state, {
        newProspectMessages: 0,
        unansweredMessages: unanswered,
      }).pause;
};
