import { layer } from "./layer.ts";

/**
 * Screenshots may show a profile or a conversation: the model tells them
 * apart, then follows the matching task, sent together with this layer.
 */
export const SCREENSHOTS_TASK = layer("screenshots", 1, [
  "You receive one or more screenshots that Alex took on Instagram, possibly with a note from Alex.",
  "",
  "First decide what they show and set kind:",
  "- PROFILE: an Instagram profile, with bio, highlights or posts. Follow the first-message task; conversation and replies are null.",
  "- CONVERSATION: a direct-message conversation. Follow the conversation task; first_messages is null.",
  "- UNRELATED: neither of the two. Say briefly in the note what you see; the other fields are null or empty.",
  "",
  "If the screenshots show both the profile and a conversation with the same person, treat them as a CONVERSATION and use the profile as context.",
]);
