// How the state of a conversation moves after an analysis. The model reads
// the conversation; these rules decide what the bot may do with that
// reading, so that it never pushes where Alex should stop.
import type { ConversationMessage, ConversationState } from "./domain.ts";

/** Follow-ups allowed after a message that got no reply (Alex's choice). */
export const MAX_FOLLOW_UPS = 2;

/** What the latest messages say about the conversation, in numbers. */
export type Activity = Readonly<{
  /** Messages the prospect wrote since the previous analysis. */
  newProspectMessages: number;
  /** Alex's messages after the prospect's last one, still unanswered. */
  unansweredMessages: number;
}>;

/** Why the bot suggests no message now. */
export type Pause =
  /** The prospect asked not to be contacted. */
  | "DO_NOT_CONTACT"
  /** The prospect is not interested and Alex has already closed kindly. */
  | "CLOSED"
  /** Alex has already sent every follow-up allowed without a reply. */
  | "FOLLOW_UP_LIMIT";

export type Transition = Readonly<{
  /** The state to remember. */
  state: ConversationState;
  /** Why no message should be suggested now; null when Alex can write. */
  pause: Pause | null;
}>;

/** Alex's messages at the end of the conversation, after the prospect's. */
export const unansweredMessages = (
  messages: readonly ConversationMessage[],
): number => {
  const lastFromProspect = messages.findLastIndex(
    (message) => message.author === "PROSPECT",
  );
  return messages.length - lastFromProspect - 1;
};

export const activityOf = (
  stored: readonly ConversationMessage[],
  added: readonly ConversationMessage[],
): Activity => ({
  newProspectMessages: added.filter((message) => message.author === "PROSPECT")
    .length,
  unansweredMessages: unansweredMessages([...stored, ...added]),
});

/**
 * The state after an analysis. The model's reading wins, except where it
 * would lead Alex to write when it is time to stop: the prospect asked not to
 * be contacted, already received a kind closing message, or has not answered
 * too many follow-ups. Each of these holds until the prospect writes again.
 */
export const transition = (
  previous: ConversationState | null,
  reading: ConversationState,
  activity: Activity,
): Transition => {
  const prospectWroteAgain = activity.newProspectMessages > 0;
  const waitingForReply = activity.unansweredMessages > 0;

  // Nothing new from the prospect: earlier decisions still hold.
  if (previous !== null && !prospectWroteAgain) {
    if (previous.stage === "DO_NOT_CONTACT") {
      return { state: previous, pause: "DO_NOT_CONTACT" };
    }
    if (previous.stage === "NOT_INTERESTED" && waitingForReply) {
      return { state: previous, pause: "CLOSED" };
    }
  }

  if (
    reading.stage === "DO_NOT_CONTACT" ||
    reading.intent === "DO_NOT_CONTACT"
  ) {
    return {
      state: { ...reading, stage: "DO_NOT_CONTACT" },
      pause: "DO_NOT_CONTACT",
    };
  }
  if (reading.stage === "NOT_INTERESTED" && waitingForReply) {
    return { state: reading, pause: "CLOSED" };
  }
  // The first message is not a follow-up: it is the one waiting for a reply.
  if (activity.unansweredMessages > MAX_FOLLOW_UPS) {
    return {
      state: { ...reading, stage: "GHOSTED" },
      pause: "FOLLOW_UP_LIMIT",
    };
  }
  return { state: reading, pause: null };
};
