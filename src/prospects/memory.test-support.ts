// Memories for tests, built the way the stores build them.
import type { ConversationMessage } from "../conversations/domain.ts";
import {
  contactFactsOf,
  type Prospect,
  type ProspectMemory,
  type Send,
} from "./memory.ts";

/**
 * The memory of `prospect`, as a store returns it when every message was
 * stored at the prospect's last update.
 */
export const memoryOf = (
  {
    prospect,
    messages,
  }: Readonly<{ prospect: Prospect; messages: readonly ConversationMessage[] }>,
  sends: readonly Send[] = [],
): ProspectMemory => ({
  prospect,
  messages,
  contact: contactFactsOf(
    messages.map(({ author }) => ({ author, at: prospect.updatedAt })),
    sends,
  ),
});
