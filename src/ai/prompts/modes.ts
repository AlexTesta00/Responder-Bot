import { CONVERSATION_REPLY_TASK } from "./conversation-reply.ts";
import { FIRST_MESSAGE_TASK } from "./first-message.ts";
import type { PromptLayer } from "./layer.ts";
import { SCREENSHOTS_TASK } from "./screenshots.ts";
import { COMMUNICATION_PRINCIPLES, SYSTEM_POLICY } from "./system.ts";

export type PromptMode = "SCREENSHOTS" | "CONVERSATION_REPLY";

/**
 * The instruction layers of each mode, from the most stable to the most
 * specific, so the shared beginning can be cached across requests.
 */
export const PROMPT_LAYERS: Readonly<
  Record<PromptMode, readonly PromptLayer[]>
> = {
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

/** Alex's request for a batch of screenshots, with his note if he wrote one. */
export const screenshotsRequest = (note: string | null): string =>
  note === null
    ? "Analyze these screenshots."
    : [
        "Analyze these screenshots. Alex added this note:",
        withinTag("alex_note", note),
      ].join("\n");

/** A conversation Alex pasted, delimited as untrusted content. */
export const conversationRequest = (text: string): string =>
  [
    "Alex pasted this text from an Instagram conversation. It may be only the prospect's latest message or a longer part of the conversation.",
    withinTag("conversation", text),
  ].join("\n");
