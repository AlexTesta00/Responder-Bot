import { MAX_FOLLOW_UPS } from "../../conversations/transition.ts";
import type { ProspectMemory } from "../../prospects/memory.ts";
import { contactOfMemory } from "../../followups/contact.ts";
import { daysBetween, romeDate } from "../../shared/time.ts";
import type { SuggestionAction, SuggestionsRequest } from "../engine.ts";
import type { SuggestionKind } from "../outputs.ts";
import { CONVERSATION_REPLY_TASK } from "./conversation-reply.ts";
import { FIRST_MESSAGE_TASK } from "./first-message.ts";
import { PROSPECT_IDENTITY_TASK } from "./identity.ts";
import type { PromptLayer } from "./layer.ts";
import { MEMORY_TASK } from "./memory.ts";
import { NEW_SUGGESTIONS_TASK } from "./new-suggestions.ts";
import { PASTED_CONVERSATION_TASK } from "./pasted.ts";
import { SCREENSHOTS_TASK } from "./screenshots.ts";
import { COMMUNICATION_PRINCIPLES, SYSTEM_POLICY } from "./system.ts";

export type PromptMode =
  | "PROSPECT_IDENTITY"
  | "SCREENSHOTS"
  | "CONVERSATION_REPLY"
  | "NEW_SUGGESTIONS";

/**
 * The instruction layers of each mode, from the most stable to the most
 * specific, so the shared beginning can be cached across requests.
 */
export const PROMPT_LAYERS: Readonly<
  Record<PromptMode, readonly PromptLayer[]>
> = {
  // Recognizing the prospect writes no message: no communication principles.
  PROSPECT_IDENTITY: [SYSTEM_POLICY, PROSPECT_IDENTITY_TASK],
  SCREENSHOTS: [
    SYSTEM_POLICY,
    COMMUNICATION_PRINCIPLES,
    SCREENSHOTS_TASK,
    MEMORY_TASK,
    FIRST_MESSAGE_TASK,
    CONVERSATION_REPLY_TASK,
  ],
  CONVERSATION_REPLY: [
    SYSTEM_POLICY,
    COMMUNICATION_PRINCIPLES,
    PASTED_CONVERSATION_TASK,
    MEMORY_TASK,
    CONVERSATION_REPLY_TASK,
  ],
  // The new task comes last: it sets aside what the others ask to analyze.
  NEW_SUGGESTIONS: [
    SYSTEM_POLICY,
    COMMUNICATION_PRINCIPLES,
    MEMORY_TASK,
    FIRST_MESSAGE_TASK,
    CONVERSATION_REPLY_TASK,
    NEW_SUGGESTIONS_TASK,
  ],
};

/** Keeps untrusted text from opening or closing the tag that delimits it. */
// The "<" of anything that looks like the tag becomes "‹": unlike removing
// the tag, this cannot rebuild one out of nested pieces.
const withinTag = (tag: string, text: string): string =>
  [
    `<${tag}>`,
    text.replaceAll(new RegExp(`<(?=\\s*/?\\s*${tag}\\b)`, "gi"), "‹"),
    `</${tag}>`,
  ].join("\n");

export const PROSPECT_IDENTITY_REQUEST =
  "Recognize the prospect in these screenshots.";

const listed = (title: string, items: readonly string[]): string[] =>
  items.length === 0 ? [] : [title, ...items.map((item) => `- ${item}`)];

const speaker = (author: "ALEX" | "PROSPECT"): string =>
  author === "ALEX" ? "Alex" : "Prospect";

const dated = (instant: Date, today: Date): string => {
  const days = daysBetween(instant, today);
  const ago =
    days === 0
      ? "today"
      : days === 1
        ? "1 day ago"
        : `${String(days)} days ago`;
  return `${romeDate(instant)} (${ago})`;
};

const KIND_WORDS: Readonly<Record<SuggestionKind, string>> = {
  FIRST_MESSAGES: "first message",
  REPLIES: "reply",
  FOLLOW_UPS: "follow-up",
};

/** "the first one and 1 follow-up; at most 2 follow-ups without a reply". */
const unansweredDetail = (followUpsSent: number): string =>
  [
    "the first one",
    followUpsSent === 0
      ? ""
      : ` and ${String(followUpsSent)} follow-up${followUpsSent === 1 ? "" : "s"}`,
    `; at most ${String(MAX_FOLLOW_UPS)} follow-ups without a reply`,
  ].join("");

/**
 * What the memory holds about a prospect, as the model reads it, with the
 * days since each side last wrote and what Alex marked as sent.
 */
export const memoryContext = (memory: ProspectMemory, today: Date): string => {
  const { prospect, messages } = memory;
  const contact = contactOfMemory(memory);
  const { lastProspectMessageAt, lastAlexMessageAt } = memory.contact;
  const alexLast =
    contact.unanswered > 0 ? contact.lastOutboundAt : lastAlexMessageAt;
  const reading = prospect.conversation;
  return [
    `Today: ${romeDate(today)} (Europe/Rome)`,
    `Username: @${prospect.username}`,
    `Name: ${prospect.displayName ?? "unknown"}`,
    `Business: ${prospect.businessType ?? "unknown"}`,
    `Last updated: ${romeDate(prospect.updatedAt)}`,
    ...(lastProspectMessageAt === null
      ? []
      : [
          `Prospect's latest message seen: ${dated(lastProspectMessageAt, today)}`,
        ]),
    ...(alexLast === null
      ? []
      : [`Alex's latest message: ${dated(alexLast, today)}`]),
    ...(reading === null
      ? []
      : [
          `Latest reading: stage ${reading.stage}, intent ${reading.intent}, interest ${reading.interest}, next goal ${reading.nextGoal}`,
        ]),
    ...(prospect.summary === null ? [] : [`Summary: ${prospect.summary}`]),
    ...listed("Open objections:", prospect.objections),
    ...listed(
      "Open promises:",
      prospect.commitments.map(
        (commitment) => `${speaker(commitment.by)}: ${commitment.text}`,
      ),
    ),
    ...listed("Facts:", prospect.facts),
    ...listed("Hypotheses to verify:", prospect.hypotheses),
    ...(messages.length === 0
      ? []
      : [
          "Latest messages, oldest first:",
          ...messages.map(
            (message) => `${speaker(message.author)}: ${message.text}`,
          ),
        ]),
    ...listed(
      "Messages Alex marked as sent that the messages above do not show yet, oldest first:",
      contact.pending.map(
        ({ kind, style, text, sentAt }) =>
          `${romeDate(sentAt)}, ${KIND_WORDS[kind]}, ${style ?? "style unknown"}: ${text ?? "(text not recorded)"}`,
      ),
    ),
    ...(contact.unanswered === 0
      ? []
      : [
          `Alex's messages still without a reply at the end: ${String(contact.unanswered)} (${unansweredDetail(contact.followUpsSent)})`,
        ]),
  ].join("\n");
};

const memoryLines = (memory: ProspectMemory | null, today: Date): string[] =>
  memory === null
    ? []
    : [
        "Alex's memory of this prospect:",
        withinTag("prospect_memory", memoryContext(memory, today)),
      ];

/**
 * Alex's request for a batch of screenshots, with the note Alex may have
 * written and the memory of the prospect recognized in them, if any.
 */
export const screenshotsRequest = (
  note: string | null,
  memory: ProspectMemory | null,
  today: Date,
): string =>
  [
    "Analyze these screenshots.",
    ...(note === null
      ? []
      : ["Alex added this note:", withinTag("alex_note", note)]),
    ...memoryLines(memory, today),
  ].join("\n");

const KIND_NAMES: Readonly<Record<SuggestionKind, string>> = {
  FIRST_MESSAGES: "first messages",
  REPLIES: "replies",
  FOLLOW_UPS: "follow-ups",
};

/** What each action asks, with or without the suggestions Alex saw. */
const ACTION_REQUESTS: Readonly<
  Record<SuggestionAction, (kind: string, shown: boolean) => string>
> = {
  MORE: (kind, shown) =>
    shown
      ? `More: write three new ${kind}, different from the previous ones.`
      : `Write three ${kind} from the memory.`,
  NATURAL: (kind) =>
    `More natural: rewrite the previous ${kind} to sound more natural.`,
  DIRECT: (kind) =>
    `More direct: rewrite the previous ${kind} to be more direct.`,
  FOLLOW_UP: (_kind, shown) =>
    shown
      ? "Follow-ups: Alex sent one of the previous messages and the prospect has not replied. Write three follow-ups."
      : "Follow-ups: Alex's latest message has had no reply. Write three follow-ups.",
  NEXT_FOLLOW_UP: () =>
    "Next follow-up: the memory shows or counts Alex's messages without a reply and when the last one was sent. Write three follow-ups.",
};

/** What a button asks, with the suggestions Alex saw and the memory. */
export const newSuggestionsRequest = (
  { action, kind, previous }: SuggestionsRequest,
  memory: ProspectMemory,
  today: Date,
): string =>
  [
    ACTION_REQUESTS[action](KIND_NAMES[kind], previous.length > 0),
    ...(previous.length === 0
      ? []
      : [
          "The suggestions Alex saw:",
          withinTag(
            "previous_suggestions",
            previous
              .map((suggestion) => `${suggestion.style}: ${suggestion.text}`)
              .join("\n"),
          ),
        ]),
    ...memoryLines(memory, today),
  ].join("\n");

/** A conversation Alex pasted, delimited as untrusted content. */
export const conversationRequest = (
  text: string,
  memory: ProspectMemory | null,
  today: Date,
): string =>
  [
    "Alex pasted this text from an Instagram conversation. It may be only the prospect's latest message or a longer part of the conversation.",
    withinTag("conversation", text),
    ...memoryLines(memory, today),
  ].join("\n");
