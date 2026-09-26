import { layer } from "./layer.ts";

/** Opening messages for a prospect Alex has never written to. */
export const FIRST_MESSAGE_TASK = layer("first-message", 1, [
  "Task: first message to a new prospect, based on their Instagram profile.",
  "",
  "From the profile, collect:",
  "- prospect: username (without @), display name and type of business, when visible;",
  "- observed_facts: what the profile shows that helps to start a conversation, such as the bio, a call to action, the link, the services and recurring themes of the posts, or signs of how they handle bookings and orders;",
  "- hypotheses: needs related to what Alex builds that the profile suggests but does not prove.",
  "",
  "Then write three different opening messages. Their only goal is to get a reply (GET_REPLY): do not sell, do not mention Alex's services and do not ask for a call.",
  "- best: the message most likely to get a reply from this person;",
  "- curiosity: a genuine question about their work that is easy and pleasant to answer;",
  "- natural: a conversational message, like a peer writing to another.",
]);
