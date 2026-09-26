// What the bot remembers about each prospect, and how a new analysis updates
// it. Pure functions: storing the result is the job of a ProspectStore.
import type {
  Commitment,
  ConversationMessage,
  ConversationState,
} from "../conversations/domain.ts";

/** Everything remembered about a prospect, except the messages. */
export type ProspectProfile = Readonly<{
  /** Canonical Instagram username: the identity of the prospect. */
  username: string;
  displayName: string | null;
  businessType: string | null;
  facts: readonly string[];
  hypotheses: readonly string[];
  conversation: ConversationState | null;
  summary: string | null;
  /** Objections the prospect raised that are still open. */
  objections: readonly string[];
  /** Promises of either side still to keep. */
  commitments: readonly Commitment[];
}>;

export type Prospect = ProspectProfile &
  Readonly<{
    id: string;
    createdAt: Date;
    updatedAt: Date;
  }>;

/** A prospect with the latest messages of the conversation, oldest first. */
export type ProspectMemory = Readonly<{
  prospect: Prospect;
  messages: readonly ConversationMessage[];
}>;

/** What one analysis learned about a prospect. */
export type Observation = Readonly<{
  displayName: string | null;
  businessType: string | null;
  facts: readonly string[];
  hypotheses: readonly string[];
  conversation: ConversationState | null;
  summary: string | null;
  /** The open objections now, or null when this analysis cannot tell. */
  objections: readonly string[] | null;
  /** The open promises now, or null when this analysis cannot tell. */
  commitments: readonly Commitment[] | null;
  /** The messages visible in the screenshots, oldest first. */
  messages: readonly ConversationMessage[];
}>;

/** A prospect as it should be stored now, and the messages to add. */
export type MemoryUpdate = Readonly<{
  profile: ProspectProfile;
  newMessages: readonly ConversationMessage[];
}>;

/**
 * Messages kept for each prospect: enough for the context of a reply, while
 * the summary covers what came before. Older ones are deleted.
 */
export const MAX_STORED_MESSAGES = 50;

const MAX_FACTS = 12;
const MAX_HYPOTHESES = 8;
const MAX_OBJECTIONS = 5;
const MAX_COMMITMENTS = 5;

// Characters, as the database counts them.
const MAX_NAME_LENGTH = 100;
const MAX_NOTE_LENGTH = 300;
const MAX_TEXT_LENGTH = 2_000;

const truncate = (text: string, max: number): string => {
  const characters = Array.from(text.trim());
  return characters.length > max
    ? characters.slice(0, max).join("")
    : characters.join("");
};

const optionalText = (text: string | null, max: number): string | null => {
  const truncated = text === null ? "" : truncate(text, max);
  return truncated === "" ? null : truncated;
};

/** Screenshots of the same text can differ in spacing, case or accents. */
const comparable = (text: string): string =>
  text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

const sameMessage = (
  first: ConversationMessage,
  second: ConversationMessage,
): boolean =>
  first.author === second.author &&
  comparable(first.text) === comparable(second.text);

/** Whether `run` matches `messages` starting at `start`. */
const matchesAt = (
  messages: readonly ConversationMessage[],
  run: readonly ConversationMessage[],
  start: number,
): boolean =>
  run.every((message, index) => {
    const other = messages[start + index];
    return other !== undefined && sameMessage(other, message);
  });

/** The longest `length` such that `before` ends with the first messages of `after`. */
const overlap = (
  before: readonly ConversationMessage[],
  after: readonly ConversationMessage[],
): number => {
  for (
    let length = Math.min(before.length, after.length);
    length > 0;
    length -= 1
  ) {
    if (matchesAt(before, after.slice(0, length), before.length - length)) {
      return length;
    }
  }
  return 0;
};

/**
 * The messages seen in new screenshots that the memory does not hold yet.
 * Screenshots of the same chat overlap: what follows the stored messages is
 * new, while an older part of the chat adds nothing, since the summary
 * already covers it.
 */
export const messagesToAppend = (
  stored: readonly ConversationMessage[],
  seen: readonly ConversationMessage[],
): readonly ConversationMessage[] => {
  if (stored.some((_message, start) => matchesAt(stored, seen, start))) {
    // The same messages again, such as a screenshot sent twice.
    return [];
  }
  const continued = overlap(stored, seen);
  if (continued > 0) {
    return seen.slice(continued);
  }
  // Messages that lead into the stored ones come from further up the chat.
  return overlap(seen, stored) > 0 ? [] : seen;
};

/** The new notes first, then the earlier ones not repeated, up to `max`. */
const mergeNotes = (
  latest: readonly string[],
  earlier: readonly string[],
  max: number,
): readonly string[] => {
  const kept = new Set<string>();
  return [...latest, ...earlier]
    .map((note) => truncate(note, MAX_NOTE_LENGTH))
    .filter((note) => {
      const key = comparable(note);
      if (key === "" || kept.has(key)) {
        return false;
      }
      kept.add(key);
      return true;
    })
    .slice(0, max);
};

const currentCommitments = (
  commitments: readonly Commitment[],
): readonly Commitment[] => {
  const kept = new Set<string>();
  return commitments
    .map((commitment) => ({
      by: commitment.by,
      text: truncate(commitment.text, MAX_NOTE_LENGTH),
    }))
    .filter((commitment) => {
      const key = `${commitment.by}:${comparable(commitment.text)}`;
      if (commitment.text === "" || kept.has(key)) {
        return false;
      }
      kept.add(key);
      return true;
    })
    .slice(0, MAX_COMMITMENTS);
};

/**
 * How the memory of a prospect changes after an analysis: what was observed
 * now wins, and what it does not mention is kept from before. Objections and
 * promises are lists the analysis keeps up to date: when it provides them,
 * they replace the earlier ones, since some may have been resolved.
 */
export const remember = (
  username: string,
  memory: ProspectMemory | null,
  observation: Observation,
): MemoryUpdate => {
  const earlier = memory?.prospect ?? null;
  return {
    profile: {
      username,
      displayName:
        optionalText(observation.displayName, MAX_NAME_LENGTH) ??
        earlier?.displayName ??
        null,
      businessType:
        optionalText(observation.businessType, MAX_NAME_LENGTH) ??
        earlier?.businessType ??
        null,
      facts: mergeNotes(observation.facts, earlier?.facts ?? [], MAX_FACTS),
      hypotheses: mergeNotes(
        observation.hypotheses,
        earlier?.hypotheses ?? [],
        MAX_HYPOTHESES,
      ),
      conversation: observation.conversation ?? earlier?.conversation ?? null,
      summary:
        optionalText(observation.summary, MAX_TEXT_LENGTH) ??
        earlier?.summary ??
        null,
      objections:
        observation.objections === null
          ? (earlier?.objections ?? [])
          : mergeNotes(observation.objections, [], MAX_OBJECTIONS),
      commitments:
        observation.commitments === null
          ? (earlier?.commitments ?? [])
          : currentCommitments(observation.commitments),
    },
    newMessages: messagesToAppend(memory?.messages ?? [], observation.messages)
      .map((message) => ({
        author: message.author,
        text: truncate(message.text, MAX_TEXT_LENGTH),
      }))
      .filter((message) => message.text !== ""),
  };
};
