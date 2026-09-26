import { z } from "zod";

import {
  CONVERSATION_INTENTS,
  CONVERSATION_STAGES,
  INTEREST_LEVELS,
  NEXT_GOALS,
  type Commitment,
  type ConversationIntent,
  type ConversationMessage,
  type ConversationStage,
  type InterestLevel,
  type NextGoal,
} from "../conversations/domain.ts";
import { canonicalUsername } from "../inputs/instagram.ts";
import { err, ok, type Result } from "../shared/result.ts";

// Structured outputs requested from the model. Property order matters: the
// model writes the analysis before the messages it suggests.

const prospectOutput = z.object({
  username: z.string().nullable(),
  display_name: z.string().nullable(),
  business_type: z.string().nullable(),
});

const conversationOutput = z.object({
  last_prospect_message: z.string().nullable(),
  stage: z.enum(CONVERSATION_STAGES),
  intent: z.enum(CONVERSATION_INTENTS),
  interest: z.enum(INTEREST_LEVELS),
  next_goal: z.enum(NEXT_GOALS),
  rationale: z.string(),
});

const authorOutput = z.enum(["ALEX", "PROSPECT"]);

const messageOutput = z.object({ author: authorOutput, text: z.string() });

const commitmentOutput = z.object({ by: authorOutput, text: z.string() });

const firstMessagesOutput = z.object({
  best: z.string(),
  curiosity: z.string(),
  natural: z.string(),
});

const repliesOutput = z.object({
  best: z.string(),
  alternative: z.string(),
  direct: z.string(),
});

/** Output of the quick look that recognizes the prospect first. */
export const prospectIdentityOutputSchema = z.object({
  username: z.string().nullable(),
  display_name: z.string().nullable(),
});

export type ProspectIdentityOutput = z.infer<
  typeof prospectIdentityOutputSchema
>;

/** Output for a batch of screenshots, whatever they show. */
export const screenshotsOutputSchema = z.object({
  kind: z.enum(["PROFILE", "CONVERSATION", "UNRELATED"]),
  prospect: prospectOutput.nullable(),
  // The transcription comes first: the analysis relies on it.
  messages: z.array(messageOutput).nullable(),
  observed_facts: z.array(z.string()),
  hypotheses: z.array(z.string()),
  conversation: conversationOutput.nullable(),
  objections: z.array(z.string()),
  commitments: z.array(commitmentOutput),
  summary: z.string().nullable(),
  first_messages: firstMessagesOutput.nullable(),
  replies: repliesOutput.nullable(),
  note: z.string().nullable(),
});

export type ScreenshotsOutput = z.infer<typeof screenshotsOutputSchema>;

/** Output for a conversation pasted as text. */
export const conversationReplyOutputSchema = z.object({
  messages: z.array(messageOutput),
  observed_facts: z.array(z.string()),
  hypotheses: z.array(z.string()),
  conversation: conversationOutput,
  objections: z.array(z.string()),
  commitments: z.array(commitmentOutput),
  summary: z.string().nullable(),
  replies: repliesOutput.nullable(),
  note: z.string().nullable(),
});

export type ConversationReplyOutput = z.infer<
  typeof conversationReplyOutputSchema
>;

/** Output for new suggestions, asked with a button: no analysis. */
export const newSuggestionsOutputSchema = z.object({
  first_messages: firstMessagesOutput.nullable(),
  replies: repliesOutput.nullable(),
  note: z.string().nullable(),
});

export type NewSuggestionsOutput = z.infer<typeof newSuggestionsOutputSchema>;

// The same content in the bot's own types.

export type SuggestionStyle =
  "BEST" | "CURIOSITY" | "NATURAL" | "ALTERNATIVE" | "DIRECT";

export type Suggestion = Readonly<{ style: SuggestionStyle; text: string }>;

/**
 * What a set of suggestions is for: opening a conversation (BEST,
 * CURIOSITY, NATURAL), replying in one (BEST, ALTERNATIVE, DIRECT), or
 * following up a message without a reply, shaped like the replies.
 */
export type SuggestionKind = "FIRST_MESSAGES" | "REPLIES" | "FOLLOW_UPS";

/** New suggestions written from the memory, with a note when there are none. */
export type NewSuggestions = Readonly<{
  suggestions: readonly Suggestion[];
  note: string | null;
}>;

/** Who the screenshots are about, as far as they show it. */
export type ProspectIdentity = Readonly<{
  /** Canonical username, or null when none is visible. */
  username: string | null;
  displayName: string | null;
}>;

export type ProspectSnapshot = Readonly<{
  username: string | null;
  displayName: string | null;
  businessType: string | null;
}>;

export type ConversationAnalysis = Readonly<{
  lastProspectMessage: string | null;
  stage: ConversationStage;
  intent: ConversationIntent;
  interest: InterestLevel;
  nextGoal: NextGoal;
  rationale: string;
}>;

export type ScreenshotsAnalysis =
  | Readonly<{
      kind: "PROFILE";
      prospect: ProspectSnapshot;
      facts: readonly string[];
      hypotheses: readonly string[];
      /** What the memory should keep about the prospect. */
      summary: string | null;
      suggestions: readonly Suggestion[];
      note: string | null;
    }>
  | Readonly<{
      kind: "CONVERSATION";
      prospect: ProspectSnapshot;
      /** The messages visible in the screenshots, oldest first. */
      messages: readonly ConversationMessage[];
      facts: readonly string[];
      hypotheses: readonly string[];
      analysis: ConversationAnalysis;
      /** Objections still open, as the analysis sees them now. */
      objections: readonly string[];
      /** Promises still to keep, as the analysis sees them now. */
      commitments: readonly Commitment[];
      summary: string | null;
      /** Empty when no message should be sent, for example DO_NOT_CONTACT. */
      suggestions: readonly Suggestion[];
      note: string | null;
    }>
  | Readonly<{ kind: "UNRELATED"; note: string | null }>;

export type ConversationReply = Readonly<{
  /** The pasted text, split into messages, oldest first. */
  messages: readonly ConversationMessage[];
  facts: readonly string[];
  hypotheses: readonly string[];
  analysis: ConversationAnalysis;
  objections: readonly string[];
  commitments: readonly Commitment[];
  summary: string | null;
  suggestions: readonly Suggestion[];
  note: string | null;
}>;

export type InvalidOutput = Readonly<{
  type: "INVALID_OUTPUT";
  reason: string;
}>;

const invalid = (reason: string): Result<never, InvalidOutput> =>
  err({ type: "INVALID_OUTPUT", reason });

/** A username that cannot exist on Instagram counts as not visible. */
export const toProspectIdentity = (
  output: ProspectIdentityOutput,
): Result<ProspectIdentity, InvalidOutput> => {
  const displayName = output.display_name?.trim() ?? "";
  return ok({
    username:
      output.username === null ? null : canonicalUsername(output.username),
    displayName: displayName === "" ? null : displayName,
  });
};

const toProspect = (
  prospect: ScreenshotsOutput["prospect"],
): ProspectSnapshot => {
  const username = prospect?.username ?? null;
  return {
    // Compared with the recognized username: both must be canonical.
    username: username === null ? null : canonicalUsername(username),
    displayName: prospect?.display_name ?? null,
    businessType: prospect?.business_type ?? null,
  };
};

const toMessages = (
  messages: ScreenshotsOutput["messages"],
): readonly ConversationMessage[] =>
  (messages ?? [])
    .map((message) => ({ author: message.author, text: message.text.trim() }))
    .filter((message) => message.text !== "");

const toNotes = (notes: readonly string[]): readonly string[] =>
  notes.map((note) => note.trim()).filter((note) => note !== "");

const toCommitments = (
  commitments: ScreenshotsOutput["commitments"],
): readonly Commitment[] =>
  commitments
    .map((commitment) => ({ by: commitment.by, text: commitment.text.trim() }))
    .filter((commitment) => commitment.text !== "");

const toSummary = (summary: string | null): string | null => {
  const text = summary?.trim() ?? "";
  return text === "" ? null : text;
};

const toAnalysis = (
  conversation: ConversationReplyOutput["conversation"],
): ConversationAnalysis => ({
  lastProspectMessage: conversation.last_prospect_message,
  stage: conversation.stage,
  intent: conversation.intent,
  interest: conversation.interest,
  nextGoal: conversation.next_goal,
  rationale: conversation.rationale,
});

/**
 * Three longer suggestions would not fit in one Telegram message, at most
 * 4096 characters; the prompts ask for far shorter ones.
 */
export const MAX_SUGGESTION_LENGTH = 1_000;

const suggestionsOf = (
  entries: readonly (readonly [SuggestionStyle, string])[],
): Result<readonly Suggestion[], InvalidOutput> => {
  const suggestions = entries.map(([style, text]) => ({
    style,
    text: text.trim(),
  }));
  if (suggestions.some((suggestion) => suggestion.text === "")) {
    return invalid("empty suggestion");
  }
  return suggestions.every(
    (suggestion) => suggestion.text.length <= MAX_SUGGESTION_LENGTH,
  )
    ? ok(suggestions)
    : invalid("suggestion too long");
};

const replySuggestions = (
  replies: ConversationReplyOutput["replies"],
): Result<readonly Suggestion[], InvalidOutput> =>
  replies === null
    ? ok([])
    : suggestionsOf([
        ["BEST", replies.best],
        ["ALTERNATIVE", replies.alternative],
        ["DIRECT", replies.direct],
      ]);

/** Checks that the output is consistent with what it says it shows. */
export const toScreenshotsAnalysis = (
  output: ScreenshotsOutput,
): Result<ScreenshotsAnalysis, InvalidOutput> => {
  switch (output.kind) {
    case "PROFILE": {
      if (output.first_messages === null) {
        return invalid("profile without first messages");
      }
      const suggestions = suggestionsOf([
        ["BEST", output.first_messages.best],
        ["CURIOSITY", output.first_messages.curiosity],
        ["NATURAL", output.first_messages.natural],
      ]);
      return suggestions.ok
        ? ok({
            kind: "PROFILE",
            prospect: toProspect(output.prospect),
            facts: output.observed_facts,
            hypotheses: output.hypotheses,
            summary: toSummary(output.summary),
            suggestions: suggestions.value,
            note: output.note,
          })
        : suggestions;
    }
    case "CONVERSATION": {
      if (output.conversation === null) {
        return invalid("conversation without analysis");
      }
      const suggestions = replySuggestions(output.replies);
      return suggestions.ok
        ? ok({
            kind: "CONVERSATION",
            prospect: toProspect(output.prospect),
            // A missing transcription only costs the memory some messages.
            messages: toMessages(output.messages),
            facts: output.observed_facts,
            hypotheses: output.hypotheses,
            analysis: toAnalysis(output.conversation),
            objections: toNotes(output.objections),
            commitments: toCommitments(output.commitments),
            summary: toSummary(output.summary),
            suggestions: suggestions.value,
            note: output.note,
          })
        : suggestions;
    }
    case "UNRELATED":
      return ok({ kind: "UNRELATED", note: output.note });
  }
};

/** Reads the suggestions of the kind asked, and only those. */
export const toNewSuggestions =
  (kind: SuggestionKind) =>
  (output: NewSuggestionsOutput): Result<NewSuggestions, InvalidOutput> => {
    const firstMessages = kind === "FIRST_MESSAGES";
    const wanted = firstMessages ? output.first_messages : output.replies;
    const other = firstMessages ? output.replies : output.first_messages;
    if (wanted === null && other !== null) {
      return invalid("suggestions of another kind");
    }
    const suggestions =
      output.first_messages !== null && firstMessages
        ? suggestionsOf([
            ["BEST", output.first_messages.best],
            ["CURIOSITY", output.first_messages.curiosity],
            ["NATURAL", output.first_messages.natural],
          ])
        : replySuggestions(firstMessages ? null : output.replies);
    return suggestions.ok
      ? ok({ suggestions: suggestions.value, note: output.note })
      : suggestions;
  };

export const toConversationReply = (
  output: ConversationReplyOutput,
): Result<ConversationReply, InvalidOutput> => {
  const suggestions = replySuggestions(output.replies);
  return suggestions.ok
    ? ok({
        messages: toMessages(output.messages),
        facts: output.observed_facts,
        hypotheses: output.hypotheses,
        analysis: toAnalysis(output.conversation),
        objections: toNotes(output.objections),
        commitments: toCommitments(output.commitments),
        summary: toSummary(output.summary),
        suggestions: suggestions.value,
        note: output.note,
      })
    : suggestions;
};
