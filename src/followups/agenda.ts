// The day's agenda: every prospect in the one section that says what Alex
// should do next, in the order to do it. Built from the memory alone: the
// lists never call the AI.
import type {
  ConversationIntent,
  InterestLevel,
} from "../conversations/domain.ts";
import type { Prospect, ProspectOverview } from "../prospects/memory.ts";
import type { Contact } from "./contact.ts";
import { standingOf, type Situation } from "./situation.ts";

type SituationType = Situation["type"];

/** A prospect in a section of the agenda, with its situation. */
export type AgendaEntry<T extends SituationType = SituationType> = Readonly<{
  prospect: Prospect;
  contact: Contact;
  situation: Extract<Situation, Readonly<{ type: T }>>;
}>;

export type Agenda = Readonly<{
  /** It is Alex's turn: the hottest first, then the latest reply. */
  reply: readonly AgendaEntry<"TO_REPLY">[];
  /** Follow-ups due: the longest overdue first. */
  followUp: readonly AgendaEntry<"FOLLOW_UP_DUE">[];
  /** Replies awaited: the next follow-up due first. */
  waiting: readonly AgendaEntry<"WAITING">[];
  /** Profiles Alex has not written to: the latest analyzed first. */
  toContact: readonly AgendaEntry<"TO_CONTACT">[];
  /** Stopped by the rules: the latest activity first. */
  paused: readonly AgendaEntry<"PAUSED">[];
  /** Clients who owe a reply: the latest activity first. */
  won: readonly AgendaEntry<"WON">[];
}>;

/** Intents that most call for an answer. */
const HOT_INTENTS: ReadonlySet<ConversationIntent> = new Set([
  "PRICE_REQUEST",
  "READY_FOR_CALL",
  "ASKING_FOR_MORE_INFO",
]);

const INTEREST_ORDER: readonly InterestLevel[] = [
  "HIGH",
  "MEDIUM",
  "LOW",
  "UNKNOWN",
];

type Order<T> = (first: T, second: T) => number;

/** Each order in turn, until one tells the two apart. */
const inTurn =
  <T>(...orders: readonly Order<T>[]): Order<T> =>
  (first, second) =>
    orders.reduce(
      (found, order) => (found === 0 ? order(first, second) : found),
      0,
    );

const ascending =
  <T>(key: (entry: T) => number): Order<T> =>
  (first, second) =>
    key(first) - key(second);

const descending =
  <T>(key: (entry: T) => number): Order<T> =>
  (first, second) =>
    key(second) - key(first);

/** The last tie-breaker: the same prospects always come in the same order. */
const byUsername: Order<AgendaEntry> = (first, second) =>
  first.prospect.username < second.prospect.username
    ? -1
    : first.prospect.username > second.prospect.username
      ? 1
      : 0;

const coldness = ({ prospect }: AgendaEntry): number =>
  prospect.conversation !== null &&
  HOT_INTENTS.has(prospect.conversation.intent)
    ? 0
    : 1;

const interestRank = ({ prospect }: AgendaEntry): number =>
  INTEREST_ORDER.indexOf(prospect.conversation?.interest ?? "UNKNOWN");

const repliedAt = ({ situation }: AgendaEntry<"TO_REPLY">): number =>
  situation.since.getTime();

const dueDay = ({
  situation,
}: AgendaEntry<"FOLLOW_UP_DUE" | "WAITING">): number => situation.dueDay;

const analyzedAt = ({ prospect }: AgendaEntry): number =>
  prospect.updatedAt.getTime();

/** When anything last happened with the prospect, as the bot knows it. */
const activityAt = ({ prospect, contact }: AgendaEntry): number =>
  Math.max(
    prospect.updatedAt.getTime(),
    contact.lastContact?.at.getTime() ?? 0,
  );

const isIn =
  <T extends SituationType>(type: T) =>
  (entry: AgendaEntry): entry is AgendaEntry<T> =>
    entry.situation.type === type;

export const agendaOf = (
  overviews: readonly ProspectOverview[],
  now: Date,
): Agenda => {
  const entries: readonly AgendaEntry[] = overviews.map((overview) => ({
    prospect: overview.prospect,
    ...standingOf(overview, now),
  }));
  const latestActivity = inTurn(descending(activityAt), byUsername);
  return {
    reply: entries
      .filter(isIn("TO_REPLY"))
      .toSorted(
        inTurn<AgendaEntry<"TO_REPLY">>(
          ascending(coldness),
          ascending(interestRank),
          descending(repliedAt),
          byUsername,
        ),
      ),
    followUp: entries
      .filter(isIn("FOLLOW_UP_DUE"))
      .toSorted(
        inTurn<AgendaEntry<"FOLLOW_UP_DUE">>(
          ascending(dueDay),
          ascending(interestRank),
          byUsername,
        ),
      ),
    waiting: entries
      .filter(isIn("WAITING"))
      .toSorted(
        inTurn<AgendaEntry<"WAITING">>(
          ascending(dueDay),
          ascending(interestRank),
          byUsername,
        ),
      ),
    toContact: entries
      .filter(isIn("TO_CONTACT"))
      .toSorted(inTurn(descending(analyzedAt), byUsername)),
    paused: entries.filter(isIn("PAUSED")).toSorted(latestActivity),
    won: entries.filter(isIn("WON")).toSorted(latestActivity),
  };
};

/** The first entries a list shows, and how many it leaves out. */
export const firstOf = <T>(
  entries: readonly T[],
  limit: number,
): Readonly<{ shown: readonly T[]; more: number }> => ({
  shown: entries.slice(0, limit),
  more: Math.max(0, entries.length - limit),
});
