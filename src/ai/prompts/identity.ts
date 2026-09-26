import { layer } from "./layer.ts";

/**
 * A quick look at the screenshots, made by a small model before the full
 * analysis, to know whose memory to load.
 */
export const PROSPECT_IDENTITY_TASK = layer("prospect-identity", 1, [
  "Task: recognize the prospect in the screenshots, before the full analysis.",
  "",
  "- username: the prospect's Instagram username exactly as it appears, without @. On a profile it is at the top of the page. In a direct-message chat the prospect is the other person, never Alex, and the username can appear at the top of the chat or in the profile card at the beginning of the conversation.",
  "- display_name: the name shown for the prospect.",
  "",
  "Never infer the username from the name or from other text: if it is not written, it is null. If the screenshots show neither an Instagram profile nor a direct-message chat, both are null.",
]);
