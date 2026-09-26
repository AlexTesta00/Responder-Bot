// The vocabulary of a sales conversation, shared by the AI engine and, in
// later sprints, by prospect memory and conversation state.

/**
 * Where the relationship with a prospect stands. The main path goes from
 * NEW_PROSPECT to WON; the side states can happen at any point, and a
 * conversation does not have to walk through every stage.
 */
export const CONVERSATION_STAGES = [
  "NEW_PROSPECT",
  "OPENING",
  "ENGAGED",
  "DISCOVERY",
  "NEED_IDENTIFIED",
  "VALUE",
  "SOLUTION",
  "CALL",
  "QUOTE",
  "WON",
  "GHOSTED",
  "BUSY",
  "SKEPTICAL",
  "PRICE_OBJECTION",
  "ALREADY_HAS_PROVIDER",
  "NOT_INTERESTED",
  "DO_NOT_CONTACT",
] as const;

export type ConversationStage = (typeof CONVERSATION_STAGES)[number];

/** What the prospect is communicating with their latest message. */
export const CONVERSATION_INTENTS = [
  "CURIOUS",
  "INTERESTED",
  "NEUTRAL",
  "POSITIVE",
  "SKEPTICAL",
  "CONFUSED",
  "BUSY",
  "PRICE_REQUEST",
  "PRICE_OBJECTION",
  "ALREADY_HAS_PROVIDER",
  "ASKING_FOR_MORE_INFO",
  "READY_FOR_CALL",
  "NOT_INTERESTED",
  "DO_NOT_CONTACT",
  "UNKNOWN",
] as const;

export type ConversationIntent = (typeof CONVERSATION_INTENTS)[number];

/** The single micro-objective of Alex's next message. */
export const NEXT_GOALS = [
  "GET_REPLY",
  "UNDERSTAND_PROCESS",
  "VALIDATE_PROBLEM",
  "UNDERSTAND_IMPACT",
  "CREATE_INTEREST",
  "EXPLAIN_VALUE",
  "EXPLAIN_SOLUTION",
  "ANSWER_OBJECTION",
  "DISCUSS_PRICE",
  "PROPOSE_CALL",
  "SCHEDULE_CALL",
  "CLOSE_GRACEFULLY",
] as const;

export type NextGoal = (typeof NEXT_GOALS)[number];

export type MessageAuthor = "ALEX" | "PROSPECT";

/** A message of the Instagram conversation between Alex and a prospect. */
export type ConversationMessage = Readonly<{
  author: MessageAuthor;
  text: string;
}>;

/** Something Alex or the prospect said they would do, not done yet. */
export type Commitment = Readonly<{
  by: MessageAuthor;
  text: string;
}>;

/** Judged from concrete signals (asking for prices, examples, a call), not tone. */
export const INTEREST_LEVELS = ["UNKNOWN", "LOW", "MEDIUM", "HIGH"] as const;

export type InterestLevel = (typeof INTEREST_LEVELS)[number];

/** A move of the conversation from one stage to another. */
export type StageChange = Readonly<{
  /** Null for the first stage a prospect gets. */
  from: ConversationStage | null;
  to: ConversationStage;
  at: Date;
}>;

/** Where the conversation stands, as the latest analysis read it. */
export type ConversationState = Readonly<{
  stage: ConversationStage;
  intent: ConversationIntent;
  interest: InterestLevel;
  nextGoal: NextGoal;
}>;
