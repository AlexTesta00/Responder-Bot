import { layer } from "./layer.ts";

/**
 * How to use what the bot remembers about a prospect, and how to keep it up
 * to date: shared by screenshots and pasted conversations.
 */
export const MEMORY_TASK = layer("memory", 1, [
  "Memory: when the request includes <prospect_memory>, it holds what earlier analyses stored about this prospect: the profile, the latest reading of the conversation, the open objections and promises, a summary and the latest messages. Use it as context: continue from where the conversation stands, never suggest again what Alex has already written, deliver what Alex promised, and answer an open objection when it matters for the next step. What the conversation shows now wins over the memory. If it clearly shows a different person from the one in the memory, ignore the memory and say so in the note.",
  "",
  "Alongside the analysis, keep the memory up to date:",
  "- objections: the prospect's objections that are still open, such as a price that seems high, no time now or a provider they already have;",
  "- commitments: what Alex or the prospect said they would do and has not done yet, with who said it (by);",
  "- summary: two or three sentences in Italian that Alex's memory will keep about the prospect: who they are, where the relationship stands, what has been said or promised and what is still open.",
  "Start from the lists and the summary in the memory: keep what still holds, add what is new and drop what has been resolved. For a profile, objections and commitments are empty.",
]);
