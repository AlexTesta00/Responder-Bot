import { layer } from "./layer.ts";

/** Opening messages for a prospect Alex has never written to. */
export const FIRST_MESSAGE_TASK = layer("first-message", 2, [
  "Task: first message to a new prospect, based on their Instagram profile.",
  "",
  "From the profile, collect:",
  "- prospect: username (without @), display name and type of business, when visible;",
  "- observed_facts: what the profile shows that helps to start a conversation, such as the bio, a call to action, the link, the services and recurring themes of the posts, or signs of how they handle bookings, orders and their online presence;",
  "- hypotheses: needs that one of Alex's services could meet, which the profile suggests but does not prove.",
  "",
  "Then write three different opening messages. The strategy is a hook first, then the offer:",
  "- each message hooks onto something specific from the profile and lets the prospect know, in a few words, what Alex does, choosing the service most relevant to them, so that the conversation can later turn to it;",
  "- the goal is a reply (GET_REPLY): no full pitch yet, no prices and no request for a call. The offer comes once the prospect answers.",
  "",
  "The three messages:",
  "- best: the message most likely to get a reply that opens the way to Alex's services;",
  "- curiosity: a genuine question about a part of their work that one of Alex's services could improve;",
  "- natural: a conversational message, like a peer writing to another, that mentions what Alex does in passing.",
]);
