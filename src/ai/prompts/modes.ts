import type { ProspectMemory } from "../../prospects/memory.ts";
import { CONVERSATION_REPLY_TASK } from "./conversation-reply.ts";
import { FIRST_MESSAGE_TASK } from "./first-message.ts";
import { PROSPECT_IDENTITY_TASK } from "./identity.ts";
import type { PromptLayer } from "./layer.ts";
import { SCREENSHOTS_TASK } from "./screenshots.ts";
import { COMMUNICATION_PRINCIPLES, SYSTEM_POLICY } from "./system.ts";

export type PromptMode =
  "PROSPECT_IDENTITY" | "SCREENSHOTS" | "CONVERSATION_REPLY";

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
    FIRST_MESSAGE_TASK,
    CONVERSATION_REPLY_TASK,
  ],
  CONVERSATION_REPLY: [
    SYSTEM_POLICY,
    COMMUNICATION_PRINCIPLES,
    CONVERSATION_REPLY_TASK,
  ],
};

/** Keeps untrusted text from closing the tag that delimits it. */
const withinTag = (tag: string, text: string): string =>
  [
    `<${tag}>`,
    text.replaceAll(new RegExp(`</?${tag}>`, "gi"), ""),
    `</${tag}>`,
  ].join("\n");

export const PROSPECT_IDENTITY_REQUEST =
  "Recognize the prospect in these screenshots.";

const listed = (title: string, items: readonly string[]): string[] =>
  items.length === 0 ? [] : [title, ...items.map((item) => `- ${item}`)];

/** What the memory holds about a prospect, as the model reads it. */
export const memoryContext = ({ prospect, messages }: ProspectMemory): string =>
  [
    `Username: @${prospect.username}`,
    `Name: ${prospect.displayName ?? "unknown"}`,
    `Business: ${prospect.businessType ?? "unknown"}`,
    `Last updated: ${prospect.updatedAt.toISOString().slice(0, 10)}`,
    ...(prospect.conversation === null
      ? []
      : [
          `Latest reading: stage ${prospect.conversation.stage}, intent ${prospect.conversation.intent}, interest ${prospect.conversation.interest}, next goal ${prospect.conversation.nextGoal}`,
        ]),
    ...(prospect.summary === null ? [] : [`Summary: ${prospect.summary}`]),
    ...listed("Facts:", prospect.facts),
    ...listed("Hypotheses to verify:", prospect.hypotheses),
    ...(messages.length === 0
      ? []
      : [
          "Latest messages, oldest first:",
          ...messages.map(
            (message) =>
              `${message.author === "ALEX" ? "Alex" : "Prospect"}: ${message.text}`,
          ),
        ]),
  ].join("\n");

/**
 * Alex's request for a batch of screenshots, with the note Alex may have
 * written and the memory of the prospect recognized in them, if any.
 */
export const screenshotsRequest = (
  note: string | null,
  memory: ProspectMemory | null,
): string =>
  [
    "Analyze these screenshots.",
    ...(note === null
      ? []
      : ["Alex added this note:", withinTag("alex_note", note)]),
    ...(memory === null
      ? []
      : [
          "Alex's memory of the prospect recognized in them:",
          withinTag("prospect_memory", memoryContext(memory)),
        ]),
  ].join("\n");

/** A conversation Alex pasted, delimited as untrusted content. */
export const conversationRequest = (text: string): string =>
  [
    "Alex pasted this text from an Instagram conversation. It may be only the prospect's latest message or a longer part of the conversation.",
    withinTag("conversation", text),
  ].join("\n");
