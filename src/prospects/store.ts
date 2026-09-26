import { randomUUID } from "node:crypto";

import type { StageChange } from "../conversations/domain.ts";
import {
  MAX_STORED_MESSAGES,
  type MemoryUpdate,
  type ProspectMemory,
} from "./memory.ts";

/**
 * Where prospect memory lives: MySQL in production, the process itself in
 * development. Every implementation passes the same contract tests.
 */
export type ProspectStore = Readonly<{
  /** The memory of the prospect with this canonical username, or null. */
  load: (username: string) => Promise<ProspectMemory | null>;
  /**
   * Stores the prospect as the update describes it, creating it the first
   * time; appends the new messages and keeps only the latest ones. A new
   * stage is recorded in the history.
   */
  save: (update: MemoryUpdate) => Promise<ProspectMemory>;
  /** Every change of stage recorded by `save`, oldest first. */
  stageHistory: (username: string) => Promise<readonly StageChange[]>;
}>;

/** Time and identifiers, injected so tests can predict them. */
export type StoreDependencies = Readonly<{
  now?: () => Date;
  newId?: () => string;
}>;

/** Memory that lasts as long as the process: for development only. */
export const createInMemoryProspectStore = ({
  now = () => new Date(),
  newId = randomUUID,
}: StoreDependencies = {}): ProspectStore => {
  const memories = new Map<string, ProspectMemory>();
  const histories = new Map<string, readonly StageChange[]>();

  return {
    load: (username) => Promise.resolve(memories.get(username) ?? null),
    save: ({ profile, newMessages }) => {
      const time = now();
      const earlier = memories.get(profile.username);
      const from = earlier?.prospect.conversation?.stage ?? null;
      const to = profile.conversation?.stage ?? null;
      if (to !== null && to !== from) {
        histories.set(profile.username, [
          ...(histories.get(profile.username) ?? []),
          { from, to, at: time },
        ]);
      }
      const memory: ProspectMemory = {
        prospect: {
          ...profile,
          id: earlier?.prospect.id ?? newId(),
          createdAt: earlier?.prospect.createdAt ?? time,
          updatedAt: time,
        },
        messages: [...(earlier?.messages ?? []), ...newMessages].slice(
          -MAX_STORED_MESSAGES,
        ),
      };
      memories.set(profile.username, memory);
      return Promise.resolve(memory);
    },
    stageHistory: (username) => Promise.resolve(histories.get(username) ?? []),
  };
};
