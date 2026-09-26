import { layer } from "./layer.ts";

/** Text Alex copied from an Instagram chat, instead of a screenshot. */
export const PASTED_CONVERSATION_TASK = layer("pasted-conversation", 1, [
  "You receive text that Alex copied from an Instagram direct-message conversation, possibly with what Alex's memory holds about the prospect.",
  "",
  "messages lists the text split into its messages, oldest first, each with its author: ALEX for Alex's messages, PROSPECT for the prospect's. When the text does not show who wrote it, it is the prospect's latest message.",
]);
